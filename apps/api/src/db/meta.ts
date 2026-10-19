/** `sync_meta` counters (04 §1, §5): global sync `version` and the synced `schema_version`. */
export async function readSyncMeta(db: D1Database): Promise<{ version: number; schemaVersion: number }> {
  const { results } = await db
    .prepare(`SELECT key, value FROM sync_meta WHERE key IN ('version', 'schema_version')`)
    .all<{ key: string; value: number }>();
  const get = (key: string) => {
    const row = results.find((r) => r.key === key);
    if (!row) throw new Error(`sync_meta.${key} is missing`);
    return row.value;
  };
  return { version: get('version'), schemaVersion: get('schema_version') };
}
