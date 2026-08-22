// Configurações → Pagamento: credencial Cielo de CADA filial.
//
// Cada casa tem o próprio estabelecimento na Cielo — o dinheiro do delivery da
// Tabuará não pode cair na conta do Prainha. Filial sem credencial própria
// continua cobrando pela env global, que é como tudo funcionava antes.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { segredoConfigurado } from '@/lib/segredo';
import { PagamentoClient, type FilialCred } from './pagamento-client';

export const dynamic = 'force-dynamic';

export default async function PagamentoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'configuracao.read');
  const podeEditar = await podeUsuario(user.id, 'configuracao.editar');

  const filiais = await filiaisDoUsuario(user.id);
  const linhas = filiais.length
    ? await db
        .select({
          filialId: schema.filialCredencial.filialId,
          chave: schema.filialCredencial.chave,
          pista: schema.filialCredencial.pista,
        })
        .from(schema.filialCredencial)
        .where(and(
          inArray(schema.filialCredencial.filialId, filiais.map((f) => f.id)),
          eq(schema.filialCredencial.provedor, 'cielo'),
        ))
    : [];

  const porFilial = new Map<string, Record<string, string | null>>();
  for (const l of linhas) {
    const m = porFilial.get(l.filialId) ?? {};
    m[l.chave] = l.pista;
    porFilial.set(l.filialId, m);
  }

  const dados: FilialCred[] = filiais.map((f) => ({
    id: f.id,
    nome: f.nome,
    propria: porFilial.has(f.id),
    pistas: porFilial.get(f.id) ?? {},
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Pagamento</h1>
        <p className="mt-1 text-sm text-slate-600">
          Credencial da Cielo de cada casa. Quem tem a chavinha ligada cobra na própria conta;
          quem está desligada cobra pela credencial geral do servidor.
        </p>
        <PagamentoClient filiais={dados} podeEditar={podeEditar} segredoOk={segredoConfigurado()} />
      </section>
    </main>
  );
}
