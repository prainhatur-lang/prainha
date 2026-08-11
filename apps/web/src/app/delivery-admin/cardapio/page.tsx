// /delivery-admin/cardapio — monta o cardápio do delivery: categorias, itens,
// preço próprio (pode diferir do salão), foto, esgotado e destaque.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
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
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

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

  const itens = await db
    .select({
      id: schema.deliveryItem.id,
      categoriaId: schema.deliveryItem.categoriaId,
      nome: schema.deliveryItem.nome,
      descricao: schema.deliveryItem.descricao,
      preco: schema.deliveryItem.preco,
      fotoUrl: schema.deliveryItem.fotoUrl,
      ativo: schema.deliveryItem.ativo,
      esgotado: schema.deliveryItem.esgotado,
      destaque: schema.deliveryItem.destaque,
      ordem: schema.deliveryItem.ordem,
    })
    .from(schema.deliveryItem)
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
        itens={itens}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
        podeDeletar={podeDeletar}
      />
    </main>
  );
}
