// Fornecedores repetidos na mesma casa (04/11/2026): mesmo nome (sem acento/caixa)
// ou mesmo CPF/CNPJ. Escolhe o que fica e unifica — histórico vai junto.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { GruposRepetidos, type Linha } from './grupos';

export const dynamic = 'force-dynamic';

export default async function RepetidosPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'fornecedor.read');
  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/cadastros/fornecedores');
  const filial = escolhida;

  const rows = (await db.execute(sql`
    WITH f AS (
      SELECT id, nome, cnpj_ou_cpf, codigo_externo,
        lower(unaccent(regexp_replace(trim(coalesce(nome, '')), '\s+', ' ', 'g'))) AS k_nome,
        nullif(regexp_replace(coalesce(cnpj_ou_cpf, ''), '\D', '', 'g'), '') AS k_doc
      FROM fornecedor WHERE filial_id = ${filial.id} AND data_delete IS NULL
    ),
    rep AS (
      SELECT id FROM f WHERE k_nome <> '' AND k_nome IN (SELECT k_nome FROM f GROUP BY 1 HAVING count(*) > 1)
      UNION
      SELECT id FROM f WHERE k_doc IN (SELECT k_doc FROM f WHERE k_doc IS NOT NULL GROUP BY 1 HAVING count(*) > 1)
    )
    SELECT f.id, f.nome, f.cnpj_ou_cpf AS doc, f.codigo_externo AS codigo, f.k_nome, f.k_doc,
      (SELECT count(*)::int FROM conta_pagar c WHERE c.fornecedor_id = f.id AND c.data_delete IS NULL) AS contas,
      (SELECT count(*)::int FROM nota_compra n WHERE n.fornecedor_id = f.id) AS notas,
      (SELECT max(c.data_vencimento)::text FROM conta_pagar c WHERE c.fornecedor_id = f.id AND c.data_delete IS NULL) AS ultima,
      EXISTS (SELECT 1 FROM fornecedor_folha x WHERE x.fornecedor_id = f.id) OR
      EXISTS (SELECT 1 FROM funcionario x WHERE x.fornecedor_id = f.id) AS rh
    FROM f WHERE f.id IN (SELECT id FROM rep)
  `)) as unknown as (Linha & { k_nome: string; k_doc: string | null })[];

  // junta em grupos: mesmo nome OU mesmo documento (união dos dois)
  const pai = new Map<string, string>();
  const achar = (x: string): string => {
    const p = pai.get(x) ?? x;
    if (p === x) return x;
    const r = achar(p);
    pai.set(x, r);
    return r;
  };
  const unir = (a: string, b: string) => pai.set(achar(a), achar(b));
  const porChave = new Map<string, string>();
  for (const r of rows) {
    pai.set(r.id, r.id);
    for (const k of [r.k_nome ? `n:${r.k_nome}` : null, r.k_doc ? `d:${r.k_doc}` : null]) {
      if (!k) continue;
      const outro = porChave.get(k);
      if (outro) unir(r.id, outro);
      else porChave.set(k, r.id);
    }
  }
  const grupos = new Map<string, Linha[]>();
  for (const r of rows) {
    const g = achar(r.id);
    const l: Linha = { id: r.id, nome: r.nome, doc: r.doc, codigo: r.codigo, contas: r.contas, notas: r.notas, ultima: r.ultima, rh: r.rh };
    grupos.set(g, [...(grupos.get(g) ?? []), l]);
  }
  const lista = [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => b.contas + b.notas - (a.contas + a.notas)))
    .sort((a, b) => (a[0]!.nome ?? '').localeCompare(b[0]!.nome ?? '', 'pt-BR'));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Link href={`/cadastros/fornecedores?filialId=${filial.id}`} className="text-xs text-slate-500 hover:underline">
          ← Fornecedores
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Fornecedores repetidos — {filial.nome}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Mesmo nome (sem contar acento e maiúscula) ou mesmo CPF/CNPJ na mesma casa. Marque o que
          fica e clique em <b>Unificar</b>: contas, notas, pedidos, folha, Pix e cotações passam pro que
          fica, e ele completa o que faltar (CPF, Pix, banco, telefone). O outro some das listas, mas
          não é apagado.
        </p>
        {filiais.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/fornecedores/repetidos?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}
        <GruposRepetidos grupos={lista} />
      </div>
    </main>
  );
}
