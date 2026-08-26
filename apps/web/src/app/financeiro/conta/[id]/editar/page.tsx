// Alterar uma conta a pagar MANUAL. Contas de outras origens não passam
// daqui (Consumer = PDV, FOLHA = snapshot, NFE = pela nota).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, ilike, inArray, isNull, not } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { EditarContaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function EditarContaPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.update');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [conta] = await db
    .select()
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) notFound();

  const filiais = await filiaisDoUsuario(user.id);
  const filial = filiais.find((f) => f.id === conta.filialId);
  if (!filial) redirect('/financeiro');

  if (conta.origem !== 'MANUAL') {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <div className="mx-auto max-w-3xl px-6 py-10">
          <Link href={`/financeiro/conta/${id}`} className="text-xs text-sky-700 hover:underline">
            ← Voltar pra conta
          </Link>
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Essa conta tem origem <b>{conta.origem}</b> e não se edita aqui:{' '}
            {conta.origem === 'CONSUMER'
              ? 'ela veio do PDV da loja — altere no Consumer (o sync sobrescreveria qualquer mudança feita na nuvem).'
              : conta.origem === 'FOLHA'
                ? 'ela foi gerada pelo fechamento da folha (snapshot imutável) — reabra a folha pra mexer.'
                : 'ela nasceu de uma nota fiscal — gerencie pela nota de origem.'}
          </p>
        </div>
      </main>
    );
  }

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

  // Categoria atual pode ser pai ou subcategoria — resolve a dupla pai/sub
  let paiInicial = '';
  let subInicial = '';
  if (conta.categoriaId) {
    const atual = cats.find((c) => c.id === conta.categoriaId);
    if (atual) {
      if (atual.codigoPaiExterno == null) {
        paiInicial = atual.id;
      } else {
        subInicial = atual.id;
        paiInicial = cats.find((c) => c.codigoExterno === atual.codigoPaiExterno)?.id ?? '';
      }
    }
  }

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
  const fornecedorAtual = conta.fornecedorId
    ? fornecedores.find((f) => f.id === conta.fornecedorId)
    : undefined;

  const dataLancamento = conta.dataCadastro
    ? new Date(conta.dataCadastro).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    : '';

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <Link href={`/financeiro/conta/${id}`} className="text-xs text-sky-700 hover:underline">
          ← Voltar pra conta
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Alterar conta a pagar</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {filial.nome} · o status (paga/parcial) vem dos pagamentos registrados — pra mudar,
          registre ou estorne baixas na página da conta.
        </p>
        <EditarContaForm
          contaId={conta.id}
          categorias={pais}
          fornecedores={fornecedores.map((f) => ({ id: f.id, nome: f.nome ?? '(sem nome)' }))}
          inicial={{
            descricao: conta.descricao ?? '',
            valor: Number(conta.valor).toFixed(2).replace('.', ','),
            dataLancamento,
            dataVencimento: conta.dataVencimento,
            paiId: paiInicial,
            subId: subInicial,
            fornecedorId: fornecedorAtual?.id ?? '',
            fornecedorNome: fornecedorAtual?.nome ?? '',
            observacao: conta.observacao ?? '',
          }}
        />
      </div>
    </main>
  );
}
