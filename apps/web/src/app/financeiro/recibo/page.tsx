// Fazer recibo (16/11/2026, pedido do dono): quem recebeu não tem recibo —
// a casa preenche nome, CPF, valor e a que se refere. Já pago → nasce baixada
// (com a forma) e sai o recibo pra imprimir ou enviar pelo celular. Não pago →
// entra no contas a pagar. A "Nova conta" continua igual, ao lado.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ReciboForm } from './form';
import { portadoresDaFilial } from '@/lib/portador';
import { bancosDaCasa } from '@/lib/bancos-da-casa';

export const dynamic = 'force-dynamic';

export default async function FazerReciboPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.create');

  const filiais = await filiaisDoFinanceiro(user.id);
  const sp = await props.searchParams;
  const filial = (await escolherFilial(filiais, sp.filialId)) ?? filiais[0];
  if (!filial) redirect('/financeiro');

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

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-2xl px-6 py-6">
        <Link href="/financeiro" className="text-xs text-sky-700 hover:underline">
          ← Contas a pagar
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">🧾 Fazer recibo</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Pra quando quem recebeu não tem recibo. Se já foi pago, a conta nasce baixada e o recibo sai
          pra imprimir ou enviar pelo celular. Se não, entra no contas a pagar.
        </p>
        <ReciboForm
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          filialId={filial.id}
          categorias={pais}
          bancos={await bancosDaCasa(filial.id)}
          portadores={(await portadoresDaFilial(filial.id, true)).map((p) => ({ id: p.id, nome: p.nome }))}
        />
      </div>
    </main>
  );
}
