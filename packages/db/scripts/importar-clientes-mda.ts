// Importa nomes ja consultados no SPC pelo projeto "Melhores do Ano" (CDL)
// para a base de clientes do grupo Prainha.
//
// POR QUE: quando o cliente digita o proprio CPF na mesa, o sistema iria ao
// SPC (consulta paga) so pra descobrir o nome. Se aquele CPF ja foi consultado
// e pago uma vez no outro projeto, nao ha razao pra pagar de novo.
//
// O CPF EM CLARO NUNCA APARECE AQUI: os dois lados usam sha256(HASH_SALT::cpf),
// entao da pra casar os registros pelo hash e nada mais. Rode com o MESMO
// HASH_SALT do Melhores do Ano, senao os hashes nao batem com os da loja.
//
// Descarta as respostas em que o SPC devolveu STATUS no lugar do nome
// ("Cpf Nao Existe Na Base Recfederal...") — vira lixo no cadastro.
//
// Idempotente: reexecutar so atualiza.
// Uso: pnpm --filter @concilia/db importar:clientes-mda [--dry]

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const ORG = process.env.ORG_PRAINHA ?? 'a7238ba3-b150-4fb5-aa37-a895866df03f';
const MDA_ENV = process.env.MDA_ENV_PATH ?? '/Volumes/PortableSSD/Aplicativos/Melhores do ano 2/.env.local';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

function lerEnv(caminho: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(caminho, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** O SPC devolve o status do CPF no campo `nome`. Isso nao e' nome de gente. */
function ehStatusNaoNome(nome: string): boolean {
  const n = semAcento(nome);
  if (/\d/.test(n)) return true;
  if (n.split(/\s+/).length > 7) return true;
  return /\bcpf\b|nao existe|nao consta|nao localizad|situacao|regulariz|cancelad|suspens|falecid|inexistent|\bnula\b|\bpendente\b/.test(n);
}

async function main() {
  const env = lerEnv(MDA_ENV);
  const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) throw new Error('credenciais do Melhores do Ano nao encontradas em ' + MDA_ENV);

  console.log(DRY ? '== SIMULACAO (nada sera gravado) ==' : '== IMPORTANDO ==');

  const PAGINA = 1000;
  let de = 0, lidos = 0, descartados = 0, gravados = 0;

  for (;;) {
    const r = await fetch(
      `${supaUrl}/rest/v1/spc_cache?select=cpf_hash,nome&order=cpf_hash&limit=${PAGINA}&offset=${de}`,
      { headers: { apikey: supaKey, authorization: `Bearer ${supaKey}` } },
    );
    if (!r.ok) throw new Error(`Supabase do MDA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const linhas = (await r.json()) as Array<{ cpf_hash: string; nome: string | null }>;
    if (!linhas.length) break;
    lidos += linhas.length;

    const bons = linhas
      .filter((x) => x.cpf_hash && x.nome && !ehStatusNaoNome(x.nome))
      .map((x) => ({
        organizacao_id: ORG,
        cpf_hash: x.cpf_hash,
        nome: x.nome!.trim().slice(0, 160),
        origem: 'importacao',
      }));
    descartados += linhas.length - bons.length;

    if (bons.length && !DRY) {
      // nao sobrescreve nome que a operacao ja tenha corrigido na mao:
      // so preenche quem ainda esta como 'importacao'
      await sql`
        INSERT INTO cliente_documento ${sql(bons, 'organizacao_id', 'cpf_hash', 'nome', 'origem')}
        ON CONFLICT (organizacao_id, cpf_hash) DO UPDATE
          SET nome = EXCLUDED.nome, atualizado_em = now()
          WHERE cliente_documento.origem = 'importacao'`;
    }
    gravados += bons.length;

    de += PAGINA;
    if (de % 10000 === 0) console.log(`  ${lidos} lidos · ${gravados} aproveitados · ${descartados} descartados`);
  }

  console.log(`\n  lidos no Melhores do Ano : ${lidos}`);
  console.log(`  descartados (status/vazio): ${descartados}`);
  console.log(`  ${DRY ? 'seriam gravados' : 'gravados'}          : ${gravados}`);

  // ---- 2a passada: WhatsApp dos votantes ----
  // A tabela `votantes` tem o CPF em claro; usamos SO o cpf_hash pra casar.
  // Guardamos os ultimos 8 digitos, que e' o que a busca da loja compara
  // (DDD e o 9 extra variam conforme quem cadastrou).
  console.log('\n== telefones ==');
  let tLidos = 0, tGravados = 0;
  de = 0;
  for (;;) {
    const r = await fetch(
      `${supaUrl}/rest/v1/votantes?select=cpf_hash,whatsapp&whatsapp=not.is.null&order=cpf_hash&limit=${PAGINA}&offset=${de}`,
      { headers: { apikey: supaKey, authorization: `Bearer ${supaKey}` } },
    );
    if (!r.ok) throw new Error(`votantes: HTTP ${r.status}`);
    const linhas = (await r.json()) as Array<{ cpf_hash: string; whatsapp: string | null }>;
    if (!linhas.length) break;
    tLidos += linhas.length;

    // UM update por pagina, nao por linha: 18 mil queries individuais esgotam
    // as portas do sistema (EADDRNOTAVAIL) antes de terminar.
    const pares = linhas
      .map((x) => ({ h: x.cpf_hash, t: String(x.whatsapp || '').replace(/\D/g, '').slice(-8) }))
      .filter((x) => x.h && x.t.length === 8);
    if (pares.length && !DRY) {
      // so preenche quem ainda nao tem telefone — nao sobrescreve o que a
      // propria pessoa informou no balcao
      const upd = await sql`
        UPDATE cliente_documento c
           SET telefone_fim = v.t, atualizado_em = now()
          FROM (VALUES ${sql(pares.map((x) => [x.h, x.t]))}) AS v(h, t)
         WHERE c.organizacao_id = ${ORG} AND c.cpf_hash = v.h AND c.telefone_fim IS NULL`;
      tGravados += upd.count;
    } else if (DRY) tGravados += pares.length;
    de += PAGINA;
  }
  console.log(`  votantes com WhatsApp    : ${tLidos}`);
  console.log(`  ${DRY ? 'seriam casados' : 'telefones gravados'}       : ${tGravados}`);

  if (!DRY) {
    const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM cliente_documento WHERE organizacao_id = ${ORG}`;
    console.log(`  total na base do grupo    : ${n}`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
