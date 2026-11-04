import type { CfdiRejection } from '@maunedas/shared/api/cfdi';

/** Why an XML is not imported (`422 E-UNSUPPORTED_CFDI`, 03 §14), as a person reads it. */
export const CFDI_REJECTION_TEXT: Record<CfdiRejection, string> = {
  NOT_XML: 'El archivo no es un XML válido.',
  NOT_CFDI: 'El XML no es una factura CFDI 3.3 o 4.0 que se pueda leer.',
  NOT_INCOME: 'Es un CFDI que no es de compra (por ejemplo, una nota de crédito o un pago).',
  NOT_MXN: 'La factura no está en pesos mexicanos.',
  NO_UUID: 'La factura no está timbrada: no tiene folio fiscal (UUID).',
  NO_LINES: 'La factura no tiene conceptos.',
  TOO_MANY_LINES: 'La factura tiene más de 300 conceptos.',
};
