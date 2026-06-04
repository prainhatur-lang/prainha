// Tela "Exportar pagamento" — print-friendly + download CSV.
// Mostra cada pessoa com dados bancarios e liquido a pagar pra mandar
// pro orgao pagador (contador, socio, etc).

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { calcularFolha, type ConfigFolha } from '@/lib/folha/calcular';
import { labelSemana } from '@/lib/folha/semana';
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

  const [config] = await db
    .select()
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, folha.filialId))
    .limit(1);
  if (!config) notFound();

  const pessoasRows = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      papel: schema.fornecedorFolha.papel,
      gerenteModelo: schema.fornecedorFolha.gerenteModelo,
      gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
      diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
      diaristaModelo: schema.fornecedorFolha.diaristaModelo,
      diaristaValorFixoDia: schema.fornecedorFolha.diaristaValorFixoDia,
      bonusFixoSemanal: schema.fornecedorFolha.bonusFixoSemanal,
      bonusPorDia: schema.fornecedorFolha.bonusPorDia,
      nome: schema.fornecedor.nome,
      cpf: schema.fornecedor.cnpjOuCpf,
      bancoNome: schema.fornecedor.bancoNome,
      bancoAgencia: schema.fornecedor.bancoAgencia,
      bancoConta: schema.fornecedor.bancoConta,
      chavePix: schema.fornecedor.chavePix,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .where(
      and(
        eq(schema.fornecedor.filialId, folha.filialId),
        eq(schema.fornecedorFolha.ativo, true),
      ),
    );

  const horasRows = await db
    .select()
    .from(schema.folhaHoras)
    .where(eq(schema.folhaHoras.folhaSemanaId, id));

  const ajustesRows = await db
    .select()
    .from(schema.folhaAjuste)
    .where(eq(schema.folhaAjuste.folhaSemanaId, id));

  const horasMap = new Map<string, Record<string, number>>();
  for (const h of horasRows) {
    const cur = horasMap.get(h.fornecedorId) ?? {};
    cur[h.dia] = h.totalMin;
    horasMap.set(h.fornecedorId, cur);
  }

  const ajustesMap = new Map<
    string,
    Array<{ tipo: 'desconto' | 'acrescimo'; valor: number; descricao?: string }>
  >();
  for (const a of ajustesRows) {
    const cur = ajustesMap.get(a.fornecedorId) ?? [];
    cur.push({
      tipo: a.tipo as 'desconto' | 'acrescimo',
      valor: Number(a.valor),
      descricao: a.descricao ?? undefined,
    });
    ajustesMap.set(a.fornecedorId, cur);
  }
  // Mesma injecao de bonus do preview/fechar — senao o valor exportado diverge
  // do que foi fechado (e o bonus por dia some).
  for (const p of pessoasRows) {
    const diasComHoras = Object.values(horasMap.get(p.fornecedorId) ?? {}).filter((m) => m > 0).length;
    if (p.bonusFixoSemanal != null && Number(p.bonusFixoSemanal) > 0 && diasComHoras > 0) {
      const cur = ajustesMap.get(p.fornecedorId) ?? [];
      cur.push({
        tipo: 'acrescimo',
        valor: Number(p.bonusFixoSemanal),
        descricao: '💰 Bônus fixo semanal (cadastro)',
      });
      ajustesMap.set(p.fornecedorId, cur);
    }
    if (p.bonusPorDia != null && Number(p.bonusPorDia) > 0 && diasComHoras > 0) {
      const valorDia = Number(p.bonusPorDia);
      const cur = ajustesMap.get(p.fornecedorId) ?? [];
      cur.push({
        tipo: 'acrescimo',
        valor: valorDia * diasComHoras,
        descricao: `🗓 Bônus por dia (${diasComHoras} × R$ ${valorDia.toFixed(2)})`,
      });
      ajustesMap.set(p.fornecedorId, cur);
    }
  }

  const cfg: ConfigFolha = {
    ppEmpresa: Number(config.ppEmpresa),
    ppGerente: Number(config.ppGerente),
    ppFuncionarios: Number(config.ppFuncionarios),
    taxaDiaristaHora: Number(config.taxaDiaristaHora),
    auxTransporteAtivo: config.auxTransporteAtivo,
    auxTransporteValorHora: config.auxTransporteValorHora
      ? Number(config.auxTransporteValorHora)
      : null,
    auxTransporteDias: (config.auxTransporteDias as Record<string, boolean> | null) ?? null,
  };

  const resultado = calcularFolha({
    config: cfg,
    dezPctPorDia: (folha.dezPctPorDia as Record<string, number>) ?? {},
    pessoas: pessoasRows.map((p) => ({
      fornecedorId: p.fornecedorId,
      nome: p.nome ?? '(sem nome)',
      papel: p.papel as 'funcionario' | 'diarista' | 'gerente',
      gerenteModelo: p.gerenteModelo,
      gerenteValorFixoDia: p.gerenteValorFixoDia ? Number(p.gerenteValorFixoDia) : null,
      diaristaTaxaHoraOverride: p.diaristaTaxaHoraOverride
        ? Number(p.diaristaTaxaHoraOverride)
        : null,
      diaristaModelo: p.diaristaModelo ?? 'por_hora',
      diaristaValorFixoDia: p.diaristaValorFixoDia ? Number(p.diaristaValorFixoDia) : null,
    })),
    horas: Array.from(horasMap, ([fornecedorId, porDia]) => ({ fornecedorId, porDia })),
    ajustes: Object.fromEntries(ajustesMap),
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
    if (l.tipo === 'gratificacao') cur.acrescimos += l.valorBruto;
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
