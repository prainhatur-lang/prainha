// Tela "Exportar pagamento" — print-friendly + download CSV.
// Mostra cada pessoa com dados bancarios e liquido a pagar pra mandar
// pro orgao pagador (contador, socio, etc).

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { calcularFolha } from '@/lib/folha/calcular';
import { snapshotFolha } from '@/lib/folha/snapshot';
import { labelSemana } from '@/lib/folha/semana';
import { montarInputsFolha } from '@/lib/folha/montar-inputs';
import { ExportarClient } from './client';

export const dynamic = 'force-dynamic';

export default async function ExportarFolhaPage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await props.params;

  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) notFound();

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) {
    return (
      <main className="min-h-screen bg-white p-10 text-sm text-slate-500">
        Sem acesso a essa folha.
      </main>
    );
  }

  const [filial] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, folha.filialId));

  const inputs = await montarInputsFolha(id, folha.filialId);
  if (!inputs) notFound();
  const { pessoasRows } = inputs;

  // Folha FECHADA: exporta o SNAPSHOT do que foi gerado em conta_pagar
  // (o que realmente foi/será pago), não recalcula com cadastro de hoje.
  const resultado = folha.status !== 'aberta'
    ? await snapshotFolha(id)
    : calcularFolha({
        config: inputs.cfg,
        dezPctPorDia: (folha.dezPctPorDia as Record<string, number>) ?? {},
        pessoas: inputs.pessoas,
        horas: Array.from(inputs.horasMap, ([fornecedorId, porDia]) => ({ fornecedorId, porDia })),
        ajustes: Object.fromEntries(inputs.ajustesMap),
      });

  // Agrupa lancamentos por pessoa (uma linha por garcom no arquivo de pagamento)
  type LinhaPagamento = {
    fornecedorId: string;
    nome: string;
    cpf: string | null;
    bancoNome: string | null;
    bancoAgencia: string | null;
    bancoConta: string | null;
    chavePix: string | null;
    bruto: number;
    acrescimos: number;
    descontos: number;
    liquido: number;
  };
  const porPessoa = new Map<string, LinhaPagamento>();
  const dadosPorId = new Map(pessoasRows.map((p) => [p.fornecedorId, p]));
  for (const l of resultado.lancamentos) {
    const p = dadosPorId.get(l.fornecedorId);
    const cur =
      porPessoa.get(l.fornecedorId) ??
      ({
        fornecedorId: l.fornecedorId,
        nome: l.pessoaNome,
        cpf: p?.cpf ?? null,
        bancoNome: p?.bancoNome ?? null,
        bancoAgencia: p?.bancoAgencia ?? null,
        bancoConta: p?.bancoConta ?? null,
        chavePix: p?.chavePix ?? null,
        bruto: 0,
        acrescimos: 0,
        descontos: 0,
        liquido: 0,
      } as LinhaPagamento);
    if (l.tipo === 'gratificacao' || l.tipo === 'premiacao') cur.acrescimos += l.valorBruto;
    else cur.bruto += l.valorBruto;
    cur.descontos += l.desconto;
    cur.liquido += l.valorLiquido;
    porPessoa.set(l.fornecedorId, cur);
  }
  const linhas = Array.from(porPessoa.values())
    .filter((l) => l.liquido > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <ExportarClient
      folhaId={id}
      filialNome={filial?.nome ?? ''}
      labelSemana={labelSemana(folha.dataInicio, folha.dataFim)}
      linhas={linhas}
    />
  );
}
