import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { mesaProntaConfigurado } from '@/lib/whatsapp-otp';
import { ListaEsperaClient } from './lista-espera-client';

export const dynamic = 'force-dynamic';

export default async function ListaEsperaPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'lista_espera.read');
  const podeVerReservas = await podeUsuario(user.id, 'reserva.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const itens = await db
    .select({
      id: schema.listaEspera.id,
      nome: schema.listaEspera.nome,
      telefone: schema.listaEspera.telefone,
      pessoas: schema.listaEspera.pessoas,
      status: schema.listaEspera.status,
      area: schema.listaEspera.area,
      observacao: schema.listaEspera.observacao,
      criadoEm: sql<string>`${schema.listaEspera.criadoEm}::text`,
      chamadoEm: sql<string | null>`${schema.listaEspera.chamadoEm}::text`,
    })
    .from(schema.listaEspera)
    .where(
      and(
        eq(schema.listaEspera.filialId, filial.id),
        inArray(schema.listaEspera.status, ['aguardando', 'chamado']),
      ),
    )
    .orderBy(schema.listaEspera.criadoEm);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <ListaEsperaClient
        filialId={filial.id}
        filialNome={filial.nome}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        itens={itens}
        whatsappOn={mesaProntaConfigurado()}
        podeVerReservas={podeVerReservas}
      />
    </main>
  );
}
