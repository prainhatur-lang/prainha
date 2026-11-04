// Faltas do mês da saída pelo ponto, pro TRCT (pedido do dono 04/11/2026:
// "em todos colocar faltas de ponto").
//
// Dia sem batida (em qualquer casa, pelo CPF), sem atestado que abone e que
// não é folga = falta. Folga vem da escala do mês (/rh/escala-mensal); semana
// sem folga marcada na escala supõe 1 folga (6x1). Semana com falta perde o
// DSR (1 dia), se a folga dela caiu dentro do período.
// Quem não bateu ponto nenhum no período não ganha sugestão (não usa ponto).

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

export interface SemanaFaltas {
  de: string;
  ate: string;
  semPonto: string[];
  folgas: string[];
  folgaSuposta: boolean;
  faltas: number;
  dsr: number;
}

export interface FaltasDoPonto {
  de: string;
  ate: string;
  faltas: number;
  dsr: number;
  diasComPonto: number;
  semanas: SemanaFaltas[];
}

function toUtc(ymd: string): Date {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function mais(data: string, n: number): string {
  const d = toUtc(data);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

export async function faltasDoPonto(cpf: string, admissao: string | null, afastamento: string): Promise<FaltasDoPonto | null> {
  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) return null;
  const inicioMes = `${afastamento.slice(0, 7)}-01`;
  const de = admissao && admissao > inicioMes ? admissao : inicioMes;
  if (de > afastamento) return null;

  const fmt = `${cpfLimpo.slice(0, 3)}.${cpfLimpo.slice(3, 6)}.${cpfLimpo.slice(6, 9)}-${cpfLimpo.slice(9)}`;
  const pessoas = await db
    .select({ id: schema.funcionario.id })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.cpf, [...new Set([cpf, cpfLimpo, fmt])]));
  const ids = pessoas.map((p) => p.id);
  if (ids.length === 0) return null;

  // Semana de segunda a domingo: busca a escala da semana inteira em volta.
  const dow = (toUtc(de).getUTCDay() + 6) % 7;
  const ini = mais(de, -dow);
  const [batidas, escala, atestados] = await Promise.all([
    db
      .selectDistinct({ dia: schema.pontoBatida.diaOperacional })
      .from(schema.pontoBatida)
      .where(
        and(
          inArray(schema.pontoBatida.funcionarioId, ids),
          isNull(schema.pontoBatida.excluidaEm),
          gte(schema.pontoBatida.diaOperacional, de),
          lte(schema.pontoBatida.diaOperacional, afastamento),
        ),
      ),
    db
      .select({ dia: schema.rhEscalaDia.dia, folga: schema.rhEscalaDia.folga })
      .from(schema.rhEscalaDia)
      .where(and(inArray(schema.rhEscalaDia.funcionarioId, ids), gte(schema.rhEscalaDia.dia, ini), lte(schema.rhEscalaDia.dia, afastamento))),
    db
      .select({ de: schema.funcionarioAtestado.dataInicio, ate: schema.funcionarioAtestado.dataFim })
      .from(schema.funcionarioAtestado)
      .where(
        and(
          inArray(schema.funcionarioAtestado.funcionarioId, ids),
          isNull(schema.funcionarioAtestado.canceladoEm),
          eq(schema.funcionarioAtestado.abona, true),
          lte(schema.funcionarioAtestado.dataInicio, afastamento),
          gte(schema.funcionarioAtestado.dataFim, de),
        ),
      ),
  ]);
  const trabalhou = new Set(batidas.map((b) => String(b.dia)));
  if (trabalhou.size === 0) return null;
  const folgaDia = new Map<string, boolean>();
  for (const e of escala) {
    const d = String(e.dia);
    folgaDia.set(d, (folgaDia.get(d) ?? false) || e.folga);
  }
  const abonado = (d: string) => atestados.some((a) => String(a.de) <= d && d <= String(a.ate));

  const semanas: SemanaFaltas[] = [];
  for (let seg = ini; seg <= afastamento; seg = mais(seg, 7)) {
    const dom = mais(seg, 6);
    const dias: string[] = [];
    for (let d = seg; d <= dom; d = mais(d, 1)) if (d >= de && d <= afastamento) dias.push(d);
    if (dias.length === 0) continue;
    const semPonto = dias.filter((d) => !trabalhou.has(d) && !abonado(d));
    const folgas = semPonto.filter((d) => folgaDia.get(d) === true);
    // Folga marcada na escala na semana (mesmo em dia trabalhado) = sem suposição.
    const temFolgaEscala = dias.some((d) => folgaDia.get(d) === true);
    const desconhecidos = semPonto.filter((d) => !folgaDia.has(d));
    const folgaSuposta = !temFolgaEscala && desconhecidos.length > 0;
    const faltas = Math.max(0, semPonto.length - folgas.length - (folgaSuposta ? 1 : 0));
    const dsr = faltas > 0 && (temFolgaEscala || folgaSuposta) ? 1 : 0;
    semanas.push({ de: dias[0], ate: dias[dias.length - 1], semPonto, folgas, folgaSuposta, faltas, dsr });
  }
  return {
    de,
    ate: afastamento,
    faltas: semanas.reduce((s, x) => s + x.faltas, 0),
    dsr: semanas.reduce((s, x) => s + x.dsr, 0),
    diasComPonto: trabalhou.size,
    semanas,
  };
}
