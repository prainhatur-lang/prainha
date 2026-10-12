// /relatorios/fechamento/extratos — os extratos bancários do ANO inteiro numa
// grade (conta × mês). É o lugar de pôr extrato pra dentro (enviar arquivo,
// baixar direto do Inter, mexer na lista de contas). A seção "Extratos
// bancários" do Fechamento do mês mostra os mesmos arquivos, só pra ver e baixar.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { podeUsuario } from '@/lib/permissoes-runtime';
import {
  EXTRATO_EXTENSOES,
  PERM_EXTRATO_ENVIAR,
  PERM_EXTRATO_VER,
  destinosNovaContaExtrato,
  extratosDoAno,
} from '@/lib/extratos-fechamento';
import { contaVemDoInter } from '@/lib/extrato-inter-fechamento';
import { ExtratosAno } from './extratos-ano';

export const dynamic = 'force-dynamic';

interface SP {
  ano?: string;
}

export default async function ExtratosAnoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, PERM_EXTRATO_VER);

  const sp = await props.searchParams;
  const [hojeAno, hojeMes] = hojeBr().split('-').map(Number) as [number, number];
  const pedido = Number(sp.ano);
  const ano = Number.isInteger(pedido) && pedido >= 2015 && pedido <= hojeAno ? pedido : hojeAno;

  // Anos nos botões: o atual e os dois anteriores, mais o que estiver aberto.
  const anos = [...new Set([hojeAno - 2, hojeAno - 1, hojeAno, ano])].sort((a, b) => a - b);

  const [contas, podeEnviar, destinos] = await Promise.all([
    extratosDoAno(user.id, ano),
    podeUsuario(user.id, PERM_EXTRATO_ENVIAR),
    destinosNovaContaExtrato(user.id),
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Extratos bancários de {ano}</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              O extrato de cada conta, mês a mês. É aqui que o extrato entra; no Fechamento do mês os mesmos arquivos
              aparecem pra ver e baixar.
            </p>
          </div>
          <Link
            href="/relatorios/fechamento"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            ← Fechamento do mês
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-slate-500">Ano:</span>
          {anos.map((a) => (
            <Link
              key={a}
              href={`/relatorios/fechamento/extratos?ano=${a}`}
              className={`rounded-md border px-3 py-1 text-xs ${
                a === ano
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {a}
            </Link>
          ))}
        </div>

        <ExtratosAno
          ano={ano}
          hojeAno={hojeAno}
          hojeMes={hojeMes}
          contas={contas}
          podeEnviar={podeEnviar}
          extensoes={EXTRATO_EXTENSOES}
          casas={destinos.filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          podeEmpresa={!!destinos.organizacaoEmpresas}
          interIds={contas.filter(contaVemDoInter).map((c) => c.id)}
        />
      </div>
    </main>
  );
}
