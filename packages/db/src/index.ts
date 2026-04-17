import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

// Para Supabase, usar o connection pooler (porta 6543) com prepare: false
const client = postgres(url, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
export type Database = typeof db;
