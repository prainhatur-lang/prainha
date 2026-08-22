// Cadastra as mesas físicas da Tabuará no reserva_config da filial.
//
// A casa já tinha as áreas (Salão e Varanda), mas nenhuma mesa — por isso o
// mapa não aparecia na reserva pública e o servidor não tinha o que alocar.
// Os números e a posição vêm da planta da casa:
//
//   SALÃO      ( 13 )   9  5  1
//              ( 14 )  10  6  2
//                      11  7  3
//                      12  8  4
//   ─────────────────────────────
//   VARANDA    29  27  25  23  21
//              30  28  26  24  22
//
// Lugares passados pelo dono: 1–4 com 4; 5–8 com 2 (mesas de casal, juntáveis);
// 9–12 com 4; a redonda grande (13) até 10; a redonda menor (14) até 7; e a
// varanda toda com 4.
//
// Idempotente: só escreve as mesas nas áreas que ainda não têm nenhuma —
// rodar de novo não sobrescreve ajuste feito na mão pelo painel.
//
//   pnpm --filter @concilia/db migrate:mesas-tabuara

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

loadEnv({ path: '../../.env' });

const FILIAL_TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';

const faixa = (de: number, ate: number, lugares: number) =>
  Array.from({ length: ate - de + 1 }, (_, i) => ({ numero: String(de + i), lugares, juntavel: true }));

const MESAS: Record<string, Array<{ numero: string; lugares: number; juntavel: boolean }>> = {
  'Salão': [
    ...faixa(1, 4, 4),
    ...faixa(5, 8, 2), // mesas de casal — juntáveis quando vem grupo
    ...faixa(9, 12, 4),
    { numero: '13', lugares: 10, juntavel: false }, // redonda grande
    { numero: '14', lugares: 7, juntavel: false }, // redonda menor
  ],
  'Varanda': faixa(21, 30, 4),
};

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT/DATABASE_URL ausente');
  const sql = postgres(url, { ssl: 'require' });

  try {
    const [filial] = await sql<
      { nome: string; reserva_config: { areas?: Array<{ nome: string; mesas?: unknown[] }> } | null }[]
    >`select nome, reserva_config from filial where id = ${FILIAL_TABUARA}`;
    if (!filial) throw new Error(`filial ${FILIAL_TABUARA} não encontrada`);

    const cfg = filial.reserva_config ?? {};
    const areas = cfg.areas ?? [];
    if (areas.length === 0) throw new Error('filial sem áreas em reserva_config — cadastre Salão/Varanda antes');

    let mexeu = 0;
    const novas = areas.map((a) => {
      const planta = MESAS[a.nome];
      if (!planta) return a;
      if (a.mesas && a.mesas.length > 0) {
        console.log(`  · ${a.nome}: já tem ${a.mesas.length} mesa(s) — deixando como está`);
        return a;
      }
      mexeu++;
      console.log(`  ✓ ${a.nome}: ${planta.length} mesas, ${planta.reduce((s, m) => s + m.lugares, 0)} lugares`);
      return { ...a, mesas: planta };
    });

    if (mexeu === 0) {
      console.log('Nada a fazer — as áreas já têm mesas.');
      return;
    }

    await sql`
      update filial
      set reserva_config = ${sql.json({ ...cfg, areas: novas })}
      where id = ${FILIAL_TABUARA}`;
    console.log(`\n${filial.nome}: ${mexeu} área(s) atualizada(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
