import { plainCents } from '@maunedas/shared/text/decimal';
import { useState } from 'react';
import { formatMoney, formatUnitPrice } from '../../../lib/format';
import { promoLabel } from '../../../lib/promotions';
import { useWide } from '../../../lib/useWide';
import { amountsOf, lineTitle, type PurchaseLine, perUnitCents, quantityText } from './draft';

export interface LineActions {
  open: (index: number) => void;
  move: (index: number, delta: -1 | 1) => void;
  remove: (index: number) => void;
  /** An inline cell of the table: the error to tell, or null when the line took it. */
  edit: (index: number, cell: 'quantity' | 'price', text: string) => string | null;
}

/**
 * The products of S-04: cards on a phone (tapping one opens its dialog), an editable table from `md` up with
 * quantity and price as cells that Tab goes through (06 §3). Each line moves up or down (its order is `line_no`)
 * and is taken off with its button; an unlinked ticket line asks to be linked.
 */
export function LinesList({ lines, actions }: { lines: PurchaseLine[]; actions: LineActions }) {
  const wide = useWide();
  if (lines.length === 0)
    return <p className="text-on-surface-variant">Aún no hay productos en esta compra.</p>;
  return wide ? (
    <LinesTable lines={lines} actions={actions} />
  ) : (
    <LineCards lines={lines} actions={actions} />
  );
}

function priceText(line: PurchaseLine) {
  return line.unitPriceCents === 0 ? (
    <span className="text-error">Sin precio</span>
  ) : (
    `${quantityText(line.quantity)} × ${formatMoney(line.unitPriceCents)}`
  );
}

function PerUnit({ line }: { line: PurchaseLine }) {
  const cents = perUnitCents(line);
  if (cents === null || !line.variant) return null;
  return (
    <span className="text-label text-on-surface-variant">{formatUnitPrice(cents, line.variant.unit)}</span>
  );
}

function Moves({
  index,
  count,
  title,
  actions,
}: {
  index: number;
  count: number;
  title: string;
  actions: LineActions;
}) {
  return (
    <span className="flex shrink-0">
      <button
        type="button"
        className="btn-text px-2"
        aria-label={`Subir ${title}`}
        disabled={index === 0}
        onClick={() => actions.move(index, -1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn-text px-2"
        aria-label={`Bajar ${title}`}
        disabled={index === count - 1}
        onClick={() => actions.move(index, 1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="btn-text px-2"
        aria-label={`Quitar ${title}`}
        onClick={() => actions.remove(index)}
      >
        ✕
      </button>
    </span>
  );
}

function LineCards({ lines, actions }: { lines: PurchaseLine[]; actions: LineActions }) {
  return (
    <ul className="flex flex-col divide-y divide-outline/30 rounded-xl border border-outline/30">
      {lines.map((line, i) => {
        const title = lineTitle(line);
        return (
          <li key={line.id ?? i} className={`flex gap-2 p-3 ${line.variant ? '' : 'bg-warning/10'}`}>
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
              onClick={() => actions.open(i)}
            >
              <span className="font-medium">{title}</span>
              {!line.variant && <span className="font-medium text-primary">Vincular</span>}
              <span className="text-label">
                {priceText(line)}
                {line.promotion && ` · ${promoLabel(line.promotion.type)}`}
              </span>
              <span className="font-medium tabular-nums">{formatMoney(amountsOf(line).final_cents)}</span>
              <PerUnit line={line} />
            </button>
            <Moves index={i} count={lines.length} title={title} actions={actions} />
          </li>
        );
      })}
    </ul>
  );
}

function LinesTable({ lines, actions }: { lines: PurchaseLine[]; actions: LineActions }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-left text-label text-on-surface-variant">
          <th className="p-2 font-medium">Producto</th>
          <th className="w-28 p-2 font-medium">Cantidad</th>
          <th className="w-32 p-2 font-medium">Precio unitario</th>
          <th className="p-2 font-medium">Promoción</th>
          <th className="p-2 text-right font-medium">Total</th>
          <th className="p-2">
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => {
          const title = lineTitle(line);
          return (
            <tr
              key={line.id ?? i}
              className={`border-t border-outline/30 ${line.variant ? '' : 'bg-warning/10'}`}
            >
              <td className="p-2">
                <button
                  type="button"
                  className="flex flex-col items-start text-left"
                  onClick={() => actions.open(i)}
                >
                  <span className="font-medium">{title}</span>
                  {!line.variant && <span className="font-medium text-primary">Vincular</span>}
                </button>
                <PerUnit line={line} />
              </td>
              <td className="p-2">
                <Cell
                  label={`Cantidad de ${title}`}
                  value={quantityText(line.quantity)}
                  onCommit={(text) => actions.edit(i, 'quantity', text)}
                />
              </td>
              <td className="p-2">
                <Cell
                  label={`Precio de ${title}`}
                  value={line.unitPriceCents === 0 ? '' : plainCents(line.unitPriceCents)}
                  placeholder="Sin precio"
                  onCommit={(text) => actions.edit(i, 'price', text)}
                />
              </td>
              <td className="p-2 text-label">{line.promotion ? promoLabel(line.promotion.type) : '—'}</td>
              <td className="p-2 text-right font-medium tabular-nums">
                {formatMoney(amountsOf(line).final_cents)}
              </td>
              <td className="p-2 text-right">
                <Moves index={i} count={lines.length} title={title} actions={actions} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A cell typed in place: it takes the text when it loses the focus (Tab), or tells what is wrong and goes back. */
function Cell({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (text: string) => string | null;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <input
        aria-label={label}
        aria-invalid={error !== null}
        inputMode="decimal"
        value={text ?? value}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (text === null || text === value) return setText(null);
          const problem = onCommit(text);
          setError(problem);
          setText(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="field w-full"
      />
      {error && (
        <span role="alert" className="text-label text-error">
          {error}
        </span>
      )}
    </>
  );
}
