// A agenda: quem é o vendedor, o WhatsApp dele e quais fornecedores ele atende.
//
// Este é O lugar do número. Fora daqui ele se perde: fornecedor.fone_principal
// vem do Consumer e é sobrescrito a cada sync (quase sempre pelo fixo da
// empresa, onde WhatsApp não chega).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, isNull, ilike, not, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { VendedoresClient, type VendedorLinha, type FornecedorOpt } from './vendedores-client';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function VendedoresPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'fornecedor.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialResolvida = await escolherFilial(filiais, sp.filialId);
  if (!filialResolvida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }
  const filial = filialResolvida;

  const [org] = await db
    .select({ id: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filial.id))
    .limit(1);

  const vendedores = await db
    .select({
      id: schema.vendedor.id,
      nome: schema.vendedor.nome,
      whatsapp: schema.vendedor.whatsapp,
      observacao: schema.vendedor.observacao,
      ativo: schema.vendedor.ativo,
    })
    .from(schema.vendedor)
    .where(eq(schema.vendedor.organizacaoId, org?.id ?? ''))
    .orderBy(asc(schema.vendedor.nome));

  // Fornecedores de cada vendedor, com a loja — o vendedor é do grupo.
  const vinculos = await db
    .select({
      vendedorId: schema.vendedorFornecedor.vendedorId,
      fornecedorId: schema.fornecedor.id,
      fornecedorNome: schema.fornecedor.nome,
      filialNome: schema.filial.nome,
      principal: schema.vendedorFornecedor.principal,
      produtos: sql<number>`(SELECT count(*)::int FROM produto_fornecedor pf
        WHERE pf.fornecedor_id = ${schema.fornecedor.id})`,
    })
    .from(schema.vendedorFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.vendedorFornecedor.fornecedorId))
    .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
    .orderBy(desc(schema.vendedorFornecedor.principal), asc(schema.fornecedor.nome));

  const porVendedor = new Map<string, VendedorLinha['fornecedores']>();
  for (const v of vinculos) {
    if (!porVendedor.has(v.vendedorId)) porVendedor.set(v.vendedorId, []);
    porVendedor.get(v.vendedorId)!.push({
      id: v.fornecedorId,
      nome: v.fornecedorNome ?? '(sem nome)',
      filial: v.filialNome,
      principal: v.principal,
      produtos: Number(v.produtos ?? 0),
    });
  }

  const linhas: VendedorLinha[] = vendedores.map((v) => ({
    id: v.id,
    nome: v.nome,
    whatsapp: v.whatsapp,
    observacao: v.observacao,
    ativo: v.ativo,
    fornecedores: porVendedor.get(v.id) ?? [],
  }));

  // Fornecedores da filial ativa que ainda não têm nenhum vendedor — a lista
  // do que falta, que é o que mantém o problema vivo.
  const semVendedor = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      produtos: sql<number>`(SELECT count(*)::int FROM produto_fornecedor pf
        WHERE pf.fornecedor_id = ${schema.fornecedor.id})`,
    })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filial.id),
        eq(schema.fornecedor.ativoCompras, true),
        isNull(schema.fornecedor.dataDelete),
        not(ilike(schema.fornecedor.nome, '%*excluído%')),
        sql`NOT EXISTS (SELECT 1 FROM vendedor_fornecedor vf WHERE vf.fornecedor_id = ${schema.fornecedor.id})`,
        sql`EXISTS (SELECT 1 FROM produto_fornecedor pf WHERE pf.fornecedor_id = ${schema.fornecedor.id})`,
      ),
    )
    .orderBy(asc(schema.fornecedor.nome));

  const opcoes: FornecedorOpt[] = semVendedor.map((f) => ({
    id: f.id,
    nome: f.nome ?? '(sem nome)',
    produtos: Number(f.produtos ?? 0),
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Vendedores</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            O WhatsApp mora aqui, na pessoa — não no cadastro da empresa, que o Consumer
            sobrescreve a cada sincronização. Um vendedor atende vários fornecedores; um
            fornecedor pode ter vários vendedores.
          </p>
        </div>

        <VendedoresClient
          filialId={filial.id}
          filialNome={filial.nome}
          linhas={linhas}
          semVendedor={opcoes}
        />
      </div>
    </main>
  );
}
