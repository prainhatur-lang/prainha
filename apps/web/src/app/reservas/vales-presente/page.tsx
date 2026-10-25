// Vales-presente (jantar de presente) — a equipe confere o código que o
// casal mostra e dá baixa. Vales são criados pela Nina/Otávio no WhatsApp.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { desc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ValesPresenteClient, type ValeLinha } from './vales-presente-client';

export const dynamic = 'force-dynamic';

const fmtDataHora = (d: Date | null) =>
  d
    ? d.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

export default async function ValesPresentePage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'reserva.read');
  const podeAtualizar = await podeUsuario(user.id, 'reserva.update');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = escolhida;

  const linhas = await db
    .select()
    .from(schema.valePresente)
    .where(eq(schema.valePresente.filialId, filial.id))
    .orderBy(desc(schema.valePresente.criadoEm))
    .limit(300);

  const vales: ValeLinha[] = linhas.map((v) => ({
    id: v.id,
    codigo: v.codigo,
    token: v.token,
    status: v.status,
    tipo: v.tipo,
    compradorNome: v.compradorNome,
    compradorTelefone: v.compradorTelefone,
    presenteados: v.presenteados,
    mensagem: v.mensagem,
    observacao: v.observacao,
    dataUso: v.dataUso ? String(v.dataUso).split('-').reverse().join('/') : null,
    pessoas: v.pessoas,
    itens: v.itens,
    total: Number(v.total),
    criadoEm: fmtDataHora(v.criadoEm),
    pagoEm: fmtDataHora(v.pagoEm),
    usadoEm: fmtDataHora(v.usadoEm),
    usadoPor: v.usadoPor,
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <ValesPresenteClient
        filialNome={filial.nome}
        filialId={filial.id}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        vales={vales}
        podeAtualizar={podeAtualizar}
      />
    </main>
  );
}
