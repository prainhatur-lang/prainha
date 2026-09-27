// Regras do cartão fidelidade. Sem linha em fidelidade_programa, vale o PADRAO.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export interface NivelFidelidade {
  codigo: string; // silver | gold | ...
  nome: string; // "Silver"
  /** visitas (dias distintos) na janela pra estar neste nível */
  minVisitas: number;
  /** % de desconto no consumo */
  pct: number;
  /** cor de fundo do cartão */
  cor: string;
  /** % de desconto no aluguel do espaço (orçamento de evento) */
  pctEspaco: number;
  /** reserva passa na frente do teto de mesas da área (prioridade) */
  prioridadeReserva: boolean;
}

export interface FidelidadeConfig {
  niveis: NivelFidelidade[];
  /** pontos % a mais de segunda a sexta, fora feriado */
  bonusDiaUtilPct: number;
  /** janela (dias) em que as visitas contam pro nível */
  janelaDias: number;
  /** teto do desconto por conta, em R$ (null = sem teto) */
  tetoDescontoReais: number | null;
  /** consumo mínimo pra usar o cartão, em R$ */
  consumoMinimoReais: number;
}

export const CONFIG_PADRAO: FidelidadeConfig = {
  niveis: [
    { codigo: 'silver', nome: 'Silver', minVisitas: 0, pct: 5, pctEspaco: 5, prioridadeReserva: true, cor: '#6E7780' },
    { codigo: 'gold', nome: 'Gold', minVisitas: 3, pct: 7, pctEspaco: 7, prioridadeReserva: true, cor: '#A8812A' },
    { codigo: 'platinum', nome: 'Platinum', minVisitas: 5, pct: 10, pctEspaco: 10, prioridadeReserva: true, cor: '#4E6272' },
    { codigo: 'black', nome: 'Black', minVisitas: 8, pct: 15, pctEspaco: 15, prioridadeReserva: true, cor: '#141414' },
    { codigo: 'diamante', nome: 'Diamante', minVisitas: 12, pct: 20, pctEspaco: 20, prioridadeReserva: true, cor: '#0F3A5F' },
  ],
  bonusDiaUtilPct: 5,
  janelaDias: 90,
  tetoDescontoReais: null,
  consumoMinimoReais: 0,
};

/** Normaliza o que veio do banco/formulário: níveis em ordem crescente de
 *  visitas, o primeiro sempre com 0 (todo membro tem pelo menos o 1º nível). */
export function normalizarConfig(c: Partial<FidelidadeConfig> | null | undefined): FidelidadeConfig {
  const base = { ...CONFIG_PADRAO, ...(c || {}) };
  const niveis = (Array.isArray(base.niveis) && base.niveis.length ? base.niveis : CONFIG_PADRAO.niveis)
    .map((n) => ({
      codigo: String(n.codigo || n.nome || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'nivel',
      nome: String(n.nome || n.codigo || 'Nível').slice(0, 30),
      minVisitas: Math.max(0, Math.floor(Number(n.minVisitas) || 0)),
      pct: Math.max(0, Math.min(50, Number(n.pct) || 0)),
      cor: /^#[0-9a-fA-F]{6}$/.test(String(n.cor)) ? String(n.cor) : '#333333',
      // configs salvas antes desses campos: espaço = % do consumo, prioridade ligada
      pctEspaco: Math.max(0, Math.min(50, n.pctEspaco == null ? Number(n.pct) || 0 : Number(n.pctEspaco) || 0)),
      prioridadeReserva: n.prioridadeReserva == null ? true : !!n.prioridadeReserva,
    }))
    .sort((a, b) => a.minVisitas - b.minVisitas);
  niveis[0].minVisitas = 0;
  return {
    niveis,
    bonusDiaUtilPct: Math.max(0, Math.min(30, Number(base.bonusDiaUtilPct) || 0)),
    janelaDias: Math.max(7, Math.min(365, Math.floor(Number(base.janelaDias) || 90))),
    tetoDescontoReais: base.tetoDescontoReais == null || !(Number(base.tetoDescontoReais) > 0)
      ? null : Number(base.tetoDescontoReais),
    consumoMinimoReais: Math.max(0, Number(base.consumoMinimoReais) || 0),
  };
}

export async function carregarPrograma(organizacaoId: string): Promise<{ ativo: boolean; config: FidelidadeConfig }> {
  const [p] = await db
    .select()
    .from(schema.fidelidadePrograma)
    .where(eq(schema.fidelidadePrograma.organizacaoId, organizacaoId))
    .limit(1);
  if (!p) return { ativo: true, config: CONFIG_PADRAO };
  return { ativo: p.ativo, config: normalizarConfig(p.config as Partial<FidelidadeConfig>) };
}

export function nivelPorVisitas(cfg: FidelidadeConfig, visitas: number): NivelFidelidade {
  let n = cfg.niveis[0];
  for (const x of cfg.niveis) if (visitas >= x.minVisitas) n = x;
  return n;
}

export function nivelPorCodigo(cfg: FidelidadeConfig, codigo: string | null | undefined): NivelFidelidade | null {
  return cfg.niveis.find((n) => n.codigo === codigo) ?? null;
}
