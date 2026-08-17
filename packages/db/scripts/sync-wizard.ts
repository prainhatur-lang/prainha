// Traz o WIZARD do Consumer (perguntas de acompanhamento) pro espelho.
// Precisa de rede até o Firebird da loja (VPN ou estar na rede dela).
//
//   pnpm --filter @concilia/db sync:wizard -- --host 10.0.0.252
//
// As três tabelas, e por que cada uma importa:
//   WIZARDPERGUNTAS  a pergunta + QTDRESPOSTASMIN/MAX (escolha 1, até 3...)
//   WIZARDOPCOES     as opções, com PRECOPROMO (preço quando vai junto do
//                    prato — o "custa 10, sai por 1") e opcionalmente um
//                    CODIGOPRODUTODETALHE, que faz a opção LANÇAR um produto
//                    filho em vez de ser só observação
//   WIZARD           liga produto -> pergunta (carne do sol -> acompanhamento)

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import Firebird from 'node-firebird';

const args = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const HOST = arg('host', '10.0.0.252')!;
const FILIAL = arg('filial', '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9')!;

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const FB = {
  host: HOST,
  port: 3050,
  database:
    process.env.FB_DATABASE ||
    'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  user: process.env.FB_USER || 'SYSDBA',
  password: process.env.FB_PASSWORD || 'masterkey',
  lowercase_keys: false,
  pageSize: 4096,
};

function fb<T = Record<string, unknown>>(consulta: string): Promise<T[]> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout em ${HOST}:3050 — VPN ligada?`)), 20000);
    Firebird.attach(FB, (err, db) => {
      clearTimeout(t);
      if (err) return rej(err);
      db.query(consulta, [], (e: Error | null, rows: T[]) => {
        db.detach();
        if (e) return rej(e);
        res(rows);
      });
    });
  });
}

const N = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
const T2 = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? null : String(v).trim());

async function main() {
  console.log(`Lendo WIZARD de ${HOST}...`);

  const perguntas = await fb(`SELECT CODIGO, TRIM(DESCRICAO) D, QTDRESPOSTASMIN MN, QTDRESPOSTASMAX MX
      FROM WIZARDPERGUNTAS WHERE DATADELETE IS NULL`);
  const opcoes = await fb(`SELECT o.CODIGO, o.CODIGOWIZARDPERGUNTA PERG, o.PRECOPROMO PR,
        o.CODIGOPRODUTODETALHE PD,
        TRIM(COALESCE(NULLIF(TRIM(o.DESCRICAO),''), NULLIF(TRIM(o.OBSERVACAO),''), p.NOME)) NOME
      FROM WIZARDOPCOES o
      LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO = o.CODIGOPRODUTODETALHE
      LEFT JOIN PRODUTOS p ON p.CODIGO = pd.CODIGOPRODUTO
      WHERE o.DATADELETE IS NULL`);
  const ligacoes = await fb(`SELECT CODIGOPRODUTODETALHE PDV, CODIGOWIZARDPERGUNTA PERG, ORDEM
      FROM WIZARD WHERE DATADELETE IS NULL`);

  console.log(`  ${perguntas.length} perguntas · ${opcoes.length} opções · ${ligacoes.length} ligações`);

  await sql`DELETE FROM wizard_opcao WHERE filial_id = ${FILIAL}`;
  await sql`DELETE FROM wizard_produto WHERE filial_id = ${FILIAL}`;
  await sql`DELETE FROM wizard_pergunta WHERE filial_id = ${FILIAL}`;

  for (const p of perguntas as Array<Record<string, unknown>>) {
    const cod = N(p.CODIGO);
    if (!cod) continue;
    await sql`
      INSERT INTO wizard_pergunta (filial_id, codigo_externo, texto, respostas_min, respostas_max)
      VALUES (${FILIAL}, ${cod}, ${T2(p.D)?.slice(0, 200) ?? null}, ${N(p.MN) ?? 0}, ${N(p.MX) ?? 0})
      ON CONFLICT (filial_id, codigo_externo) DO UPDATE
      SET texto = EXCLUDED.texto, respostas_min = EXCLUDED.respostas_min,
          respostas_max = EXCLUDED.respostas_max, sincronizado_em = now()`;
  }

  for (const o of opcoes as Array<Record<string, unknown>>) {
    const cod = N(o.CODIGO);
    const perg = N(o.PERG);
    const nome = T2(o.NOME);
    if (!cod || !perg || !nome) continue;
    await sql`
      INSERT INTO wizard_opcao (filial_id, codigo_externo, codigo_pergunta, nome, preco_promo, codigo_variante_externo)
      VALUES (${FILIAL}, ${cod}, ${perg}, ${nome.slice(0, 200)}, ${(N(o.PR) ?? 0).toFixed(2)}, ${N(o.PD)})
      ON CONFLICT (filial_id, codigo_externo) DO UPDATE
      SET codigo_pergunta = EXCLUDED.codigo_pergunta, nome = EXCLUDED.nome,
          preco_promo = EXCLUDED.preco_promo,
          codigo_variante_externo = EXCLUDED.codigo_variante_externo, sincronizado_em = now()`;
  }

  for (const l of ligacoes as Array<Record<string, unknown>>) {
    const pdv = N(l.PDV);
    const perg = N(l.PERG);
    if (!pdv || !perg) continue;
    await sql`
      INSERT INTO wizard_produto (filial_id, codigo_variante_externo, codigo_pergunta, ordem)
      VALUES (${FILIAL}, ${pdv}, ${perg}, ${N(l.ORDEM) ?? 0})
      ON CONFLICT (filial_id, codigo_variante_externo, codigo_pergunta) DO UPDATE
      SET ordem = EXCLUDED.ordem, sincronizado_em = now()`;
  }

  // Resolve os uuid das variantes (o Consumer só dá o código).
  await sql`
    UPDATE wizard_opcao o SET variante_id = pv.id FROM produto_variante pv
    WHERE o.filial_id = ${FILIAL} AND pv.filial_id = ${FILIAL}
      AND pv.codigo_externo = o.codigo_variante_externo AND o.variante_id IS NULL`;
  await sql`
    UPDATE wizard_produto w SET variante_id = pv.id FROM produto_variante pv
    WHERE w.filial_id = ${FILIAL} AND pv.filial_id = ${FILIAL}
      AND pv.codigo_externo = w.codigo_variante_externo AND w.variante_id IS NULL`;

  const [r] = await sql`
    SELECT
      (SELECT count(*) FROM wizard_pergunta WHERE filial_id = ${FILIAL})::int perguntas,
      (SELECT count(*) FROM wizard_opcao WHERE filial_id = ${FILIAL})::int opcoes,
      (SELECT count(*) FROM wizard_opcao WHERE filial_id = ${FILIAL} AND variante_id IS NOT NULL)::int opcoes_com_produto,
      (SELECT count(DISTINCT variante_id) FROM wizard_produto WHERE filial_id = ${FILIAL} AND variante_id IS NOT NULL)::int produtos_com_pergunta`;
  console.log(`\nEspelhado: ${JSON.stringify(r)}`);

  const amostra = await sql`
    SELECT p.texto, p.respostas_min, p.respostas_max, o.nome, o.preco_promo
    FROM wizard_pergunta p JOIN wizard_opcao o ON o.codigo_pergunta = p.codigo_externo AND o.filial_id = p.filial_id
    WHERE p.filial_id = ${FILIAL} ORDER BY p.codigo_externo, o.nome LIMIT 12`;
  console.log('\namostra:');
  for (const a of amostra) {
    console.log(`   [${a.texto ?? '(sem texto)'} ${a.respostas_min}-${a.respostas_max}] ${a.nome} — R$ ${a.preco_promo}`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error('ERRO:', (e as Error).message);
  await sql.end();
  process.exit(1);
});
