// Migra a pausa GLOBAL legada (reservaConfig.pausada=true) pra uma exceção de
// calendário fechado=true no dia de hoje, e desliga a flag global — o novo
// botão "Pausar reservas" na tela /reservas opera só por dia (excecoes), não
// mexe mais em `pausada`. Sem isso, uma filial com pausada=true ficaria
// travada pra sempre (não tem mais UI que desliga esse campo).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:pausa-por-dia

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const hoje = hojeBr();
  const rows = await sql`SELECT id, nome, reserva_config FROM filial WHERE reserva_config IS NOT NULL`;
  for (const f of rows) {
    const cfg = f.reserva_config as Record<string, unknown> | null;
    if (!cfg || cfg.pausada !== true) continue;
    const excecoesAtuais = (cfg.excecoes as Array<{ data: string; fechado?: boolean }>) ?? [];
    const jaTemHoje = excecoesAtuais.some((e) => e.data === hoje && e.fechado);
    const excecoes = jaTemHoje ? excecoesAtuais : [...excecoesAtuais.filter((e) => e.data !== hoje), { data: hoje, fechado: true }];
    const novaCfg = { ...cfg, excecoes, pausada: false };
    await sql`UPDATE filial SET reserva_config = ${sql.json(novaCfg)} WHERE id = ${f.id}`;
    console.log(`${f.nome}: migrado — pausada global desligada, ${hoje} marcado como fechado.`);
  }
  await sql.end();
  console.log('Migration pausa-por-dia concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
