// Configurações → iFood: credencial e ajustes de CADA filial.
//
// Cada casa é um merchant diferente no iFood e vira a chave no seu tempo: uma
// pode já receber pelo Concilia enquanto a outra continua no Consumer. Filial
// sem cadastro aqui simplesmente não recebe iFood por este caminho.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { segredoConfigurado, decifrar } from '@/lib/segredo';
import { CHAVES_IFOOD_SECRETAS, PROVEDOR_IFOOD } from '@/lib/ifood-credenciais';
import { IfoodClient, type FilialIfood } from './ifood-client';

export const dynamic = 'force-dynamic';

export default async function IfoodPage() {
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
          valor: schema.filialCredencial.valor,
          pista: schema.filialCredencial.pista,
        })
        .from(schema.filialCredencial)
        .where(and(
          inArray(schema.filialCredencial.filialId, filiais.map((f) => f.id)),
          eq(schema.filialCredencial.provedor, PROVEDOR_IFOOD),
        ))
    : [];

  const porFilial = new Map<string, Record<string, string>>();
  for (const l of linhas) {
    const m = porFilial.get(l.filialId) ?? {};
    // O segredo vira pista; o resto vai inteiro pra tela poder conferir qual
    // loja do iFood está apontada em cada casa.
    if ((CHAVES_IFOOD_SECRETAS as string[]).includes(l.chave)) m[l.chave] = l.pista ?? '••••';
    else { try { m[l.chave] = decifrar(l.valor); } catch { m[l.chave] = ''; } }
    porFilial.set(l.filialId, m);
  }

  const dados: FilialIfood[] = filiais.map((f) => ({
    id: f.id,
    nome: f.nome,
    configurada: porFilial.has(f.id),
    valores: porFilial.get(f.id) ?? {},
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-900">iFood</h1>
        <p className="mt-1 text-sm text-slate-600">
          Credencial do iFood de cada casa. Ligada, a loja recebe o pedido direto no PDV
          (cozinha, entrega e caixa). Desligada, quem recebe continua sendo o Consumer.
        </p>
        <IfoodClient filiais={dados} podeEditar={podeEditar} segredoOk={segredoConfigurado()} />
      </section>
    </main>
  );
}
