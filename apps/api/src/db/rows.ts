import type { users } from './schema';

/** Row types inferred from the Drizzle schema. */
export type UserRow = typeof users.$inferSelect;
