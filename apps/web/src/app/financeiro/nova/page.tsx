// Lançamento MANUAL de conta a pagar: categoria/subcategoria do plano de
// contas, fornecedor, histórico, datas (lançamento/vencimento/pagamento) e
// status. Pagamento parcial acontece depois, na página da conta (baixas).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, ilike, isNull, not, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { NovaContaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovaContaPage(props: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.create');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = filiais.find((f) => f.id === sp.filialId) ?? filiais[0];
  if (!filial) redirect('/financeiro');

  // Plano de contas: só DESPESA, montado como pai → filhas (subcategorias).
  const cats = await db
    .select({
      id: schema.categoriaConta.id,
      codigoExterno: schema.categoriaConta.codigoExterno,
      codigoPaiExterno: schema.categoriaConta.codigoPaiExterno,
      descricao: schema.categoriaConta.descricao,
    })
    .from(schema.categoriaConta)
    .where(
      and(
        eq(schema.categoriaConta.filialId, filial.id),
        // aceita os dois: 'DESPESA' (o correto) e 'P' (o cru do Consumer, que
        // ficou gravado enquanto o mapeamento não convertia) — assim a tela
        // funciona antes e depois do CDC passar de novo
        inArray(schema.categoriaConta.tipo, ['DESPESA', 'P']),
        isNull(schema.categoriaConta.excluidaEm),
      ),
    )
    .orderBy(asc(schema.categoriaConta.descricao));

  const pais = cats
    .filter((c) => c.codigoPaiExterno == null)
    .map((p) => ({
      id: p.id,
      nome: p.descricao ?? `(${p.codigoExterno})`,
      filhas: cats
        .filter((c) => c.codigoPaiExterno === p.codigoExterno)
        .map((c) => ({ id: c.id, nome: c.descricao ?? `(${c.codigoExterno})` })),
    }));

  const fornecedores = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filial.id),
        isNull(schema.fornecedor.dataDelete),
        not(ilike(schema.fornecedor.nome, '%*excluído%')),
        not(ilike(schema.fornecedor.nome, '%excluido%')),
      ),
    )
    .orderBy(asc(schema.fornecedor.nome));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Nova conta a pagar</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Lançamento manual na nuvem (não passa pelo Consumer). Pagamento parcial é
          registrado depois, na página da conta.
        </p>
        <NovaContaForm
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          filialId={filial.id}
          categorias={pais}
          fornecedores={fornecedores.map((f) => ({ id: f.id, nome: f.nome ?? '(sem nome)' }))}
        />
      </div>
    </main>
  );
}
