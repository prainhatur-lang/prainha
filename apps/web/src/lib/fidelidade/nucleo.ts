// Regras do cartão fidelidade: nível, desconto, reservar/confirmar uso do código.
//
// Cada casa tem o seu programa ("Cliente VIP Prainha Bar"): cartão, visitas e
// desconto só valem na casa do cartão.
//
// Fluxo:
//   0. no celular do dono (confirmado pelo WhatsApp), o cliente toca "Vou pagar
//      agora" → `gerarCodigoUso`: código novo de 4 letras que vale
//      CODIGO_MIN minutos. Cada toque gera outro (o anterior morre);
//   1. digita o código na tela do Pix → `reservarUso` calcula o desconto e
//      segura o código pra aquela mesa por RESERVA_MIN minutos;
//   2. o Pix (já com o desconto) cai → `confirmarUso`: conta a visita do dia
//      e mata o código;
//   3. Pix abandonado → `liberarUso` (ou a reserva expira sozinha).
//
// Caminho curto (10/10/2026, pedido do dono — "como cartão de embarque"): o
// cartão salvo na Apple/Google Wallet mostra NA FRENTE um código de 4 letras
// (`codigo_carteira`). Ele não tem prazo: vale até ser usado uma vez; o Pix
// caiu → `trocarCodigoCarteira` sorteia outro e a carteira é avisada. A loja
// digita do mesmo jeito (4 letras) — quem distingue os dois é `simularUso`.
// O "Vou pagar agora" continua igual, como reserva.

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
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
/** validade do código gerado no celular, até ser digitado na mesa */
export const CODIGO_MIN = 1;

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

/** HOJE é dia útil? (segunda a sexta, fora feriado/prolongado) */
export async function ehDiaUtilHoje(): Promise<boolean> {
  const hoje = hojeBr();
  const [y, m, d] = hoje.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !(await ehFeriadoOuProlongado(hoje));
}

/** Bônus de dia útil de HOJE (segunda a sexta, fora feriado/prolongado). */
export async function bonusHoje(cfg: FidelidadeConfig): Promise<number> {
  if (!cfg.bonusDiaUtilPct) return 0;
  return (await ehDiaUtilHoje()) ? cfg.bonusDiaUtilPct : 0;
}

/** O desconto no consumo vale HOJE nesta casa? Só é "não" na casa marcada
 *  como `soDiaUtil` em fim de semana ou feriado. */
export async function descontoValeHoje(cfg: FidelidadeConfig): Promise<boolean> {
  if (!cfg.soDiaUtil) return true;
  return ehDiaUtilHoje();
}

export const MSG_SO_DIA_UTIL = 'Nesta casa o desconto do Cliente VIP vale de segunda a sexta, fora feriado.';

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
  /** a casa do cartão (Cliente VIP <casa>) */
  filialId: string;
  nome: string;
  telefone: string;
  cpf?: string | null;
  nivelMinimo?: string | null;
  nivelMinimoAte?: string | null;
  origem?: string;
  filialOrigemId?: string | null;
  origemDetalhe?: string | null;
  cidade?: string | null;
  bairro?: string | null;
  /** o cliente pediu o cartão (balcão/manual) — já nasce aderido */
  aderido?: boolean;
}

/** Regra do dono (09/10/2026): o desconto do cartão é proibido pra funcionário
 *  do Prainha. Funcionário = cadastro ATIVO no RH de qualquer casa da mesma
 *  organização, casado pelo CPF ou pelo celular (DDD + 8 finais, porque o 9
 *  nem sempre está no cadastro). Devolve o nome do RH, ou null. */
export async function funcionarioDoCartao(
  filialId: string, telefone: string | null, cpf: string | null,
): Promise<string | null> {
  const tel = String(telefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const doc = String(cpf ?? '').replace(/\D/g, '');
  const ddd = tel.length >= 10 ? tel.slice(0, 2) : '';
  const fim = tel.length >= 10 ? tel.slice(-8) : '';
  if (doc.length !== 11 && !fim) return null;
  const r = (await db.execute(sql`
    SELECT f.nome
    FROM funcionario f
    JOIN filial fl ON fl.id = f.filial_id
    WHERE fl.organizacao_id = (SELECT organizacao_id FROM filial WHERE id = ${filialId})
      AND f.ativo AND f.data_desligamento IS NULL
      AND (
        (${doc}::text <> '' AND length(${doc}::text) = 11 AND f.cpf = ${doc}::text)
        OR (${fim}::text <> ''
          AND right(regexp_replace(coalesce(f.telefone, ''), '[^0-9]', '', 'g'), 8) = ${fim}::text
          AND left(regexp_replace(regexp_replace(coalesce(f.telefone, ''), '[^0-9]', '', 'g'), '^55', ''), 2) = ${ddd}::text)
      )
    LIMIT 1
  `)) as unknown as Array<{ nome: string }>;
  return r[0]?.nome ?? null;
}

export const MSG_FUNCIONARIO = 'O desconto do cartão não vale pra funcionário do Prainha.';

/** Cria o cartão (ou devolve o que já existe pro telefone). */
export async function criarCartao(inp: NovoCartaoInput): Promise<{ cartao: Cartao; novo: boolean }> {
  const telefone = normalizarTelefone(inp.telefone);
  if (!telefone) throw new Error('telefone inválido');
  const nome = inp.nome.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!nome) throw new Error('nome obrigatório');
  const org = await orgDaFilial(inp.filialId);
  if (!org) throw new Error('casa não encontrada');

  const [existe] = await db
    .select()
    .from(schema.fidelidadeCartao)
    .where(and(eq(schema.fidelidadeCartao.filialId, inp.filialId), eq(schema.fidelidadeCartao.telefone, telefone)))
    .limit(1);
  if (existe) {
    if (inp.aderido && !existe.aderidoEm) {
      const [c] = await db
        .update(schema.fidelidadeCartao)
        .set({ aderidoEm: new Date(), recusadoEm: null })
        .where(eq(schema.fidelidadeCartao.id, existe.id))
        .returning();
      return { cartao: c ?? existe, novo: false };
    }
    return { cartao: existe, novo: false };
  }
  if (await funcionarioDoCartao(inp.filialId, telefone, inp.cpf ?? null)) {
    throw new Error('É funcionário do Prainha — o cartão não vale pra funcionário.');
  }

  // colisão de código/número/token é rara; tenta de novo com outros
  for (let t = 0; t < 8; t++) {
    try {
      const [c] = await db
        .insert(schema.fidelidadeCartao)
        .values({
          organizacaoId: org,
          filialId: inp.filialId,
          nome,
          telefone,
          cpf: inp.cpf?.replace(/\D/g, '').slice(0, 11) || null,
          numero: gerarNumero(),
          token: gerarToken(),
          codigo: gerarCodigo(),
          nivelMinimo: inp.nivelMinimo || null,
          nivelMinimoAte: inp.nivelMinimo ? inp.nivelMinimoAte || null : null,
          origem: inp.origem || 'convite',
          filialOrigemId: inp.filialOrigemId || inp.filialId,
          origemDetalhe: inp.origemDetalhe || null,
          appleAuthToken: gerarAppleAuth(),
          cidade: inp.cidade?.slice(0, 100) || null,
          bairro: inp.bairro?.slice(0, 100) || null,
          aderidoEm: inp.aderido ? new Date() : null,
        })
        .onConflictDoNothing({ target: [schema.fidelidadeCartao.filialId, schema.fidelidadeCartao.telefone] })
        .returning();
      if (c) return { cartao: c, novo: true };
      const [ja] = await db
        .select()
        .from(schema.fidelidadeCartao)
        .where(and(eq(schema.fidelidadeCartao.filialId, inp.filialId), eq(schema.fidelidadeCartao.telefone, telefone)))
        .limit(1);
      if (ja) return { cartao: ja, novo: false };
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
    }
  }
  throw new Error('não consegui gerar um cartão único, tente de novo');
}

/** Mata o código atual (uso confirmado, bloqueio, pedido do admin): troca
 *  por um sorteado que não vale (sem validade). O próximo só nasce no
 *  celular do dono. */
export async function invalidarCodigo(cartaoId: string): Promise<void> {
  for (let t = 0; t < 10; t++) {
    try {
      await db
        .update(schema.fidelidadeCartao)
        .set({ codigo: gerarCodigo(), codigoExpiraEm: null, codigoAparelho: null, passAtualizadoEm: new Date() })
        .where(eq(schema.fidelidadeCartao.id, cartaoId));
      return;
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
    }
  }
  throw new Error('não consegui trocar o código');
}

/** "Vou pagar agora": código novo que vale CODIGO_MIN minutos. Quem chama
 *  já conferiu que o aparelho é do dono. Um código com reserva viva (Pix
 *  gerado e ainda não pago) não é trocado — senão o Pix em andamento perde o
 *  desconto. */
export async function gerarCodigoUso(
  cartaoId: string, aparelhoId: string,
): Promise<{ codigo: string; expiraEm: Date; emUso: boolean }> {
  const agora = new Date();
  const [viva] = await db
    .select({ id: schema.fidelidadeUso.id })
    .from(schema.fidelidadeUso)
    .where(and(
      eq(schema.fidelidadeUso.cartaoId, cartaoId),
      eq(schema.fidelidadeUso.status, 'reservado'),
      gte(schema.fidelidadeUso.expiraEm, agora),
    ))
    .limit(1);
  if (viva) {
    const [c] = await db
      .select({ codigo: schema.fidelidadeCartao.codigo, exp: schema.fidelidadeCartao.codigoExpiraEm })
      .from(schema.fidelidadeCartao)
      .where(eq(schema.fidelidadeCartao.id, cartaoId))
      .limit(1);
    if (c?.exp && c.exp > agora) return { codigo: c.codigo, expiraEm: c.exp, emUso: true };
  }
  const expiraEm = new Date(agora.getTime() + CODIGO_MIN * 60_000);
  for (let t = 0; t < 10; t++) {
    const codigo = gerarCodigo();
    try {
      // não pode sair igual ao código da frente do cartão da carteira de
      // ninguém (os dois são digitados no mesmo campo da loja)
      const gravou = await db
        .update(schema.fidelidadeCartao)
        .set({ codigo, codigoGeradoEm: agora, codigoExpiraEm: expiraEm, codigoAparelho: aparelhoId.slice(0, 16) })
        .where(and(
          eq(schema.fidelidadeCartao.id, cartaoId),
          sql`NOT EXISTS (SELECT 1 FROM fidelidade_cartao o WHERE o.codigo_carteira = ${codigo})`,
        ))
        .returning({ id: schema.fidelidadeCartao.id });
      if (gravou.length) return { codigo, expiraEm, emUso: false };
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
    }
  }
  throw new Error('não consegui gerar um código único');
}

// ------------------------------------------------- código da frente do cartão

/** Sorteia e grava o código da carteira. `soSeVazio`: só cria se o cartão
 *  ainda não tem (dois pedidos ao mesmo tempo não se atropelam). Devolve o
 *  código que ficou valendo, ou null se não deu. */
async function gravarCodigoCarteira(cartaoId: string, soSeVazio: boolean): Promise<string | null> {
  for (let t = 0; t < 12; t++) {
    const codigo = gerarCodigo();
    try {
      const gravou = await db
        .update(schema.fidelidadeCartao)
        .set({ codigoCarteira: codigo, passAtualizadoEm: new Date() })
        .where(and(
          eq(schema.fidelidadeCartao.id, cartaoId),
          soSeVazio ? isNull(schema.fidelidadeCartao.codigoCarteira) : undefined,
          // nem igual a um código VIVO do "Vou pagar agora" de outro cartão
          sql`NOT EXISTS (SELECT 1 FROM fidelidade_cartao o WHERE o.codigo = ${codigo} AND o.codigo_expira_em > now())`,
        ))
        .returning({ codigo: schema.fidelidadeCartao.codigoCarteira });
      if (gravou[0]?.codigo) return gravou[0].codigo;
      if (soSeVazio) {
        // outro pedido criou primeiro: fica com o dele
        const [c] = await db
          .select({ codigo: schema.fidelidadeCartao.codigoCarteira })
          .from(schema.fidelidadeCartao)
          .where(eq(schema.fidelidadeCartao.id, cartaoId))
          .limit(1);
        if (!c) return null;
        if (c.codigo) return c.codigo;
      }
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
    }
  }
  return null;
}

/** Código que aparece na frente do cartão da carteira. Nasce na primeira vez
 *  que o cartão vai pra Apple/Google Wallet — quem nunca salvou não tem código
 *  parado esperando alguém adivinhar. Só os passes chamam isto (a página
 *  pública do cartão NÃO mostra este código). */
export async function codigoDaCarteira(cartao: Pick<Cartao, 'id' | 'codigoCarteira'>): Promise<string> {
  if (cartao.codigoCarteira) return cartao.codigoCarteira;
  const codigo = await gravarCodigoCarteira(cartao.id, true);
  if (!codigo) throw new Error('não consegui gerar o código da carteira');
  return codigo;
}

/** Troca o código da carteira (pagou, bloqueio, pedido do painel). Cartão que
 *  nunca foi pra carteira fica como está. Quem chama avisa a Wallet. */
export async function trocarCodigoCarteira(cartaoId: string): Promise<void> {
  const [c] = await db
    .select({ codigo: schema.fidelidadeCartao.codigoCarteira })
    .from(schema.fidelidadeCartao)
    .where(eq(schema.fidelidadeCartao.id, cartaoId))
    .limit(1);
  if (!c?.codigo) return;
  if (!(await gravarCodigoCarteira(cartaoId, false))) throw new Error('não consegui trocar o código da carteira');
}

// ---------------------------------------------------------------- uso na loja

export type ErroUso =
  | 'programa_inativo' | 'codigo_invalido' | 'nao_encontrado' | 'bloqueado'
  | 'ja_usado_hoje' | 'em_uso' | 'consumo_minimo' | 'sem_desconto' | 'nao_aderido' | 'outra_casa'
  | 'funcionario' | 'so_dia_util';

export const MSG_ERRO: Record<ErroUso, string> = {
  programa_inativo: 'O Cliente VIP não está ativo nesta casa.',
  codigo_invalido: 'Código inválido — são 4 letras.',
  nao_encontrado: 'Código não encontrado ou vencido. Confira o código que está na frente do seu cartão, na carteira do celular (ele muda depois de cada pagamento). Ou abra o seu cartão e toque em "Vou pagar agora" pra gerar um novo (vale 1 minuto).',
  bloqueado: 'Este cartão está bloqueado. Fale com a gerência.',
  ja_usado_hoje: 'Este cartão já foi usado hoje. Volte amanhã!',
  em_uso: 'Este código já está sendo usado em outra conta agora.',
  consumo_minimo: 'O consumo ainda não atinge o mínimo pro desconto do cartão.',
  sem_desconto: 'Não há consumo pra aplicar o desconto.',
  nao_aderido: 'Cartão ainda não ativado: abra o link do convite e toque em "Quero meu cartão".',
  outra_casa: 'Esse cartão é de outra casa. O Cliente VIP só vale na casa do cartão.',
  funcionario: MSG_FUNCIONARIO,
  so_dia_util: MSG_SO_DIA_UTIL,
};

export interface Simulacao {
  cartao: Cartao;
  estado: EstadoCartao;
  pctNivel: number;
  pctBonus: number;
  pct: number;
  desconto: number;
  /** o código que foi digitado (o do "Vou pagar agora" ou o da carteira) */
  codigoUsado: string;
  /** true = veio da frente do cartão da carteira (codigo_carteira) */
  pelaCarteira: boolean;
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
  const { ativo, config: cfg } = await carregarPrograma(filialId);
  if (!ativo) return { ok: false, erro: 'programa_inativo' };
  if (!(await descontoValeHoje(cfg))) return { ok: false, erro: 'so_dia_util' };

  // só código VIVO (gerado no celular do dono há menos de CODIGO_MIN, ou
  // segurado por um Pix em andamento)
  const vivo = sql`${schema.fidelidadeCartao.codigoExpiraEm} > now()`;
  const [cartaoVivo] = await db
    .select()
    .from(schema.fidelidadeCartao)
    .where(and(eq(schema.fidelidadeCartao.filialId, filialId), eq(schema.fidelidadeCartao.codigo, codigo), vivo))
    .limit(1);
  // não é código vivo: pode ser o da frente do cartão da carteira (sem prazo,
  // vale até ser usado uma vez)
  const cartaoCarteira = cartaoVivo
    ? undefined
    : (await db
        .select()
        .from(schema.fidelidadeCartao)
        .where(and(eq(schema.fidelidadeCartao.filialId, filialId), eq(schema.fidelidadeCartao.codigoCarteira, codigo)))
        .limit(1))[0];
  const cartao = cartaoVivo ?? cartaoCarteira;
  const pelaCarteira = !cartaoVivo && !!cartaoCarteira;
  if (!cartao) {
    const [outra] = await db
      .select({ id: schema.fidelidadeCartao.id })
      .from(schema.fidelidadeCartao)
      .where(and(eq(schema.fidelidadeCartao.codigo, codigo), vivo))
      .limit(1);
    const outraCarteira = outra
      ? undefined
      : (await db
          .select({ id: schema.fidelidadeCartao.id })
          .from(schema.fidelidadeCartao)
          .where(eq(schema.fidelidadeCartao.codigoCarteira, codigo))
          .limit(1))[0];
    return { ok: false, erro: outra || outraCarteira ? 'outra_casa' : 'nao_encontrado' };
  }
  if (cartao.status !== 'ativo') return { ok: false, erro: 'bloqueado' };
  if (!cartao.aderidoEm) return { ok: false, erro: 'nao_aderido' };
  if (!cartao.funcionarioLiberado && await funcionarioDoCartao(cartao.filialId, cartao.telefone, cartao.cpf)) return { ok: false, erro: 'funcionario' };

  // um uso por dia
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
  return { ok: true, sim: { cartao, estado, pctNivel, pctBonus, pct, desconto, codigoUsado: codigo, pelaCarteira } };
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
        codigo: sim.codigoUsado,
        nivel: sim.estado.nivel.codigo,
        pctNivel: String(sim.pctNivel),
        pctBonus: String(sim.pctBonus),
        valorBase: String(r2(consumo)),
        valorDesconto: String(sim.desconto),
        expiraEm: expira,
        aparelho: sim.pelaCarteira ? 'carteira' : sim.cartao.codigoAparelho,
      })
      .returning({ id: schema.fidelidadeUso.id });
    // o código vive enquanto o Pix estiver aberto (mesmo depois do 1 min).
    // O da carteira não tem prazo — e o `codigo` do cartão, nesse caso, é um
    // sorteado que não vale: não pode ganhar validade aqui.
    if (!sim.pelaCarteira) {
      await tx
        .update(schema.fidelidadeCartao)
        .set({ codigoExpiraEm: expira })
        .where(eq(schema.fidelidadeCartao.id, sim.cartao.id));
    }
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
    .select({ codigo: schema.fidelidadeCartao.codigo, codigoCarteira: schema.fidelidadeCartao.codigoCarteira })
    .from(schema.fidelidadeCartao)
    .where(eq(schema.fidelidadeCartao.id, uso.cartaoId))
    .limit(1);
  if (cartao && cartao.codigo === uso.codigo) await invalidarCodigo(uso.cartaoId);
  else await tocarPass(uso.cartaoId);

  // pagou: o código da frente do cartão da carteira troca (qualquer que tenha
  // sido o código digitado) e o aviso logo abaixo leva o novo pro celular.
  // Falha aqui não derruba a confirmação — o Pix já caiu.
  if (cartao?.codigoCarteira) {
    try {
      await trocarCodigoCarteira(uso.cartaoId);
    } catch (e) {
      console.error('[fidelidade] troca do código da carteira', uso.cartaoId, (e as Error)?.message);
    }
  }

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
  const prog = await carregarPrograma(cartao.filialId);
  const cfg = prog.config;
  const estado = await estadoCartao(cartao, cfg);
  const bonus = await bonusHoje(cfg);
  const valeHoje = await descontoValeHoje(cfg);
  return { cfg, estado, bonus, prog, valeHoje };
}
