// Regras do cartão fidelidade: nível, desconto, reservar/confirmar uso do código.
//
// Fluxo na loja (vendas-local → /api/fidelidade/loja):
//   1. cliente digita o código na tela do Pix → `reservarUso` calcula o
//      desconto e segura o código pra aquela mesa por RESERVA_MIN minutos;
//   2. o Pix (já com o desconto) cai → `confirmarUso`: conta a visita do dia,
//      troca o código e manda a Wallet atualizar o cartão;
//   3. Pix abandonado → `liberarUso` (ou a reserva expira sozinha).

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { brDateStart, diasAtrasBr, hojeBr } from '@/lib/datas';
import { ehFeriadoOuProlongado } from '@/lib/reservas/feriados';
import {
  carregarPrograma, nivelPorCodigo, nivelPorVisitas,
  type FidelidadeConfig, type NivelFidelidade,
} from './config';
import {
  gerarAppleAuth, gerarCodigo, gerarNumero, gerarToken, normalizarCodigo, normalizarTelefone,
} from './codigo';

export const RESERVA_MIN = 45;

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

export interface EstadoCartao {
  nivel: NivelFidelidade;
  /** índice do nível em cfg.niveis */
  indice: number;
  visitas: number;
  garantido: boolean;
  proximo: NivelFidelidade | null;
  faltam: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Nível efetivo = o maior entre o das visitas na janela e o garantido (convite). */
export async function estadoCartao(cartao: Cartao, cfg: FidelidadeConfig): Promise<EstadoCartao> {
  const desde = diasAtrasBr(cfg.janelaDias - 1);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.fidelidadeVisita)
    .where(and(eq(schema.fidelidadeVisita.cartaoId, cartao.id), gte(schema.fidelidadeVisita.data, desde)));
  const visitas = Number(n) || 0;
  let nivel = nivelPorVisitas(cfg, visitas);
  let garantido = false;
  const min = nivelPorCodigo(cfg, cartao.nivelMinimo);
  if (min && (!cartao.nivelMinimoAte || cartao.nivelMinimoAte >= hojeBr()) && min.minVisitas > nivel.minVisitas) {
    nivel = min;
    garantido = true;
  }
  const indice = cfg.niveis.findIndex((x) => x.codigo === nivel.codigo);
  const proximo = cfg.niveis[indice + 1] ?? null;
  return {
    nivel, indice, visitas, garantido, proximo,
    faltam: proximo ? Math.max(0, proximo.minVisitas - visitas) : 0,
  };
}

/** Bônus de dia útil de HOJE (segunda a sexta, fora feriado/prolongado). */
export async function bonusHoje(cfg: FidelidadeConfig): Promise<number> {
  if (!cfg.bonusDiaUtilPct) return 0;
  const hoje = hojeBr();
  const [y, m, d] = hoje.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return 0;
  if (await ehFeriadoOuProlongado(hoje)) return 0;
  return cfg.bonusDiaUtilPct;
}

export function calcularDesconto(cfg: FidelidadeConfig, pct: number, consumo: number): number {
  let v = r2((consumo * pct) / 100);
  if (cfg.tetoDescontoReais != null) v = Math.min(v, cfg.tetoDescontoReais);
  return Math.max(0, v);
}

/** Primeiro nome + inicial do sobrenome — o que aparece na tela da mesa. */
export function nomeCurto(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return p[0] || '';
  return `${p[0]} ${p[p.length - 1][0]}.`;
}

// ---------------------------------------------------------------- criação

export interface NovoCartaoInput {
  organizacaoId: string;
  nome: string;
  telefone: string;
  cpf?: string | null;
  nivelMinimo?: string | null;
  nivelMinimoAte?: string | null;
  origem?: string;
  filialOrigemId?: string | null;
  origemDetalhe?: string | null;
}

/** Cria o cartão (ou devolve o que já existe pro telefone). */
export async function criarCartao(inp: NovoCartaoInput): Promise<{ cartao: Cartao; novo: boolean }> {
  const telefone = normalizarTelefone(inp.telefone);
  if (!telefone) throw new Error('telefone inválido');
  const nome = inp.nome.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!nome) throw new Error('nome obrigatório');

  const [existe] = await db
    .select()
    .from(schema.fidelidadeCartao)
    .where(and(eq(schema.fidelidadeCartao.organizacaoId, inp.organizacaoId), eq(schema.fidelidadeCartao.telefone, telefone)))
    .limit(1);
  if (existe) return { cartao: existe, novo: false };

  // colisão de código/número/token é rara; tenta de novo com outros
  for (let t = 0; t < 8; t++) {
    try {
      const [c] = await db
        .insert(schema.fidelidadeCartao)
        .values({
          organizacaoId: inp.organizacaoId,
          nome,
          telefone,
          cpf: inp.cpf?.replace(/\D/g, '').slice(0, 11) || null,
          numero: gerarNumero(),
          token: gerarToken(),
          codigo: gerarCodigo(),
          nivelMinimo: inp.nivelMinimo || null,
          nivelMinimoAte: inp.nivelMinimo ? inp.nivelMinimoAte || null : null,
          origem: inp.origem || 'convite',
          filialOrigemId: inp.filialOrigemId || null,
          origemDetalhe: inp.origemDetalhe || null,
          appleAuthToken: gerarAppleAuth(),
        })
        .onConflictDoNothing({ target: [schema.fidelidadeCartao.organizacaoId, schema.fidelidadeCartao.telefone] })
        .returning();
      if (c) return { cartao: c, novo: true };
      const [ja] = await db
        .select()
        .from(schema.fidelidadeCartao)
        .where(and(eq(schema.fidelidadeCartao.organizacaoId, inp.organizacaoId), eq(schema.fidelidadeCartao.telefone, telefone)))
        .limit(1);
      if (ja) return { cartao: ja, novo: false };
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
    }
  }
  throw new Error('não consegui gerar um cartão único, tente de novo');
}

/** Troca o código do cartão (uso confirmado ou pedido do admin). */
export async function trocarCodigo(cartaoId: string, organizacaoId: string): Promise<string> {
  for (let t = 0; t < 10; t++) {
    const codigo = gerarCodigo();
    try {
      await db
        .update(schema.fidelidadeCartao)
        .set({ codigo, codigoGeradoEm: new Date(), passAtualizadoEm: new Date() })
        .where(and(eq(schema.fidelidadeCartao.id, cartaoId), eq(schema.fidelidadeCartao.organizacaoId, organizacaoId)));
      return codigo;
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
    }
  }
  throw new Error('não consegui gerar um código único');
}

// ---------------------------------------------------------------- uso na loja

export type ErroUso =
  | 'programa_inativo' | 'codigo_invalido' | 'nao_encontrado' | 'bloqueado'
  | 'ja_usado_hoje' | 'em_uso' | 'consumo_minimo' | 'sem_desconto';

export const MSG_ERRO: Record<ErroUso, string> = {
  programa_inativo: 'O cartão fidelidade está pausado no momento.',
  codigo_invalido: 'Código inválido — são 4 letras.',
  nao_encontrado: 'Código não encontrado. Confira no seu cartão (ele muda a cada uso).',
  bloqueado: 'Este cartão está bloqueado. Fale com a gerência.',
  ja_usado_hoje: 'Este cartão já foi usado hoje. Volte amanhã!',
  em_uso: 'Este código já está sendo usado em outra conta agora.',
  consumo_minimo: 'O consumo ainda não atinge o mínimo pro desconto do cartão.',
  sem_desconto: 'Não há consumo pra aplicar o desconto.',
};

export interface Simulacao {
  cartao: Cartao;
  estado: EstadoCartao;
  pctNivel: number;
  pctBonus: number;
  pct: number;
  desconto: number;
}

async function orgDaFilial(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f?.org ?? null;
}

/** Valida o código e calcula o desconto, sem reservar nada. */
export async function simularUso(
  filialId: string, codigoBruto: unknown, consumo: number,
): Promise<{ ok: true; sim: Simulacao } | { ok: false; erro: ErroUso }> {
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) return { ok: false, erro: 'codigo_invalido' };
  const org = await orgDaFilial(filialId);
  if (!org) return { ok: false, erro: 'nao_encontrado' };
  const { ativo, config: cfg } = await carregarPrograma(org);
  if (!ativo) return { ok: false, erro: 'programa_inativo' };

  const [cartao] = await db
    .select()
    .from(schema.fidelidadeCartao)
    .where(and(eq(schema.fidelidadeCartao.organizacaoId, org), eq(schema.fidelidadeCartao.codigo, codigo)))
    .limit(1);
  if (!cartao) return { ok: false, erro: 'nao_encontrado' };
  if (cartao.status !== 'ativo') return { ok: false, erro: 'bloqueado' };

  // um uso por dia (em qualquer casa)
  const [hoje] = await db
    .select({ id: schema.fidelidadeUso.id })
    .from(schema.fidelidadeUso)
    .where(and(
      eq(schema.fidelidadeUso.cartaoId, cartao.id),
      eq(schema.fidelidadeUso.status, 'confirmado'),
      gte(schema.fidelidadeUso.confirmadoEm, brDateStart(hojeBr())),
    ))
    .limit(1);
  if (hoje) return { ok: false, erro: 'ja_usado_hoje' };

  const base = r2(Number(consumo) || 0);
  if (base <= 0) return { ok: false, erro: 'sem_desconto' };
  if (cfg.consumoMinimoReais && base < cfg.consumoMinimoReais) return { ok: false, erro: 'consumo_minimo' };

  const estado = await estadoCartao(cartao, cfg);
  const pctNivel = estado.nivel.pct;
  const pctBonus = await bonusHoje(cfg);
  const pct = pctNivel + pctBonus;
  const desconto = calcularDesconto(cfg, pct, base);
  if (desconto <= 0) return { ok: false, erro: 'sem_desconto' };
  return { ok: true, sim: { cartao, estado, pctNivel, pctBonus, pct, desconto } };
}

export interface UsoReservado {
  usoId: string;
  nome: string;
  nivel: string;
  pctNivel: number;
  pctBonus: number;
  pct: number;
  desconto: number;
  expiraEm: string;
}

/** Segura o código pra uma conta. Mesma mesa pedindo de novo (ex.: gerou outro
 *  QR) substitui a reserva anterior; outra mesa com reserva viva → 'em_uso'. */
export async function reservarUso(
  filialId: string, codigoBruto: unknown, consumo: number, mesa: number | null,
): Promise<{ ok: true; uso: UsoReservado } | { ok: false; erro: ErroUso }> {
  const s = await simularUso(filialId, codigoBruto, consumo);
  if (!s.ok) return s;
  const { sim } = s;
  const agora = new Date();
  const expira = new Date(agora.getTime() + RESERVA_MIN * 60_000);

  const r = await db.transaction(async (tx) => {
    // trava o cartão: duas mesas digitando o mesmo código ao mesmo tempo
    await tx
      .select({ id: schema.fidelidadeCartao.id })
      .from(schema.fidelidadeCartao)
      .where(eq(schema.fidelidadeCartao.id, sim.cartao.id))
      .for('update');
    const vivas = await tx
      .select()
      .from(schema.fidelidadeUso)
      .where(and(
        eq(schema.fidelidadeUso.cartaoId, sim.cartao.id),
        eq(schema.fidelidadeUso.status, 'reservado'),
        gte(schema.fidelidadeUso.expiraEm, agora),
      ));
    const outra = vivas.find((u) => !(u.filialId === filialId && (u.mesa ?? null) === mesa));
    if (outra) return null;
    if (vivas.length) {
      await tx
        .update(schema.fidelidadeUso)
        .set({ status: 'expirado' })
        .where(inArray(schema.fidelidadeUso.id, vivas.map((u) => u.id)));
    }
    const [u] = await tx
      .insert(schema.fidelidadeUso)
      .values({
        cartaoId: sim.cartao.id,
        filialId,
        mesa,
        codigo: sim.cartao.codigo,
        nivel: sim.estado.nivel.codigo,
        pctNivel: String(sim.pctNivel),
        pctBonus: String(sim.pctBonus),
        valorBase: String(r2(consumo)),
        valorDesconto: String(sim.desconto),
        expiraEm: expira,
      })
      .returning({ id: schema.fidelidadeUso.id });
    return u;
  });
  if (!r) return { ok: false, erro: 'em_uso' };
  return {
    ok: true,
    uso: {
      usoId: r.id,
      nome: nomeCurto(sim.cartao.nome),
      nivel: sim.estado.nivel.nome,
      pctNivel: sim.pctNivel,
      pctBonus: sim.pctBonus,
      pct: sim.pct,
      desconto: sim.desconto,
      expiraEm: expira.toISOString(),
    },
  };
}

/** Pix pago. Idempotente; confirma até reserva expirada (o dinheiro já entrou
 *  com o desconto, então o uso vale). Conta a visita, troca o código e avisa a
 *  Wallet. */
export async function confirmarUso(
  filialId: string, usoId: string, txid: string | null,
): Promise<{ ok: boolean; jaConfirmado?: boolean; erro?: string }> {
  const [uso] = await db
    .select()
    .from(schema.fidelidadeUso)
    .where(and(eq(schema.fidelidadeUso.id, usoId), eq(schema.fidelidadeUso.filialId, filialId)))
    .limit(1);
  if (!uso) return { ok: false, erro: 'uso não encontrado' };
  if (uso.status === 'confirmado') return { ok: true, jaConfirmado: true };

  const agora = new Date();
  const org = await orgDaFilial(filialId);
  if (!org) return { ok: false, erro: 'filial não encontrada' };

  const virou = await db
    .update(schema.fidelidadeUso)
    .set({ status: 'confirmado', confirmadoEm: agora, txid: txid ? txid.slice(0, 64) : uso.txid })
    .where(and(eq(schema.fidelidadeUso.id, usoId), inArray(schema.fidelidadeUso.status, ['reservado', 'expirado'])))
    .returning({ id: schema.fidelidadeUso.id });
  if (!virou.length) return { ok: true, jaConfirmado: true };

  await db
    .insert(schema.fidelidadeVisita)
    .values({ cartaoId: uso.cartaoId, filialId, data: hojeBr(), origem: 'pix', usoId })
    .onConflictDoNothing();

  // outras reservas do mesmo código morrem junto (o código vai mudar)
  await db
    .update(schema.fidelidadeUso)
    .set({ status: 'expirado' })
    .where(and(eq(schema.fidelidadeUso.cartaoId, uso.cartaoId), eq(schema.fidelidadeUso.status, 'reservado')));

  const [cartao] = await db
    .select({ codigo: schema.fidelidadeCartao.codigo })
    .from(schema.fidelidadeCartao)
    .where(eq(schema.fidelidadeCartao.id, uso.cartaoId))
    .limit(1);
  if (cartao && cartao.codigo === uso.codigo) await trocarCodigo(uso.cartaoId, org);
  else await tocarPass(uso.cartaoId);

  await avisarWallet(uso.cartaoId);
  return { ok: true };
}

/** Pix abandonado/cancelado: solta o código. */
export async function liberarUso(filialId: string, usoId: string): Promise<void> {
  await db
    .update(schema.fidelidadeUso)
    .set({ status: 'expirado' })
    .where(and(
      eq(schema.fidelidadeUso.id, usoId),
      eq(schema.fidelidadeUso.filialId, filialId),
      eq(schema.fidelidadeUso.status, 'reservado'),
    ));
}

/** Marca que o que aparece no cartão mudou (Last-Modified pra Apple). */
export async function tocarPass(cartaoId: string): Promise<void> {
  await db
    .update(schema.fidelidadeCartao)
    .set({ passAtualizadoEm: new Date() })
    .where(eq(schema.fidelidadeCartao.id, cartaoId));
}

/** Empurra a atualização pros cartões salvos na Apple/Google Wallet. Nunca
 *  derruba quem chamou — Wallet fora do ar não pode travar o caixa. */
export async function avisarWallet(cartaoId: string): Promise<void> {
  try {
    const { pushApple } = await import('./apple');
    await pushApple(cartaoId);
  } catch (e) {
    console.error('[fidelidade] push apple', cartaoId, (e as Error)?.message);
  }
  try {
    const { atualizarGoogle } = await import('./google');
    await atualizarGoogle(cartaoId);
  } catch (e) {
    console.error('[fidelidade] google wallet', cartaoId, (e as Error)?.message);
  }
}

/** Tudo que a página do cartão e os passes precisam mostrar. */
export async function dadosDoCartao(cartao: Cartao) {
  const { config: cfg } = await carregarPrograma(cartao.organizacaoId);
  const estado = await estadoCartao(cartao, cfg);
  const bonus = await bonusHoje(cfg);
  return { cfg, estado, bonus };
}
