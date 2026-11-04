/**
 * The `rest` block for Home Assistant's configuration.yaml (T-308, 03 §13): one sensor with the variant's current
 * price in pesos and its lowest as an attribute. Without a chosen variant, its id is left as a placeholder.
 */
export function haConfig(origin: string, variant: { variant_id: string; name: string } | null): string {
  const id = variant?.variant_id ?? '<id de la presentación>';
  const name = (variant?.name ?? 'Precio').replace(/"/g, "'");
  return [
    'rest:',
    `  - resource: ${origin}/ha/v1/variants/${id}`,
    '    headers:',
    '      Authorization: !secret maunedas_token',
    '    scan_interval: 3600',
    '    sensor:',
    `      - name: "${name}"`,
    '        unit_of_measurement: "MXN"',
    '        value_template: "{{ (value_json.current.price_cents / 100) if value_json.current else none }}"',
    '        json_attributes:',
    '          - lowest',
    '          - in_stock',
    '          - listings',
    '',
    '# secrets.yaml',
    'maunedas_token: "Bearer <token>"',
  ].join('\n');
}
