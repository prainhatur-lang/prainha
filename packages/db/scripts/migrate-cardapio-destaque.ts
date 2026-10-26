// cardapio_destaque: card no topo do cardápio do QR da mesa — "Almoço
// executivo" (Bar e Mar), "Almoço convidativo" (Tabuará), "Happy hour".
// Diz os DIAS e a HORA em que vale e liga os itens que o cliente pede.
// Só aparece no QR com `mostrar = true` (a chave "colocar no cardápio").
//
// Semente (26/10/2026): Mar com o horário que já roda nos combos
// (almoço 1722 seg–sex 11–15, happy hour 900023 seg–sex 17–19) já ligada;
// Bar e Tabuará DESLIGADAS até o dono conferir os dias.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cardapio-destaque

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const TAB = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS cardapio_destaque (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      titulo text NOT NULL,
      texto text,
      dias_semana smallint[] NOT NULL DEFAULT '{}',
      hora_inicio time,
      hora_fim time,
      codigos integer[] NOT NULL DEFAULT '{}',
      mostrar boolean NOT NULL DEFAULT false,
      ordem integer NOT NULL DEFAULT 0,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cardapio_destaque_filial ON cardapio_destaque (filial_id)`);
  await sql.unsafe(`ALTER TABLE cardapio_destaque ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] cardapio_destaque pronta');

  // itens executivos da Tabuará que estão no cardápio digital
  const tab = await sql<{ c: number }[]>`
    SELECT v.codigo_externo AS c FROM produto_variante v JOIN produto p ON p.id = v.produto_id
     WHERE v.filial_id = ${TAB} AND v.data_delete IS NULL AND v.cardapio_digital
       AND p.nome ILIKE '%- Executivo' AND COALESCE(v.preco_venda, 0) > 0
     ORDER BY p.nome`;

  const semente: Array<{ f: string; titulo: string; texto: string | null; dias: number[]; ini: string; fim: string; cods: number[]; mostrar: boolean; ordem: number }> = [
    { f: MAR, titulo: 'Almoço executivo', texto: null, dias: [1, 2, 3, 4, 5], ini: '11:00', fim: '15:00', cods: [1722], mostrar: true, ordem: 1 },
    { f: MAR, titulo: 'Happy hour', texto: null, dias: [1, 2, 3, 4, 5], ini: '17:00', fim: '19:00', cods: [900023], mostrar: true, ordem: 2 },
    { f: BAR, titulo: 'Almoço executivo', texto: null, dias: [1, 2, 3, 4, 5], ini: '11:00', fim: '15:00', cods: [2757], mostrar: false, ordem: 1 },
    { f: TAB, titulo: 'Almoço convidativo', texto: null, dias: [1, 2, 3, 4, 5], ini: '11:00', fim: '15:00', cods: tab.map((x) => Number(x.c)), mostrar: false, ordem: 1 },
  ];
  for (const s of semente) {
    const [ja] = await sql`SELECT 1 FROM cardapio_destaque WHERE filial_id = ${s.f} AND titulo = ${s.titulo}`;
    if (ja) continue;
    await sql`
      INSERT INTO cardapio_destaque (filial_id, titulo, texto, dias_semana, hora_inicio, hora_fim, codigos, mostrar, ordem, atualizado_por)
      VALUES (${s.f}, ${s.titulo}, ${s.texto}, ${'{' + s.dias.join(',') + '}'}::smallint[], ${s.ini}::time, ${s.fim}::time,
              ${'{' + s.cods.join(',') + '}'}::int[], ${s.mostrar}, ${s.ordem}, 'migrate-cardapio-destaque')`;
    console.log('[ok] semente', s.titulo, s.f.slice(0, 8), s.cods.length, 'itens');
  }

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
