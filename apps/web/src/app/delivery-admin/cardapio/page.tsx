// /delivery-admin/cardapio — monta o cardápio do delivery: categorias, itens,
// preço próprio (pode diferir do salão), foto, esgotado e destaque.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { CardapioAdminClient } from './cardapio-admin-client';

export const dynamic = 'force-dynamic';

export default async function CardapioDeliveryPage(props: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');
  const podeEditar = await podeUsuario(user.id, 'delivery.update');
  const podeCriar = await podeUsuario(user.id, 'delivery.create');
  const podeDeletar = await podeUsuario(user.id, 'delivery.delete');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }

  const categorias = await db
    .select({
      id: schema.deliveryCategoria.id,
      nome: schema.deliveryCategoria.nome,
      ordem: schema.deliveryCategoria.ordem,
      ativo: schema.deliveryCategoria.ativo,
    })
    .from(schema.deliveryCategoria)
    .where(eq(schema.deliveryCategoria.filialId, filial.id))
    .orderBy(asc(schema.deliveryCategoria.ordem), asc(schema.deliveryCategoria.nome));

  // Preço do salão e saldo vêm ao vivo do espelho do Consumer (left join:
  // item criado à mão, sem vínculo, simplesmente não tem esses números).
  const itens = await db
    .select({
      id: schema.deliveryItem.id,
      categoriaId: schema.deliveryItem.categoriaId,
      nome: schema.deliveryItem.nome,
      descricao: schema.deliveryItem.descricao,
      preco: schema.deliveryItem.preco,
      precoIfood: schema.deliveryItem.precoIfood,
      checarEstoque: schema.deliveryItem.checarEstoque,
      varianteId: schema.deliveryItem.varianteId,
      fotoUrl: schema.deliveryItem.fotoUrl,
      ativo: schema.deliveryItem.ativo,
      esgotado: schema.deliveryItem.esgotado,
      destaque: schema.deliveryItem.destaque,
      ordem: schema.deliveryItem.ordem,
      precoSalao: schema.produtoVariante.precoVenda,
      estoqueControlado: schema.produtoVariante.estoqueControlado,
      estoqueAtual: schema.produtoVariante.estoqueAtual,
    })
    .from(schema.deliveryItem)
    .leftJoin(
      schema.produtoVariante,
      eq(schema.produtoVariante.id, schema.deliveryItem.varianteId),
    )
    .where(eq(schema.deliveryItem.filialId, filial.id))
    .orderBy(asc(schema.deliveryItem.ordem), asc(schema.deliveryItem.nome));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <CardapioAdminClient
        filialId={filial.id}
        filialNome={filial.nome}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        categorias={categorias}
        itens={itens.map((i) => ({
          ...i,
          precoSalaoCentavos:
            i.precoSalao != null ? Math.round(Number(i.precoSalao) * 100) : null,
          estoqueControlado: i.estoqueControlado === true,
          estoqueAtual:
            i.estoqueControlado === true && i.estoqueAtual != null
              ? Number(i.estoqueAtual)
              : null,
        }))}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
        podeDeletar={podeDeletar}
      />
    </main>
  );
}
