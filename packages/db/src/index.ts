import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

let _client: Sql | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient(): Sql {
  if (!_client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL nao definida');
    // Para Supabase, usar Transaction Pooler (porta 6543) com prepare: false
    _client = postgres(url, { prepare: false });
  }
  return _client;
}

/** Cliente Drizzle. Conexao lazy: so abre na primeira query. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_t, prop) {
    if (!_db) _db = drizzle(getClient(), { schema });
    return Reflect.get(_db, prop);
  },
});

export { schema };
export type Database = typeof db;
