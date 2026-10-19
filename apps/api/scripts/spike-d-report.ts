// TEMPORARY (spike D): summarize `wrangler tail --format json` output by route.
//   node scripts/spike-d-report.ts <tail.jsonl>
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2] ?? '', 'utf8');
const events: Array<{
  cpuTime: number;
  wallTime: number;
  outcome: string;
  event?: { request?: { url?: string } };
}> = [];
for (let i = 0; i < raw.length;) {
  while (i < raw.length && /\s/.test(raw[i]!)) i++;
  if (i >= raw.length) break;
  // tail prints pretty JSON objects one after another
  let depth = 0;
  let j = i;
  let inString = false;
  for (; j < raw.length; j++) {
    const ch = raw[j];
    if (inString) {
      if (ch === '\\') j++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) break;
  }
  events.push(JSON.parse(raw.slice(i, j + 1)));
  i = j + 1;
}

const groups = new Map<string, typeof events>();
for (const e of events) {
  const url = new URL(e.event?.request?.url ?? 'http://x/unknown');
  const key = url.pathname.replace('/v1/__spike/d', '') + url.search;
  groups.set(key, [...(groups.get(key) ?? []), e]);
}
const pct = (xs: number[], p: number) =>
  xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] ?? 0;
console.log('| Escenario | n | CPU p50 (ms) | CPU p95 (ms) | CPU máx (ms) | Pared p50 (ms) | Resultados |');
console.log('|---|---:|---:|---:|---:|---:|---|');
for (const [key, list] of [...groups].sort()) {
  const cpu = list.map((e) => e.cpuTime).sort((a, b) => a - b);
  const wall = list.map((e) => e.wallTime).sort((a, b) => a - b);
  const outcomes = [...new Set(list.map((e) => e.outcome))].join(', ');
  console.log(
    `| \`${key}\` | ${list.length} | ${pct(cpu, 50)} | ${pct(cpu, 95)} | ${cpu.at(-1)} | ${pct(wall, 50)} | ${outcomes} |`,
  );
}
