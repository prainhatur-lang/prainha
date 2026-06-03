// Registra as mesas fisicas (numero + capacidade) nos espacos do Prainha Bar.
// Mescla em filial.reserva_config.areas[].mesas sem perder os outros campos.
// Idempotente. Uso: pnpm --filter @concilia/db tsx scripts/migrate-mesas-prainha.ts

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import type { ReservaConfig, MesaReserva } from '../src/schema/tenant';

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { prepare: false });

const m = (numero: number | string, lugares: number): MesaReserva => ({ numero: String(numero), lugares });
const range = (de: number, ate: number, lugares: number) => {
  const out: MesaReserva[] = [];
  for (let n = de; n <= ate; n++) out.push(m(n, lugares));
  return out;
};

// === AREIA (madeira) + extensao plastico ===
const AREIA: MesaReserva[] = [
  ...range(1, 4, 4),
  m(5, 8), m(6, 8), m(7, 8), m(8, 6),
  ...range(9, 16, 4),
  ...range(17, 20, 6),
  ...range(21, 24, 8),
  ...range(25, 31, 4), // 32 nao existe
  m(33, 4),
  ...range(34, 40, 6), // 41 nao existe
  m(42, 8),
  ...range(43, 48, 4),
  ...range(111, 113, 4),
  ...range(114, 125, 4), // plastico (extensao)
];

// === DECK SUPERIOR (areia superior) ===
const DECK: MesaReserva[] = [
  m(101, 12), // vidro
  m(102, 4), m(103, 4), // 104 nao existe
  ...range(105, 110, 4),
];

// === LOUNGES ===
const LOUNGES: MesaReserva[] = [m(128, 12), m(129, 12), m(130, 12)];

const POR_AREA: Record<string, MesaReserva[]> = {
  Areia: AREIA,
  'Deck Superior': DECK,
  Lounges: LOUNGES,
};

async function main() {
  const [fil] = await sql<Array<{ id: string; reserva_config: ReservaConfig | null }>>`
    SELECT id, reserva_config FROM filial WHERE nome ILIKE '%Prainha Bar%' LIMIT 1
  `;
  if (!fil) throw new Error('Prainha Bar nao encontrada');
  const cfg: ReservaConfig = fil.reserva_config ?? { areas: [] };

  cfg.areas = (cfg.areas ?? []).map((a) => {
    const mesas = POR_AREA[a.nome];
    return mesas ? { ...a, mesas } : a;
  });

  await sql`UPDATE filial SET reserva_config = ${sql.json(cfg)} WHERE id = ${fil.id}`;

  console.log('OK — mesas registradas no Prainha Bar:');
  for (const a of cfg.areas) {
    if (a.mesas) {
      const lugares = a.mesas.reduce((s, x) => s + x.lugares, 0);
      console.log(`  ${a.nome}: ${a.mesas.length} mesas, ${lugares} lugares`);
    }
  }
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
