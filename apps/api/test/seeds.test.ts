import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { matchStoreName } from '@maunedas/shared/receipts/stores';
import { beforeAll, describe, expect, it } from 'vitest';
import { readSyncMeta } from '../src/db/meta';

const db = () => env.SEED_DB;

async function runSeeds() {
  for (const seed of env.TEST_SEEDS) {
    await db().batch(seed.queries.map((q) => db().prepare(q)));
  }
}

const all = async <T>(sql: string) => (await db().prepare(sql).all<T>()).results;

beforeAll(async () => {
  await applyD1Migrations(db(), env.TEST_MIGRATIONS);
});

describe('migration 0001', () => {
  it('starts sync_meta at version 0 and schema_version 1', async () => {
    expect(await readSyncMeta(db())).toEqual({ version: 0, schemaVersion: 1 });
  });
});

describe('seeds/0001_lookups.sql', () => {
  beforeAll(runSeeds);

  it('loads the 13 stores of PLAN.md with adapters only for Amazon, Costco and Sam’s', async () => {
    const stores = await all<{ name: string; adapter: string | null }>(
      'SELECT name, adapter FROM stores ORDER BY name',
    );
    expect(stores).toHaveLength(13);
    expect(stores.filter((s) => s.adapter).map((s) => [s.name, s.adapter])).toEqual([
      ['Amazon', 'amazon_mx'],
      ['Costco', 'costco_mx'],
      ["Sam's Club", 'sams_mx'],
    ]);
    expect(stores.find((s) => s.name === 'Walmart')?.adapter).toBeNull();
  });

  it('loads 8 top-level categories and 7 subcategories with valid parents', async () => {
    const top = await all<{ name: string }>(
      'SELECT name FROM categories WHERE parent_id IS NULL ORDER BY sort_order',
    );
    expect(top.map((c) => c.name)).toEqual([
      'Despensa',
      'Refrigerados',
      'Frutas y verduras',
      'Bebidas',
      'Limpieza',
      'Higiene personal',
      'Farmacia',
      'Mascotas',
    ]);
    const children = await all<{ name: string; parent: string }>(
      `SELECT c.name, p.name AS parent FROM categories c JOIN categories p ON p.id = c.parent_id ORDER BY p.sort_order, c.sort_order`,
    );
    expect(children.map((c) => `${c.parent} › ${c.name}`)).toEqual([
      'Despensa › Granos y pastas',
      'Despensa › Enlatados',
      'Despensa › Aceites y condimentos',
      'Despensa › Botanas',
      'Refrigerados › Lácteos',
      'Refrigerados › Carnes',
      'Refrigerados › Embutidos',
    ]);
  });

  it('gives every seeded row the new sync version so clients pull it', async () => {
    const { version } = await readSyncMeta(db());
    expect(version).toBe(1);
    const versions = await all<{ v: number }>(
      'SELECT DISTINCT version AS v FROM stores UNION SELECT DISTINCT version FROM categories',
    );
    expect(versions).toEqual([{ v: 1 }]);
  });

  it('is idempotent and never overwrites existing rows', async () => {
    await db().prepare(`UPDATE stores SET name = 'Costco Puebla' WHERE adapter = 'costco_mx'`).run();
    await runSeeds();
    const [counts] = await all<{ stores: number; categories: number }>(
      'SELECT (SELECT count(*) FROM stores) AS stores, (SELECT count(*) FROM categories) AS categories',
    );
    expect(counts).toEqual({ stores: 13, categories: 15 });
    const [costco] = await all<{ name: string }>(`SELECT name FROM stores WHERE adapter = 'costco_mx'`);
    expect(costco?.name).toBe('Costco Puebla');
  });

  it('uses the store names that receipt matching expects (09 §5.4)', async () => {
    const stores = await all<{ id: string; name: string }>('SELECT id, name FROM stores');
    const idOf = (name: string) => stores.find((s) => s.name === name)?.id;
    expect(matchStoreName('WALMART SUPERCENTER PUEBLA', stores)).toBe(idOf('Walmart'));
    expect(matchStoreName("SAM'S CLUB", stores)).toBe(idOf("Sam's Club"));
    expect(matchStoreName('MI BODEGA AURRERA', stores)).toBe(idOf('Bodega Aurrera'));
    expect(matchStoreName('FARMACIA GUADALAJARA', stores)).toBe(idOf('Farmacias Guadalajara'));
  });
});
