// Histórico de faturamento (VGV): tabelas + permissão do dono + unidades +
// importação da planilha de vendas passadas (fim.xlsx, 06/10/2026).
//
// Regras da importação (conferidas mês a mês contra a tabela `pedido`):
//   - Prainha Bar mar/2019 → nov/2022: o PDV da época não gravava o total do
//     pedido (valor_total NULL), então o mês fechado vem da planilha (TOTAL).
//   - De dez/2022 em diante (Bar) e de abr/2025 (Tabuará) o número é o do PDV,
//     ao vivo. Onde a planilha está ACIMA do PDV, a diferença são eventos e
//     festas vendidos fora do PDV → entra separado (EXTRA), pra dar pra ver o
//     VGV com e sem eventos. Diferença de centavos (< R$ 1) fica com o PDV.
//   - AquaArena e Lara X não rodam no sistema: tudo digitado (TOTAL). Zero
//     escrito na planilha entra como zero; célula em branco fica em branco.
//   - NÃO entra: Tabuará ago/2026 (146.633,83 é o total de setembro, digitado
//     na linha errada), Prainha Mar set/2026 (600 arredondado; o PDV tem
//     611,60), as despesas da Lara X e a Planilha2 (ingressos do Arraiá).
//
// Idempotente: CREATE ... IF NOT EXISTS, ON CONFLICT DO NOTHING, e a planilha
// entra uma vez só por unidade (marca `planilha_em`) — rodar de novo não
// ressuscita o que o dono apagou nem desfaz o que ele corrigiu na tela.
//
// Mês fechado (TOTAL) é um só por unidade/mês; evento/festa (EXTRA) pode ter
// vários no mesmo mês — por isso a unicidade é um índice parcial só do TOTAL.
//
// Uso: pnpm --filter @concilia/db migrate:faturamento-historico

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false, ssl: 'require' });

const FILIAL_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const FILIAL_TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const FILIAL_MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';

/** null = célula em branco na planilha (não importa). Índice 0 = janeiro. */
type Ano = Array<number | null>;
const _ = null;

const UNIDADES: Array<{
  nome: string;
  filialId: string | null;
  sistemaDesde: string | null;
  ordem: number;
  planilha: Record<number, Ano>;
}> = [
  {
    nome: 'Prainha Bar',
    filialId: FILIAL_BAR,
    sistemaDesde: '2022-12-01',
    ordem: 1,
    planilha: {
      2019: [_, _, 66542, 81369, 102494, 52731, 43295, 47764, 95793, 104278, 165668, 196657],
      2020: [303473.33, 236350.02, 107663.21, 22330.2, 40869.04, 51148.2, 58726.17, 190227.72, 282735.81, 426208.83, 454862.33, 650452.66],
      2021: [755516.34, 538232.06, 111187.4, 169217.04, 200552.19, 381166.52, 436059.51, 598871.63, 652259.1, 740807.24, 524890.99, 546930.55],
      2022: [785301.29, 514267.25, 403603.61, 396218.25, 194932.26, 173633.14, 346940.72, 255453.84, 365451.58, 457819.76, 376087.25, 573970.43],
      2023: [745720.91, 438727.8, 311227.62, 432368.35, 199101.23, 734972.52, 328017.29, 281442.31, 432845.97, 468812.02, 529116.74, 695472.5],
      2024: [824889.41, 499971.91, 473968.96, 285908.46, 326253.01, 825700, 611740.52, 429925.17, 548116.73, 576514.88, 671824.52, 916335.46],
      2025: [1081461.48, 461026.32, 765419.09, 534935.52, 248621.31, 279746.25, 419787.79, 378066.94, 331641.47, 416275.36, 558478.22, 811856.49],
      2026: [1104923.42, 449047.26, 370963.41, 365892.78, 262048.69, 222669.08, 321331.94, 285650.16, 400281.91, _, _, _],
    },
  },
  {
    nome: 'Tabuará',
    filialId: FILIAL_TABUARA,
    sistemaDesde: '2025-04-01',
    ordem: 2,
    planilha: {
      2025: [_, _, _, 132908, 318917.85, 325950.99, 301727.78, 276838.24, 214198.49, 181442.05, 172899.34, 215377.57],
      // jul em branco e ago com o total de setembro na planilha → ficam com o PDV.
      2026: [156101.66, 146508.11, 167510.07, 202727.28, 196956.88, 221743.02, _, _, _, _, _, _],
    },
  },
  {
    nome: 'Prainha Mar',
    filialId: FILIAL_MAR,
    sistemaDesde: '2026-09-01',
    ordem: 3,
    planilha: {},
  },
  {
    nome: 'AquaArena',
    filialId: null,
    sistemaDesde: null,
    ordem: 4,
    planilha: {
      2024: [_, _, _, _, 5650, 20120, 40875, 24826, 31100, 40165, 34925, 62835],
      2025: [92901, 20780, 40830, 29054.54, 10810, 13880, 41450, 25500, 13966, 29211, 31000, 64970],
      2026: [100940, 33870, 14540, _, _, _, _, _, _, _, _, _],
    },
  },
  {
    nome: 'Lara X',
    filialId: null,
    sistemaDesde: null,
    ordem: 5,
    planilha: {
      2024: [_, _, _, _, _, _, _, _, _, _, _, 3000],
      2025: [2850, 1300, 6750, 1800, 450, 2250, 1500, 2550, 2950, 4750, 5250, 3400],
      2026: [2600, 1350, 1350, 0, 0, 0, _, _, _, _, _, _],
    },
  },
];

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ym = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`;

async function main() {
  // ---------- 1. Tabelas ----------
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS faturamento_unidade (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      nome varchar(80) NOT NULL,
      filial_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      sistema_desde date,
      ordem integer NOT NULL DEFAULT 0,
      ativa boolean NOT NULL DEFAULT true,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_faturamento_unidade_nome UNIQUE (organizacao_id, nome)
    )
  `);
  await sql.unsafe(`ALTER TABLE faturamento_unidade ADD COLUMN IF NOT EXISTS planilha_em timestamptz`);
  await sql.unsafe(`ALTER TABLE faturamento_unidade ADD COLUMN IF NOT EXISTS encerrada_desde date`);
  await sql.unsafe(`ALTER TABLE faturamento_unidade ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] faturamento_unidade pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS faturamento_lancamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      unidade_id uuid NOT NULL REFERENCES faturamento_unidade(id) ON DELETE CASCADE,
      ano integer NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
      mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
      tipo varchar(10) NOT NULL CHECK (tipo IN ('TOTAL', 'EXTRA')),
      valor numeric(14,2) NOT NULL CHECK (valor >= 0),
      observacao text,
      origem varchar(20) NOT NULL DEFAULT 'manual',
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  // 1ª versão (06/10) travava um EXTRA por mês — dois eventos no mesmo mês se
  // sobrescreviam. Sai a constraint, entra o índice parcial só do TOTAL.
  await sql.unsafe(`ALTER TABLE faturamento_lancamento DROP CONSTRAINT IF EXISTS uq_faturamento_lancamento`);
  await sql.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_faturamento_lancamento_total ON faturamento_lancamento (unidade_id, ano, mes) WHERE tipo = 'TOTAL'`,
  );
  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_faturamento_lancamento_unidade ON faturamento_lancamento (unidade_id, ano, mes)`,
  );
  await sql.unsafe(`ALTER TABLE faturamento_lancamento ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] faturamento_lancamento pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS faturamento_acesso (
      organizacao_id uuid PRIMARY KEY REFERENCES organizacao(id) ON DELETE CASCADE,
      senha_hash text NOT NULL,
      senha_salt text NOT NULL,
      segredo text NOT NULL,
      tentativas integer NOT NULL DEFAULT 0,
      bloqueado_ate timestamptz,
      definida_por uuid,
      definida_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`ALTER TABLE faturamento_acesso ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] faturamento_acesso pronta');

  // ---------- 2. Permissão — só o grupo Admin (dono) ----------
  await sql`
    INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
    VALUES (
      'faturamento_historico.read', 'faturamento_historico', 'read',
      'Ver histórico de faturamento (VGV) — aba com senha do dono', 'organizacao'
    )
    ON CONFLICT (codigo) DO NOTHING
  `;
  await sql`
    INSERT INTO grupo_permissao (grupo_id, permissao_id)
    SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
     WHERE g.sistema = true AND g.nome = 'Admin'
       AND p.codigo = 'faturamento_historico.read'
    ON CONFLICT DO NOTHING
  `;
  const quem = await sql<Array<{ email: string; grupo: string }>>`
    SELECT DISTINCT u.email, g.nome AS grupo
      FROM grupo_permissao gp
      JOIN permissao p ON p.id = gp.permissao_id
      JOIN grupo_usuario g ON g.id = gp.grupo_id
      JOIN usuario_grupo ug ON ug.grupo_id = g.id
      JOIN usuario u ON u.id = ug.usuario_id
     WHERE p.codigo = 'faturamento_historico.read'
     ORDER BY 1
  `;
  console.log(
    `[ok] permissão faturamento_historico.read — quem tem: ${quem.map((q) => `${q.email} (${q.grupo})`).join(', ') || 'ninguém'}`,
  );

  // ---------- 3. Unidades + planilha ----------
  const [org] = await sql<Array<{ organizacao_id: string }>>`
    SELECT organizacao_id FROM filial WHERE id = ${FILIAL_BAR}::uuid
  `;
  if (!org) throw new Error('filial Prainha Bar não encontrada');
  const orgId = org.organizacao_id;

  await sql.begin(async (tx) => {
    for (const u of UNIDADES) {
      await tx`
        INSERT INTO faturamento_unidade (organizacao_id, nome, filial_id, sistema_desde, ordem)
        VALUES (${orgId}::uuid, ${u.nome}, ${u.filialId}::uuid, ${u.sistemaDesde}::date, ${u.ordem})
        ON CONFLICT (organizacao_id, nome) DO NOTHING
      `;
      const [row] = await tx<Array<{ id: string; importada: boolean }>>`
        SELECT id, planilha_em IS NOT NULL AS importada
          FROM faturamento_unidade WHERE organizacao_id = ${orgId}::uuid AND nome = ${u.nome}
      `;
      const unidadeId = row.id;

      // Quem tem linha de origem 'planilha' e ainda não tem a marca foi
      // importado antes de a marca existir (1ª rodada, 06/10).
      const [{ n }] = await tx<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM faturamento_lancamento
         WHERE unidade_id = ${unidadeId}::uuid AND origem = 'planilha'
      `;
      if (row.importada || n > 0) {
        if (!row.importada) {
          await tx`UPDATE faturamento_unidade SET planilha_em = now() WHERE id = ${unidadeId}::uuid`;
        }
        console.log(`[--] ${u.nome}: planilha já importada (${n} linhas dela ainda no banco) — pulei`);
        continue;
      }

      // O que o PDV tem por mês (mesmo critério da tela), no fuso de Brasília.
      const sistema = new Map<string, number>();
      if (u.filialId) {
        const linhas = await tx<Array<{ ym: string; total: string | null }>>`
          SELECT to_char((p.data_fechamento AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM') AS ym,
                 sum(p.valor_total)::text AS total
            FROM pedido p
           WHERE p.filial_id = ${u.filialId}::uuid
             AND p.data_delete IS NULL
             AND p.data_fechamento IS NOT NULL
           GROUP BY 1
        `;
        for (const l of linhas) sistema.set(l.ym, Number(l.total ?? 0));
      }

      let totais = 0;
      let extras = 0;
      for (const [anoTxt, meses] of Object.entries(u.planilha)) {
        const ano = Number(anoTxt);
        for (let i = 0; i < 12; i++) {
          const valor = meses[i];
          if (valor === null || valor === undefined) continue;
          const mes = i + 1;
          const chave = ym(ano, mes);
          const cobertoPeloPdv =
            u.filialId !== null && u.sistemaDesde !== null && `${chave}-01` >= u.sistemaDesde;

          if (!cobertoPeloPdv) {
            await tx`
              INSERT INTO faturamento_lancamento (unidade_id, ano, mes, tipo, valor, observacao, origem)
              VALUES (${unidadeId}::uuid, ${ano}, ${mes}, 'TOTAL', ${valor.toFixed(2)}, NULL, 'planilha')
              ON CONFLICT (unidade_id, ano, mes) WHERE tipo = 'TOTAL' DO NOTHING
            `;
            totais++;
            continue;
          }

          const pdv = sistema.get(chave) ?? 0;
          const dif = Math.round((valor - pdv) * 100) / 100;
          if (dif >= 1) {
            await tx`
              INSERT INTO faturamento_lancamento (unidade_id, ano, mes, tipo, valor, observacao, origem)
              VALUES (
                ${unidadeId}::uuid, ${ano}, ${mes}, 'EXTRA', ${dif.toFixed(2)},
                ${`Eventos e festas — a planilha tinha ${brl(valor)} e o PDV ${brl(pdv)}`},
                'planilha'
              )
            `;
            extras++;
            console.log(`     ${u.nome} ${chave}: evento/festa +${brl(dif)} (planilha ${brl(valor)} · PDV ${brl(pdv)})`);
          } else if (dif <= -1) {
            // Planilha ABAIXO do PDV: não é evento; fica o PDV e avisa.
            console.log(`  !! ${u.nome} ${chave}: planilha ${brl(valor)} MENOR que o PDV ${brl(pdv)} — fica o PDV`);
          }
        }
      }
      await tx`UPDATE faturamento_unidade SET planilha_em = now() WHERE id = ${unidadeId}::uuid`;
      console.log(`[ok] ${u.nome}: ${totais} meses fechados da planilha, ${extras} meses com evento/festa`);
    }
  });

  // ---------- 4. Conferência: VGV por ano (PDV + lançado) ----------
  const conf = await sql<Array<{ ano: number; pdv: string; lancado: string; extra: string }>>`
    WITH pdv AS (
      SELECT u.id AS unidade_id,
             to_char((p.data_fechamento AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM') AS ym,
             sum(p.valor_total) AS total
        FROM faturamento_unidade u
        JOIN pedido p ON p.filial_id = u.filial_id
       WHERE u.organizacao_id = ${orgId}::uuid
         AND p.data_delete IS NULL AND p.data_fechamento IS NOT NULL
         AND p.data_fechamento >= (u.sistema_desde::text || ' 00:00:00-03')::timestamptz
       GROUP BY 1, 2
    ), anos AS (
      SELECT left(ym, 4)::int AS ano, sum(total) AS pdv, 0::numeric AS lancado, 0::numeric AS extra FROM pdv GROUP BY 1
      UNION ALL
      SELECT l.ano, 0, sum(l.valor) FILTER (WHERE l.tipo = 'TOTAL'), sum(l.valor) FILTER (WHERE l.tipo = 'EXTRA')
        FROM faturamento_lancamento l
        JOIN faturamento_unidade u ON u.id = l.unidade_id
       WHERE u.organizacao_id = ${orgId}::uuid
       GROUP BY 1
    )
    SELECT ano, sum(pdv)::text AS pdv, coalesce(sum(lancado), 0)::text AS lancado, coalesce(sum(extra), 0)::text AS extra
      FROM anos GROUP BY 1 ORDER BY 1
  `;
  console.log('\nVGV por ano (PDV + meses lançados + eventos):');
  for (const c of conf) {
    const total = Number(c.pdv) + Number(c.lancado) + Number(c.extra);
    console.log(
      `  ${c.ano}: ${brl(total).padStart(14)}   (PDV ${brl(Number(c.pdv))} · lançado ${brl(Number(c.lancado))} · eventos ${brl(Number(c.extra))})`,
    );
  }
  console.log('  planilha (Vendas Totais): 2024 = 7.254.645,03 · 2025 = 8.877.729,09');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
