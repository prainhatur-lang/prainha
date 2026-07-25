// Cria a tabela reserva_alteracao (auditoria de alteracoes de reserva).
// Migracao manual (journal drizzle congelado — ver CLAUDE.md/memorias).
// Rodar: node --env-file=.env scripts/migrate-reserva-alteracao.mjs
import postgres from 'postgres'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
const sql = postgres(url, { max: 1, prepare: false })

await sql`
  CREATE TABLE IF NOT EXISTS reserva_alteracao (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reserva_id uuid NOT NULL REFERENCES reserva(id) ON DELETE CASCADE,
    campo varchar(30) NOT NULL,
    valor_anterior text,
    valor_novo text,
    autor_tipo varchar(12) NOT NULL,
    autor_nome varchar(160),
    autor_id uuid,
    criado_em timestamptz NOT NULL DEFAULT now()
  )
`
await sql`CREATE INDEX IF NOT EXISTS reserva_alteracao_reserva_idx ON reserva_alteracao (reserva_id, criado_em)`
await sql`ALTER TABLE reserva_alteracao ENABLE ROW LEVEL SECURITY`

const [{ count }] = await sql`SELECT count(*) FROM reserva_alteracao`
console.log('reserva_alteracao pronta. linhas:', count)
await sql.end()
