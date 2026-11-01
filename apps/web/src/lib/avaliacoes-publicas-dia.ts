// Avaliações públicas (TripAdvisor e Google) pro relatório diário do WhatsApp.
//
// Pedido do dono (01/11/2026): o resumo só mostrava a nota do QR da mesa
// ("avalie e ganhe um drink"), que quase sempre dá 5 — as notas do TripAdvisor e
// do Google ficavam de fora.
//
// TripAdvisor: a leitura diária (cron 06:45, lib/tripadvisor.ts) guarda em
// `tripadvisor_resumo` quantas avaliações a casa tem em cada nota. A diferença
// entre a leitura da manhã seguinte ao dia e a anterior dá a nota de cada
// avaliação NOVA — mesmo as que não vieram na lista (o plano só manda 3). A API
// anda alguns dias atrás da página, então "nova" = apareceu desde a última
// leitura, não necessariamente escrita naquele dia.
//
// Google: lido AO VIVO (a política do Google não deixa guardar), só se a casa
// tem a conta ligada em /avaliacoes. Conta as avaliações criadas no dia
// operacional (05:00 → 05:00). Sem ligação, não aparece nada.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { googleConfigurado, lerAvaliacoes, tokenDeAcesso } from './google-avaliacoes';
import { ligacoesGoogle } from './google-avaliacoes-ligacao';

export interface TripadvisorDia {
  /** avaliações que apareceram desde a leitura anterior */
  novas: number;
  /** nota (1–5) → quantas novas com essa nota */
  porNota: Record<number, number>;
  /** nota geral e total da casa na última leitura */
  nota: number | null;
  total: number;
}

export interface GoogleDia {
  total: number;
  media: number | null;
  baixas: Array<{ nota: number; hora: string; texto: string }>;
  /** nota geral e total da ficha */
  notaGeral: number | null;
  totalGeral: number;
}

function somaDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Linha = { dia: string; nota: string | null; total: number; distribuicao: Record<string, number> | null };

export async function tripadvisorDoDia(filialId: string, dia: string): Promise<TripadvisorDia | null> {
  const ate = somaDias(dia, 1);
  const linhas = (await db.execute(sql`
    SELECT dia::text AS dia, nota::text AS nota, total, distribuicao
      FROM tripadvisor_resumo
     WHERE filial_id = ${filialId} AND dia <= ${ate}::date AND dia >= ${somaDias(dia, -7)}::date
     ORDER BY dia DESC
     LIMIT 2
  `)) as unknown as Linha[];
  const [depois, antes] = linhas;
  // Leitura velha (o cron não rodou) não fala deste dia.
  if (!depois || depois.dia < dia) return null;
  const porNota: Record<number, number> = {};
  let novas = 0;
  if (antes?.distribuicao && depois.distribuicao) {
    for (let n = 1; n <= 5; n++) {
      const dif = Number(depois.distribuicao[String(n)] ?? 0) - Number(antes.distribuicao[String(n)] ?? 0);
      if (dif > 0) {
        porNota[n] = dif;
        novas += dif;
      }
    }
  }
  return { novas, porNota, nota: depois.nota == null ? null : Number(depois.nota), total: Number(depois.total) || 0 };
}

export async function googleDoDia(filialId: string, dia: string): Promise<GoogleDia | null> {
  if (!googleConfigurado()) return null;
  const l = (await ligacoesGoogle([filialId])).get(filialId);
  if (!l?.refreshToken || !l.conta || !l.local) return null;
  const leitura = await lerAvaliacoes(await tokenDeAcesso(l.refreshToken), l.conta, l.local);
  const ini = Date.parse(`${dia}T05:00:00-03:00`);
  const fim = Date.parse(`${somaDias(dia, 1)}T05:00:00-03:00`);
  const doDia = leitura.avaliacoes.filter((a) => {
    const t = a.criadoEm ? Date.parse(a.criadoEm) : NaN;
    return a.nota != null && t >= ini && t < fim;
  });
  const hora = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '';
  return {
    total: doDia.length,
    media: doDia.length ? doDia.reduce((s, a) => s + (a.nota ?? 0), 0) / doDia.length : null,
    baixas: doDia
      .filter((a) => (a.nota ?? 5) <= 3)
      .map((a) => ({ nota: a.nota ?? 0, hora: hora(a.criadoEm), texto: a.texto })),
    notaGeral: leitura.media,
    totalGeral: leitura.total,
  };
}
