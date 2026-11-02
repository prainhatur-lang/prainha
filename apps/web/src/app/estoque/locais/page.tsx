// Estoque por setor (Depósito, Recepção, Bar, Cozinha...) e transferência
// entre setores com foto de quem levou (02/11/2026). Regra em lib/estoque-local.ts.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { locaisDaFilial, saldosPorLocal } from '@/lib/estoque-local';
import { EstoqueLocaisCliente, type TransfHist } from './cliente';

export const dynamic = 'force-dynamic';

export default async function EstoqueLocaisPage(props: {
  searchParams: Promise<{ filialId?: string; aba?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'produto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-4 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;

  const [locais, podeEditar] = await Promise.all([locaisDaFilial(filial.id), podeUsuario(user.id, 'produto.update')]);
  const saldos = await saldosPorLocal(filial.id, locais);

  const produtos = await db
    .select({ id: schema.produto.id, nome: schema.produto.nome, unidade: schema.produto.unidadeEstoque })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.controlaEstoque, true),
        sql`${schema.produto.tipo} <> 'VENDA_COMPOSTO'`,
        sql`coalesce(${schema.produto.descontinuado}, false) = false`,
      ),
    )
    .orderBy(asc(schema.produto.nome));

  const pessoas = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, filial.id), eq(schema.funcionario.ativo, true)))
    .orderBy(asc(schema.funcionario.nome));

  const hist = await db
    .select({
      id: schema.estoqueTransferenciaLocal.id,
      produtoId: schema.estoqueTransferenciaLocal.produtoId,
      quantidade: schema.estoqueTransferenciaLocal.quantidade,
      unidade: schema.estoqueTransferenciaLocal.unidade,
      origemId: schema.estoqueTransferenciaLocal.localOrigemId,
      destinoId: schema.estoqueTransferenciaLocal.localDestinoId,
      pessoaNome: schema.estoqueTransferenciaLocal.pessoaNome,
      temFoto: sql<boolean>`${schema.estoqueTransferenciaLocal.fotoPath} is not null`,
      observacao: schema.estoqueTransferenciaLocal.observacao,
      dataHora: schema.estoqueTransferenciaLocal.dataHora,
      criadoPorEmail: schema.estoqueTransferenciaLocal.criadoPorEmail,
      canceladaEm: schema.estoqueTransferenciaLocal.canceladaEm,
      canceladaPor: schema.estoqueTransferenciaLocal.canceladaPor,
      motivoCancelamento: schema.estoqueTransferenciaLocal.motivoCancelamento,
    })
    .from(schema.estoqueTransferenciaLocal)
    .where(eq(schema.estoqueTransferenciaLocal.filialId, filial.id))
    .orderBy(desc(schema.estoqueTransferenciaLocal.dataHora))
    .limit(300);

  const nomeProduto = new Map(produtos.map((p) => [p.id, p.nome ?? '(sem nome)']));
  const faltam = [...new Set(hist.map((h) => h.produtoId))].filter((id) => !nomeProduto.has(id));
  if (faltam.length) {
    const extra = await db
      .select({ id: schema.produto.id, nome: schema.produto.nome })
      .from(schema.produto)
      .where(inArray(schema.produto.id, faltam));
    for (const p of extra) nomeProduto.set(p.id, p.nome ?? '(sem nome)');
  }

  const historico: TransfHist[] = hist.map((h) => ({
    id: h.id,
    produto: nomeProduto.get(h.produtoId) ?? '(produto)',
    quantidade: Number(h.quantidade),
    unidade: h.unidade ?? '',
    origemId: h.origemId,
    destinoId: h.destinoId,
    pessoaNome: h.pessoaNome,
    temFoto: Boolean(h.temFoto),
    observacao: h.observacao,
    dataHora: h.dataHora.toISOString(),
    criadoPorEmail: h.criadoPorEmail,
    canceladaEm: h.canceladaEm ? h.canceladaEm.toISOString() : null,
    canceladaPor: h.canceladaPor,
    motivoCancelamento: h.motivoCancelamento,
  }));

  const aba = ['saldo', 'transferir', 'historico', 'setores'].includes(sp.aba ?? '') ? sp.aba! : 'saldo';

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-4 py-5">
        <h1 className="text-xl font-semibold text-slate-900">Estoque por setor</h1>
        <p className="mt-1 text-sm text-slate-500">
          {filial.nome} · onde está cada produto e quem levou de um setor pro outro.
        </p>
        <EstoqueLocaisCliente
          filialId={filial.id}
          abaInicial={aba as 'saldo' | 'transferir' | 'historico' | 'setores'}
          locais={locais}
          saldos={saldos}
          produtos={produtos.map((p) => ({ id: p.id, nome: p.nome ?? '(sem nome)', unidade: p.unidade }))}
          pessoas={pessoas}
          historico={historico}
          podeEditar={podeEditar}
        />
      </div>
    </main>
  );
}
