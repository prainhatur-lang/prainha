// /compras/pedidos/novo — Pedido sob encomenda (23/10/2026).
// Material feito sob medida (embalagem, guardanapo, uniforme...) com entrada
// antecipada + restante. Cada parcela vira uma conta a pagar ligada ao pedido.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { NovoPedidoEncomenda } from './novo-pedido-encomenda';
import { foneDoVendedor } from '@/lib/vendedor-fone';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function NovoPedidoEncomendaPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cotacao.create');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const resolvida = await escolherFilial(filiais, sp.filialId);
  if (!resolvida) redirect('/compras/pedidos');
  const filial = resolvida;

  const [fornecedores, produtos] = await Promise.all([
    db
      .select({
        id: schema.fornecedor.id,
        nome: schema.fornecedor.nome,
        doc: schema.fornecedor.cnpjOuCpf,
        chavePix: schema.fornecedor.chavePix,
        // WhatsApp de verdade: vendedor ou o do cadastro. O fone do Consumer
        // (fixo) fica de fora — mensagem pra fixo some sem aviso.
        zap: sql<string | null>`COALESCE(${foneDoVendedor(schema.fornecedor.id)}, NULLIF(${schema.fornecedor.foneWhatsapp}, ''))`,
      })
      .from(schema.fornecedor)
      .where(and(eq(schema.fornecedor.filialId, filial.id), isNull(schema.fornecedor.dataDelete)))
      .orderBy(asc(schema.fornecedor.nome)),
    db
      .select({ id: schema.produto.id, nome: schema.produto.nome, unidade: schema.produto.unidadeEstoque })
      .from(schema.produto)
      .where(and(eq(schema.produto.filialId, filial.id), isNotNull(schema.produto.nome)))
      .orderBy(asc(schema.produto.nome))
      .limit(5000),
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Link href={`/compras/pedidos?filialId=${filial.id}`} className="text-xs text-slate-500 hover:underline">
          ← Pedidos de compra
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Pedido sob encomenda</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {filial.nome} · material feito sob medida, com entrada e restante. Cada parcela vira uma conta a
          pagar ligada ao pedido; a de Pix aparece em Pagar Pix.
        </p>
        <NovoPedidoEncomenda
          filialId={filial.id}
          hoje={hojeBr()}
          fornecedores={fornecedores.map((f) => ({
            id: f.id,
            nome: f.nome ?? '(sem nome)',
            doc: f.doc,
            temPix: !!f.chavePix,
            zap: f.zap ?? null,
          }))}
          produtos={produtos.map((p) => ({ id: p.id, nome: p.nome ?? '', unidade: p.unidade }))}
        />
      </div>
    </main>
  );
}
