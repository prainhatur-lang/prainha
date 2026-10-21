// Atestado médico (pedido do dono 21/10/2026): pessoa + dias + foto.
// Abona no banco de horas (o dia conta como cumprido: entra o que faltou pra
// jornada do dia), aparece no ponto da semana e na escala do mês.
// Lançar/cancelar = 'ponto.corrigir'; ver a foto = 'ponto.read'.
// A foto vai no bucket privado dos extratos, pasta atestados/<filial>/ (dado de saúde).

import { db, schema } from '@concilia/db';
import { and, gte, inArray, isNull, lte } from 'drizzle-orm';
import { somarDias } from '@/lib/rh/dia-operacional';

export const BUCKET_ATESTADO = 'extratos-fechamento';
export const ATESTADO_TAMANHO_MAX = 20 * 1024 * 1024;
export const ATESTADO_EXTENSOES = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];
/** Teto de dias por lançamento (pega dedo errado no ano). */
export const ATESTADO_MAX_DIAS = 60;

export function extensaoAtestado(nome: string): string {
  return (nome.split('.').pop() ?? '').toLowerCase();
}

export function pastaAtestado(filialId: string): string {
  return `atestados/${filialId}`;
}

export interface AtestadoLinha {
  id: string;
  funcionarioId: string;
  dataInicio: string;
  dataFim: string;
  descricao: string | null;
  arquivoNome: string | null;
  temArquivo: boolean;
  /** false = guardado sem abonar no banco (21/10/2026). */
  abona: boolean;
  /** 'manual' (tela) ou 'celular' (QR + leitura). */
  origem: string;
}

/** Atestados válidos (não cancelados) das pessoas que tocam [de, ate]. */
export async function atestadosNoPeriodo(ids: string[], de: string, ate: string): Promise<AtestadoLinha[]> {
  if (ids.length === 0) return [];
  const t = schema.funcionarioAtestado;
  const rows = await db
    .select({
      id: t.id,
      funcionarioId: t.funcionarioId,
      dataInicio: t.dataInicio,
      dataFim: t.dataFim,
      descricao: t.descricao,
      arquivoNome: t.arquivoNome,
      arquivoPath: t.arquivoPath,
      abona: t.abona,
      origem: t.origem,
    })
    .from(t)
    .where(and(inArray(t.funcionarioId, ids), isNull(t.canceladoEm), lte(t.dataInicio, ate), gte(t.dataFim, de)))
    .orderBy(t.dataInicio);
  return rows.map((r) => ({
    id: r.id,
    funcionarioId: r.funcionarioId,
    dataInicio: r.dataInicio,
    dataFim: r.dataFim,
    descricao: r.descricao,
    arquivoNome: r.arquivoNome,
    temArquivo: !!r.arquivoPath,
    abona: r.abona !== false,
    origem: r.origem ?? 'manual',
  }));
}

/** Expande os atestados em dias: chave `${funcionarioId}|${dia}` → atestado. */
export function diasDeAtestado(rows: AtestadoLinha[], de?: string, ate?: string): Map<string, AtestadoLinha> {
  const out = new Map<string, AtestadoLinha>();
  for (const a of rows) {
    let ini = a.dataInicio;
    let fim = a.dataFim;
    if (de && ini < de) ini = de;
    if (ate && fim > ate) fim = ate;
    for (let d = ini; d <= fim; d = somarDias(d, 1)) out.set(`${a.funcionarioId}|${d}`, a);
  }
  return out;
}
