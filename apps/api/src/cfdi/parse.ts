import { mexicoCityMs } from '@maunedas/shared/util/time';
import { CFDI_MAX_LINES, type CfdiRejection } from '@maunedas/shared/api/cfdi';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** An XML that is not an importable purchase invoice; `reason` goes to `details.reason` (03 §14). */
export class CfdiRejected extends Error {
  constructor(readonly reason: CfdiRejection) {
    super(reason);
  }
}

export interface ParsedLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  grossCents: number;
  discountCents: number;
  finalCents: number;
  sku: string | null;
}

export interface ParsedCfdi {
  fiscalUuid: string;
  issuedAt: number;
  emisor: { rfc: string; name: string | null };
  totalCents: number;
  lines: ParsedLine[];
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => ['Concepto', 'Traslado', 'Retencion', 'Complemento'].includes(name),
});

const MICROS = 1_000_000n;
const DECIMAL = /^\d+(?:\.\d+)?$/;

/** A CFDI amount (up to 6 decimals) as millionths of a peso: money never goes through floats (rule 1). */
export function micros(value: unknown): bigint | null {
  if (typeof value !== 'string' || !DECIMAL.test(value.trim())) return null;
  const [whole, frac = ''] = value.trim().split('.');
  const six = (frac + '000000').slice(0, 6);
  const rest = frac.slice(6);
  const roundUp = rest !== '' && rest[0]! >= '5' ? 1n : 0n;
  return BigInt(whole!) * MICROS + BigInt(six) + roundUp;
}

/** Millionths to cents, half up. */
export const cents = (m: bigint): number => Number((m + 5_000n) / 10_000n);

const sum = (nodes: Node[] | undefined) =>
  (nodes ?? []).reduce((acc, n) => acc + (micros(n.Importe) ?? 0n), 0n);

/** `Fecha` is the issuer's local time without a zone; the household's is Mexico City (rule 2). */
export function fechaMs(fecha: unknown): number | null {
  const m = typeof fecha === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(fecha) : null;
  return m ? mexicoCityMs(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : null;
}

/**
 * One concept as the purchase keeps it: what was paid, taxes included.
 * - `final` is `Importe − Descuento + transferred taxes − withheld taxes`.
 * - The discount carries the line's tax rate too, so `gross − discount = final` holds to the cent.
 */
function line(c: Node): ParsedLine | null {
  const quantity = Number(c.Cantidad);
  const importe = micros(c.Importe);
  const descuento = micros(c.Descuento ?? '0');
  if (!(quantity > 0) || importe === null || descuento === null) return null;
  const taxes = (c.Impuestos ?? {}) as Node;
  const transferred = sum(((taxes.Traslados ?? {}) as Node).Traslado as Node[] | undefined);
  const withheld = sum(((taxes.Retenciones ?? {}) as Node).Retencion as Node[] | undefined);
  const base = importe - descuento;
  const final = base + transferred - withheld;
  if (base < 0n || final < 0n) return null;
  const discountWithTax = base > 0n ? descuento + (descuento * (transferred - withheld)) / base : descuento;
  const finalCents = cents(final);
  const discountCents = cents(discountWithTax);
  const grossCents = finalCents + discountCents;
  const description = String(c.Descripcion ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    description: description.slice(0, 300),
    quantity,
    unitPriceCents: Math.round(grossCents / quantity),
    grossCents,
    discountCents,
    finalCents,
    sku:
      typeof c.NoIdentificacion === 'string' && c.NoIdentificacion.trim() ? c.NoIdentificacion.trim() : null,
  };
}

/**
 * Reads a stamped CFDI 3.3 or 4.0 of type `I` (income) in pesos.
 * - Rejected without reading: a document type or entity declaration, which an invoice never has, so no entity
 *   expansion reaches the parser.
 */
export function parseCfdi(xml: string): ParsedCfdi {
  if (/<!(DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new CfdiRejected('NOT_XML');
  const doc = parser.parse(xml) as Node;
  const root = doc.Comprobante as Node | undefined;
  if (!root || !['3.3', '4.0'].includes(String(root.Version))) throw new CfdiRejected('NOT_CFDI');
  const emisor = root.Emisor as Node | undefined;
  const issuedAt = fechaMs(root.Fecha);
  const total = micros(root.Total);
  if (!emisor || typeof emisor.Rfc !== 'string' || issuedAt === null || total === null) {
    throw new CfdiRejected('NOT_CFDI');
  }
  if (root.TipoDeComprobante !== 'I') throw new CfdiRejected('NOT_INCOME');
  if (root.Moneda !== 'MXN') throw new CfdiRejected('NOT_MXN');
  const stamp = ((root.Complemento as Node[] | undefined) ?? [])
    .map((c) => c.TimbreFiscalDigital as Node | undefined)
    .find((t) => typeof t?.UUID === 'string');
  if (!stamp) throw new CfdiRejected('NO_UUID');
  const concepts = (((root.Conceptos ?? {}) as Node).Concepto as Node[] | undefined) ?? [];
  if (concepts.length === 0) throw new CfdiRejected('NO_LINES');
  if (concepts.length > CFDI_MAX_LINES) throw new CfdiRejected('TOO_MANY_LINES');
  const lines = concepts.map(line);
  if (lines.some((l) => l === null)) throw new CfdiRejected('NOT_CFDI');
  return {
    fiscalUuid: String(stamp.UUID).toUpperCase(),
    issuedAt,
    emisor: {
      rfc: emisor.Rfc.trim().toUpperCase(),
      name: typeof emisor.Nombre === 'string' ? emisor.Nombre.trim() : null,
    },
    totalCents: cents(total),
    lines: lines as ParsedLine[],
  };
}
