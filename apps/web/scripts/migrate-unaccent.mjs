// Habilita a extensão unaccent — busca sem acentos nas telas de pesquisa (produtos etc.).
// Migracao manual (journal drizzle congelado — ver CLAUDE.md/memorias).
// Rodar: node --env-file=.env scripts/migrate-unaccent.mjs (de apps/web)
import postgres from 'postgres'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
const sql = postgres(url, { max: 1, prepare: false })

// Supabase instala extensões no schema "extensions" — o app chama extensions.unaccent(...)
await sql`CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions`

const [{ ok }] = await sql`SELECT extensions.unaccent('açaí é ótimo') = 'acai e otimo' AS ok`
console.log('unaccent funcionando:', ok)
await sql.end()
