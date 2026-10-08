import { readdirSync, readFileSync } from 'node:fs';
import type { z } from 'zod';

/** Repository-level shared vectors (CLAUDE.md rule 7). Never edited to make a test pass. */
export const FIXTURES_DIR = new URL('../../../fixtures/', import.meta.url);

/** Reads `fixtures/<name>` and validates its shape, so a malformed fixture fails with a clear message. */
export function loadFixture<S extends z.ZodType>(name: string, schema: S): z.infer<S> {
  const raw: unknown = JSON.parse(readFileSync(new URL(name, FIXTURES_DIR), 'utf8'));
  return schema.parse(raw);
}

export function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}
