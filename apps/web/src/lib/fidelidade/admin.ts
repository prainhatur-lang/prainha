// Painel /fidelidade: organização do usuário, lista de cartões e usos.

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import type { FidelidadeConfig } from './config';
import { nivelPorCodigo, nivelPorVisitas } from './config';
import { formatarNumero } from './codigo';

/** Organização a partir da filial ativa do usuário (o cartão é do grupo). */
export async function orgDoUsuario(userId: string, filialId?: string | null) {
  const filiais = await filiaisDoUsuario(userId);
  const f = await escolherFilial(filiais, filialId ?? undefined);
  if (!f) return null;
  const [row] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, f.id))
    .limit(1);
  if (!row) return null;
  return {
    organizacaoId: row.organizacaoId,
    filialId: f.id,
    filiais: filiais.map((x) => ({ id: x.id, nome: x.nome })),
  };
}

export interface CartaoLinha {
  id: string;
  nome: string;
  telefone: string;
  numero: string;
  codigo: string;
  token: string;
  status: string;
  nivel: string;
  nivelCodigo: string;
  cor: string;
  garantido: boolean;
  nivelMinimo: string | null;
  nivelMinimoAte: string | null;
  visitas: number;
  usos: number;
  ultimoUso: string | null;
  aberto: boolean;
  wallet: string | null;
  convidadoEm: string | null;
  criadoEm: string;
}

export async function listarCartoes(organizacaoId: string, cfg: FidelidadeConfig): Promise<CartaoLinha[]> {
  const desde = diasAtrasBr(cfg.janelaDias - 1);
  const rows = (await db.execute(sql`
    SELECT c.id, c.nome, c.telefone, c.numero, c.codigo, c.token, c.status,
           c.nivel_minimo, c.nivel_minimo_ate::text AS nivel_minimo_ate,
           c.aberto_em IS NOT NULL AS aberto,
           c.google_salvo_em IS NOT NULL AS google,
           EXISTS (SELECT 1 FROM fidelidade_apple_registro a WHERE a.cartao_id = c.id) AS apple,
           c.convidado_em::text AS convidado_em, c.criado_em::text AS criado_em,
           (SELECT count(*)::int FROM fidelidade_visita v WHERE v.cartao_id = c.id AND v.data >= ${desde}::date) AS visitas,
           (SELECT count(*)::int FROM fidelidade_uso u WHERE u.cartao_id = c.id AND u.status = 'confirmado') AS usos,
           (SELECT max(u.confirmado_em)::text FROM fidelidade_uso u WHERE u.cartao_id = c.id AND u.status = 'confirmado') AS ultimo_uso
    FROM fidelidade_cartao c
    WHERE c.organizacao_id = ${organizacaoId}
    ORDER BY c.criado_em DESC
  `)) as unknown as Array<{
    id: string; nome: string; telefone: string; numero: string; codigo: string; token: string; status: string;
    nivel_minimo: string | null; nivel_minimo_ate: string | null; aberto: boolean; google: boolean; apple: boolean;
    convidado_em: string | null; criado_em: string; visitas: number; usos: number; ultimo_uso: string | null;
  }>;
  const hoje = hojeBr();
  return rows.map((r) => {
    const visitas = Number(r.visitas) || 0;
    let nivel = nivelPorVisitas(cfg, visitas);
    let garantido = false;
    const min = nivelPorCodigo(cfg, r.nivel_minimo);
    if (min && (!r.nivel_minimo_ate || r.nivel_minimo_ate >= hoje) && min.minVisitas > nivel.minVisitas) {
      nivel = min;
      garantido = true;
    }
    return {
      id: r.id,
      nome: r.nome,
      telefone: r.telefone,
      numero: formatarNumero(r.numero),
      codigo: r.codigo,
      token: r.token,
      status: r.status,
      nivel: nivel.nome,
      nivelCodigo: nivel.codigo,
      cor: nivel.cor,
      garantido,
      nivelMinimo: r.nivel_minimo,
      nivelMinimoAte: r.nivel_minimo_ate,
      visitas,
      usos: Number(r.usos) || 0,
      ultimoUso: r.ultimo_uso,
      aberto: !!r.aberto,
      wallet: r.apple && r.google ? 'Apple + Google' : r.apple ? 'Apple' : r.google ? 'Google' : null,
      convidadoEm: r.convidado_em,
      criadoEm: r.criado_em,
    };
  });
}

export interface UsoLinha {
  id: string;
  quando: string;
  casa: string;
  mesa: number | null;
  nome: string;
  nivel: string;
  pct: number;
  base: number;
  desconto: number;
  status: string;
}

export async function usosRecentes(organizacaoId: string, limite = 200): Promise<UsoLinha[]> {
  const rows = (await db.execute(sql`
    SELECT u.id, u.reservado_em::text AS quando, f.nome AS casa, u.mesa, c.nome, u.nivel,
           (u.pct_nivel + u.pct_bonus)::float AS pct, u.valor_base::float AS base,
           u.valor_desconto::float AS desconto, u.status
    FROM fidelidade_uso u
    JOIN fidelidade_cartao c ON c.id = u.cartao_id
    JOIN filial f ON f.id = u.filial_id
    WHERE c.organizacao_id = ${organizacaoId}
    ORDER BY u.reservado_em DESC
    LIMIT ${limite}
  `)) as unknown as Array<{
    id: string; quando: string; casa: string; mesa: number | null; nome: string; nivel: string;
    pct: number; base: number; desconto: number; status: string;
  }>;
  return rows.map((r) => ({ ...r, pct: Number(r.pct), base: Number(r.base), desconto: Number(r.desconto) }));
}
