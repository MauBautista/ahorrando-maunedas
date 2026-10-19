type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * One JSON line per event for Workers Logs (RNF-09). Callers pass `request_id` whenever there is a
 * request. Never log tokens, passwords or secret values.
 */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
