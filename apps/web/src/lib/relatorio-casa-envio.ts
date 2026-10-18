// Relatório de UMA casa, sem os 10%, pra quem não recebe o relatório completo
// (18/10/2026, pedido do dono: o Lula recebe só a Prainha Mar e a Lidiane só a
// Tabuará — faturamento líquido e os períodos já sem o serviço).
//
// Vai pelo mesmo modelo `relatorio_diario` (o destinatário não falou com a
// casa, então texto livre não chega) — {{2}} leva a linha da casa. Cada dia
// que ainda não foi pra pessoa sai uma vez: o cron das 07:00 manda o de
// ontem e, se ficou buraco desde `desde`, completa (limite por rodada).

import { db, schema } from '@concilia/db';
import type { DestinoCasaConfig } from '@concilia/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { faturamentoDoDia, faturamentoSemServico, montarRelatorioFiliais, reais, rotuloDia, somaDias, ultimoDiaFechado, type RelatorioCasa } from './relatorio-diario';
import { enviarModelo, registrar, type OrigemEnvio } from './relatorio-diario-envio';

export interface DestinoCasa {
  nome: string;
  telefone: string;
  filialId: string;
  /** primeiro dia que a pessoa recebe */
  desde: string;
}

/** Lista fixa de 18/10 — vale até o dono salvar a lista pela tela (destinos_casa). */
export const DESTINOS_CASA: DestinoCasa[] = [
  // 03 Prainha Mar → Lula
  { nome: 'Lula', telefone: '5579999550771', filialId: 'e899dae2-38bf-4f3f-9149-7effd059fab8', desde: '2026-10-01' },
  // 02 Tabuará → Lidiane
  { nome: 'Lidiane', telefone: '5579998394839', filialId: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7', desde: '2026-10-01' },
];

export type ItensCasa = DestinoCasaConfig['itens'];
export const ITENS_TODOS: ItensCasa = { faturamento: true, contas: true, periodos: true, picos: true };

/** A lista fixa no formato da tela. */
export function destinosPadrao(): DestinoCasaConfig[] {
  return DESTINOS_CASA.map((d) => ({
    nome: d.nome,
    telefone: d.telefone,
    filialIds: [d.filialId],
    comServico: false,
    itens: { ...ITENS_TODOS },
    diario: true,
    mensal: true,
    desde: d.desde,
  }));
}

/** O que vale pra organização: o salvo pela tela, ou a lista fixa (das filiais dela). */
export async function destinosDaOrganizacao(organizacaoId: string): Promise<DestinoCasaConfig[]> {
  const [row] = await db
    .select({ destinos: schema.relatorioDiarioConfig.destinosCasa })
    .from(schema.relatorioDiarioConfig)
    .where(eq(schema.relatorioDiarioConfig.organizacaoId, organizacaoId))
    .limit(1);
  if (row?.destinos) return row.destinos;
  const daOrg = (await db.execute(sql`
    SELECT id FROM filial WHERE organizacao_id = ${organizacaoId}::uuid
  `)) as unknown as Array<{ id: string }>;
  const ids = new Set(daOrg.map((f) => f.id));
  return destinosPadrao().filter((d) => d.filialIds.every((f) => ids.has(f)));
}

export async function salvarDestinosCasa(organizacaoId: string, destinos: DestinoCasaConfig[], usuarioId: string | null): Promise<void> {
  await db
    .insert(schema.relatorioDiarioConfig)
    .values({ organizacaoId, destinosCasa: destinos, atualizadoPor: usuarioId })
    .onConflictDoUpdate({
      target: schema.relatorioDiarioConfig.organizacaoId,
      set: { destinosCasa: destinos, atualizadoPor: usuarioId, atualizadoEm: new Date() },
    });
}

/** Organizações que têm alguém recebendo por casa (salvo ou da lista fixa). */
async function organizacoesComDestino(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT organizacao_id::text AS id FROM (
      SELECT organizacao_id FROM relatorio_diario_config WHERE destinos_casa IS NOT NULL
      UNION
      SELECT organizacao_id FROM filial WHERE id = ANY(${DESTINOS_CASA.map((d) => d.filialId)}::uuid[])
    ) x
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

const MAX_POR_RODADA = 20;

/** Uma casa num dia, com o que foi escolhido. "Prainha Mar — faturamento líquido (sem os 10%): R$ 13.065 · 52 contas · Almoço 23 contas R$ 6.787 (pico 10 mesas às 14:30) · …" */
export function linhaCasa(c: RelatorioCasa, comServico: boolean, itens: ItensCasa = ITENS_TODOS): string {
  if (!c.temMovimento || !c.movimento.contas) return `${c.nome} — sem movimento no dia.`;
  const valor = comServico ? faturamentoDoDia(c) : faturamentoSemServico(c);
  const partes: string[] = [];
  if (itens.faturamento) {
    partes.push(comServico ? `faturamento (com os 10%): ${reais(valor, false)}` : `faturamento líquido (sem os 10%): ${reais(valor, false)}`);
  }
  if (itens.contas) partes.push(`${c.movimento.contas} ${c.movimento.contas === 1 ? 'conta' : 'contas'}`);
  if (itens.periodos || itens.picos) {
    for (const p of c.periodos) {
      const v = comServico ? p.total : p.total - (p.servico ?? 0);
      const pico = itens.picos && p.pico >= 5 ? `pico ${p.pico} mesas às ${p.picoHora}` : '';
      if (itens.periodos) {
        partes.push(`${p.nome} ${p.contas} ${p.contas === 1 ? 'conta' : 'contas'} ${reais(v, false)}` + (pico ? ` (${pico})` : ''));
      } else if (pico) {
        partes.push(`${p.nome}: ${pico}`);
      }
    }
  }
  if (!partes.length) return `${c.nome} — dia com movimento.`;
  const [primeira, ...resto] = partes;
  return `${c.nome} — ${primeira}${resto.length ? ` · ${resto.join(' · ')}` : ''}`;
}

/** Como era em 18/10 (sem os 10%, tudo). */
export function linhaCasaSemServico(c: RelatorioCasa): string {
  return linhaCasa(c, false, ITENS_TODOS);
}

export interface ResultadoCasa {
  nome: string;
  telefone: string;
  dia: string;
  ok: boolean;
  erro?: string;
}

async function filiaisDe(organizacaoId: string, ids: string[]): Promise<Array<{ id: string; nome: string }>> {
  if (!ids.length) return [];
  const rows = (await db.execute(sql`
    SELECT id, nome FROM filial WHERE organizacao_id = ${organizacaoId}::uuid AND id = ANY(${ids}::uuid[])
  `)) as unknown as Array<{ id: string; nome: string }>;
  // na ordem escolhida
  return ids.map((id) => rows.find((r) => r.id === id)).filter((x): x is { id: string; nome: string } => !!x);
}

/** Manda pra cada destino os dias que faltam (de `desde` até ontem). */
export async function enviarRelatoriosPorCasa(origem: OrigemEnvio = 'cron'): Promise<ResultadoCasa[]> {
  const ate = ultimoDiaFechado();
  const saida: ResultadoCasa[] = [];
  for (const organizacaoId of await organizacoesComDestino()) {
    for (const d of await destinosDaOrganizacao(organizacaoId)) {
      if (!d.diario) continue;
      const filiais = await filiaisDe(organizacaoId, d.filialIds);
      if (!filiais.length) continue;
      const feitos = await db
        .select({ dia: schema.relatorioDiarioEnvio.dia })
        .from(schema.relatorioDiarioEnvio)
        .where(
          and(
            eq(schema.relatorioDiarioEnvio.organizacaoId, organizacaoId),
            eq(schema.relatorioDiarioEnvio.telefone, d.telefone),
            eq(schema.relatorioDiarioEnvio.ok, true),
            inArray(schema.relatorioDiarioEnvio.canal, ['texto', 'modelo']),
          ),
        );
      const jaFoi = new Set(feitos.map((f) => String(f.dia)));
      const faltam: string[] = [];
      for (let dia = d.desde; dia <= ate; dia = somaDias(dia, 1)) if (!jaFoi.has(dia)) faltam.push(dia);

      for (const dia of faltam.slice(0, MAX_POR_RODADA)) {
        const casas = await montarRelatorioFiliais(filiais, dia);
        const linha = filiais
          .map((f) => {
            const c = casas.find((x) => x.filialId === f.id);
            return c ? linhaCasa(c, d.comServico, d.itens) : `${f.nome} — sem movimento no dia.`;
          })
          .join(' | ');
        const m = await enviarModelo(d.telefone, dia, linha);
        await registrar({
          organizacaoId,
          dia,
          telefone: d.telefone,
          canal: 'modelo',
          origem,
          ok: !!m.waMessageId,
          erro: m.erro ?? null,
          waMessageId: m.waMessageId,
          phoneNumberId: m.phoneNumberId || null,
        });
        saida.push({ nome: d.nome, telefone: d.telefone, dia, ok: !!m.waMessageId, erro: m.erro });
        if (!m.waMessageId) break; // modelo/conta com problema: não insiste no resto
      }
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Resultado do mês (18/10/2026, pedido do dono): dia 01 cada destino recebe o
// mês anterior da casa dele, sem os 10% — soma dos mesmos dias do relatório
// diário (mesmos números que a pessoa recebeu dia a dia). Registro com
// canal 'mensal' e dia = 1º do mês, uma vez por mês e pessoa.
// ---------------------------------------------------------------------------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const ORDEM_PERIODOS = ['Manhã', 'Almoço', 'Tarde', 'Noite'];

/** "2026-09-01" → "setembro/2026" */
export function rotuloMes(primeiroDia: string): string {
  return `${MESES[Number(primeiroDia.slice(5, 7)) - 1]}/${primeiroDia.slice(0, 4)}`;
}

/** 1º dia do mês anterior ao de `dia` (YYYY-MM-DD). */
function mesAnterior(dia: string): string {
  const a = Number(dia.slice(0, 4));
  const m = Number(dia.slice(5, 7));
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
}

/** "Prainha Mar — setembro: faturamento líquido (sem os 10%) R$ 250.000 · 1.400 contas · 30 dias com movimento · média R$ 8.333/dia · melhor dia … · Almoço … · Tarde … · Noite …" */
export async function linhaMes(
  filial: { id: string; nome: string },
  primeiroDia: string,
  comServico = false,
  itens: ItensCasa = ITENS_TODOS,
): Promise<string> {
  const dias: string[] = [];
  for (let d = primeiroDia; d.slice(0, 7) === primeiroDia.slice(0, 7); d = somaDias(d, 1)) dias.push(d);
  const casas: Array<{ dia: string; casa: RelatorioCasa | undefined }> = [];
  for (let i = 0; i < dias.length; i += 8) {
    const lote = dias.slice(i, i + 8);
    const r = await Promise.all(lote.map((dia) => montarRelatorioFiliais([filial], dia).then((c) => ({ dia, casa: c[0] }))));
    casas.push(...r);
  }
  let valor = 0;
  let contas = 0;
  let diasAbertos = 0;
  let melhor: { dia: string; valor: number } | null = null;
  const pers = new Map<string, { contas: number; valor: number }>();
  for (const { dia, casa } of casas) {
    if (!casa || !casa.temMovimento || !casa.movimento.contas) continue;
    const v = comServico ? faturamentoDoDia(casa) : faturamentoSemServico(casa);
    valor += v;
    contas += casa.movimento.contas;
    diasAbertos++;
    if (!melhor || v > melhor.valor) melhor = { dia, valor: v };
    for (const p of casa.periodos) {
      const a = pers.get(p.nome) ?? { contas: 0, valor: 0 };
      a.contas += p.contas;
      a.valor += comServico ? p.total : p.total - (p.servico ?? 0);
      pers.set(p.nome, a);
    }
  }
  const mes = MESES[Number(primeiroDia.slice(5, 7)) - 1];
  if (!diasAbertos) return `${filial.nome} — ${mes}: sem movimento no mês.`;
  const fmtN = (n: number) => n.toLocaleString('pt-BR');
  const partes: string[] = [];
  if (itens.faturamento) {
    partes.push(`${comServico ? 'faturamento (com os 10%)' : 'faturamento líquido (sem os 10%)'} ${reais(valor, false)}`);
  }
  if (itens.contas) partes.push(`${fmtN(contas)} contas`);
  partes.push(`${diasAbertos} dias com movimento`);
  if (itens.faturamento) {
    partes.push(`média ${reais(valor / diasAbertos, false)}/dia`);
    if (melhor) partes.push(`melhor dia ${rotuloDia(melhor.dia)} ${reais(melhor.valor, false)}`);
  }
  if (itens.periodos) {
    for (const [nome, a] of [...pers.entries()]
      .filter(([, a]) => a.contas > 0)
      .sort(([x], [y]) => ORDEM_PERIODOS.indexOf(x) - ORDEM_PERIODOS.indexOf(y))) {
      partes.push(`${nome} ${fmtN(a.contas)} contas ${reais(a.valor, false)}`);
    }
  }
  return `${filial.nome} — ${mes}: ${partes.join(' · ')}`;
}

/** Como era em 18/10 (sem os 10%, tudo). */
export function linhaMesSemServico(filial: { id: string; nome: string }, primeiroDia: string): Promise<string> {
  return linhaMes(filial, primeiroDia, false, ITENS_TODOS);
}

/**
 * Dia 01 (a partir do 1º dia operacional do mês já fechado): manda o mês
 * anterior pra cada destino que ainda não recebeu. Fora do dia 01 não faz
 * nada, a não ser com `forcar`, que manda o último mês fechado.
 */
export async function enviarMesPorCasa(origem: OrigemEnvio = 'cron', forcar = false): Promise<ResultadoCasa[]> {
  const ontem = ultimoDiaFechado();
  const hoje = somaDias(ontem, 1);
  if (!forcar && hoje.slice(8, 10) !== '01') return [];
  const mes = mesAnterior(hoje);
  const saida: ResultadoCasa[] = [];
  for (const organizacaoId of await organizacoesComDestino()) {
    for (const d of await destinosDaOrganizacao(organizacaoId)) {
      if (!d.mensal) continue;
      if (mes.slice(0, 7) < d.desde.slice(0, 7)) continue;
      const filiais = await filiaisDe(organizacaoId, d.filialIds);
      if (!filiais.length) continue;
      const [ja] = await db
        .select({ dia: schema.relatorioDiarioEnvio.dia })
        .from(schema.relatorioDiarioEnvio)
        .where(
          and(
            eq(schema.relatorioDiarioEnvio.organizacaoId, organizacaoId),
            eq(schema.relatorioDiarioEnvio.telefone, d.telefone),
            eq(schema.relatorioDiarioEnvio.ok, true),
            eq(schema.relatorioDiarioEnvio.canal, 'mensal'),
            eq(schema.relatorioDiarioEnvio.dia, mes),
          ),
        )
        .limit(1);
      if (ja) continue;
      const linhas: string[] = [];
      for (const f of filiais) linhas.push(await linhaMes(f, mes, d.comServico, d.itens));
      const m = await enviarModelo(d.telefone, mes, linhas.join(' | '), rotuloMes(mes));
      await registrar({
        organizacaoId,
        dia: mes,
        telefone: d.telefone,
        canal: 'mensal',
        origem,
        ok: !!m.waMessageId,
        erro: m.erro ?? null,
        waMessageId: m.waMessageId,
        phoneNumberId: m.phoneNumberId || null,
      });
      saida.push({ nome: d.nome, telefone: d.telefone, dia: mes, ok: !!m.waMessageId, erro: m.erro });
    }
  }
  return saida;
}
