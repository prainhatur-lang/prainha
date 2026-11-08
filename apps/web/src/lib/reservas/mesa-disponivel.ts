// Checagem de conflito de mesa: uma mesa só pode estar em UMA reserva ativa
// (pendente|confirmada|sentada) por vez, no mesmo espaço/data. Usado tanto na
// criação manual (admin) quanto na edição/troca de mesa (recepção) e na
// alocação automática do fluxo público de reserva.
//
// Pra HOJE, também soma as mesas fisicamente ocupadas no Consumer (comanda
// aberta = PEDIDOS.NUMERO, sincronizado via CDC pra tabela `pedido`) — uma
// mesa com cliente sentado (mesmo sem ter vindo de reserva) não pode ser
// oferecida. Não olha Consumer pra datas futuras (comanda de hoje não diz
// nada sobre disponibilidade de daqui a uma semana). Sujeito ao atraso do
// agente-local (~15min, ciclo padrão) — não é tempo real.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { parseJuntadas } from './mesas-juntadas';

const STATUS_ATIVOS = ['pendente', 'confirmada', 'sentada'];

// Reserva de espaço com taxa (ex: Lounge) nasce "aguardando" pagamento e
// segura a mesa — mas se ninguém pagar, não pode travar a mesa pra sempre.
// Expira (lazy, sem cron) depois desse tempo.
const PAGAMENTO_TIMEOUT_MS = 20 * 60 * 1000;

/** Mesas com comanda aberta agora no Consumer (só faz sentido pra hoje). */
export async function mesasOcupadasNoConsumer(filialId: string): Promise<Set<string>> {
  const abertas = await db
    .select({ numero: schema.pedido.numero })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataFechamento),
        isNull(schema.pedido.dataDelete),
      ),
    );
  return new Set(abertas.filter((p) => p.numero != null).map((p) => String(p.numero)));
}

/** Mesas ocupadas por reserva ativa num espaço/data (+ Consumer, se hoje).
 *  `excluirReservaId` serve pra edição: a própria reserva não deve "brigar"
 *  com sua mesa atual. `mesasValidas` = números de mesa que pertencem a esse
 *  espaço — filtra a ocupação do Consumer, que vem da FILIAL INTEIRA (não é
 *  escopada por espaço). SEM esse filtro, um espaço pequeno com teto baixo
 *  (`percentualReserva`) mostra "lotado" só porque a casa tem várias mesas
 *  abertas em QUALQUER área — bug real encontrado 20/07/2026: Deck Superior
 *  (11 mesas, teto 8) e Lounges (3 mesas) apareciam sempre lotados porque
 *  ocupadas.size somava as ~46 comandas abertas da casa toda, não só as
 *  desse espaço. */
export async function mesasOcupadas(params: {
  filialId: string;
  data: string;
  area: string;
  excluirReservaId?: string;
  mesasValidas?: string[];
}): Promise<Set<string>> {
  const { filialId, data, area, excluirReservaId, mesasValidas } = params;
  const condicoes = [
    eq(schema.reserva.filialId, filialId),
    eq(schema.reserva.data, data),
    eq(schema.reserva.area, area),
    inArray(schema.reserva.status, STATUS_ATIVOS),
  ];
  if (excluirReservaId) condicoes.push(ne(schema.reserva.id, excluirReservaId));

  const ativas = await db
    .select({
      id: schema.reserva.id,
      mesa: schema.reserva.mesa,
      mesaJuntada: schema.reserva.mesaJuntada,
      pagamentoStatus: schema.reserva.pagamentoStatus,
      criadoEm: schema.reserva.criadoEm,
    })
    .from(schema.reserva)
    .where(and(...condicoes));

  const agora = Date.now();
  const expiradas: string[] = [];
  const validas = ativas.filter((r) => {
    if (r.pagamentoStatus !== 'aguardando') return true;
    const expirou = agora - new Date(r.criadoEm).getTime() > PAGAMENTO_TIMEOUT_MS;
    if (expirou) expiradas.push(r.id);
    return !expirou;
  });

  if (expiradas.length > 0) {
    await db
      .update(schema.reserva)
      .set({ status: 'cancelada', pagamentoStatus: 'expirado' })
      .where(inArray(schema.reserva.id, expiradas));
  }

  const ocupadas = new Set<string>();
  for (const r of validas) {
    if (r.mesa) ocupadas.add(String(r.mesa).trim());
    for (const m of parseJuntadas(r.mesaJuntada)) ocupadas.add(m);
  }

  if (data === hojeBr()) {
    const doConsumer = await mesasOcupadasNoConsumer(filialId);
    const validasSet = mesasValidas ? new Set(mesasValidas.map((m) => String(m).trim())) : null;
    for (const m of doConsumer) {
      if (!validasSet || validasSet.has(m)) ocupadas.add(m);
    }
  }

  return ocupadas;
}

/** Checa se uma mesa específica está livre pra uma reserva (nova ou edição). */
export async function mesaEstaLivre(params: {
  filialId: string;
  data: string;
  area: string;
  mesa: string;
  excluirReservaId?: string;
  mesasValidas?: string[];
}): Promise<boolean> {
  const ocupadas = await mesasOcupadas(params);
  return !ocupadas.has(String(params.mesa).trim());
}

/** Checa se TODAS as mesas de um grupo (mesa + mesas juntadas) estão livres —
 *  usado quando a reserva junta mesas lateralmente. */
export async function mesasEstaoLivres(params: {
  filialId: string;
  data: string;
  area: string;
  mesas: string[];
  excluirReservaId?: string;
  mesasValidas?: string[];
}): Promise<boolean> {
  const { mesas, ...resto } = params;
  const ocupadas = await mesasOcupadas(resto);
  return mesas.every((m) => !ocupadas.has(String(m).trim()));
}

// ─── Teto que respira com reserva não confirmada ───────────────────────────
// Regra do dono 08/11/2026: "toda vez que as reservas não forem confirmadas ou
// que forem canceladas, a gente ir abrindo uma parte pra reservar mais pessoas,
// pra não travar a casa e a pessoa não aparecer". Histórico do Bar (60 dias,
// mesa grátis): só 29% das não confirmadas vieram. Então, PRO TETO (percentual
// de reserva), reserva pendente sem confirmação do cliente pesa pelo
// comparecimento histórico da casa (entre 30% e 50%; sem histórico, 50%).
// Cancelada já sai da conta. A mesa física continua presa — só abre vaga no
// teto, nunca dá a mesma mesa pra dois (alocação segue o `ocupadas` normal).

const PESO_MIN = 0.3;
const PESO_MAX = 0.5;
const cachePeso = new Map<string, { peso: number; em: number }>();

/** Fração das reservas grátis não confirmadas que costuma aparecer (60 dias). */
export async function pesoNaoConfirmada(filialId: string): Promise<number> {
  const c = cachePeso.get(filialId);
  if (c && Date.now() - c.em < 30 * 60 * 1000) return c.peso;
  let peso = PESO_MAX;
  try {
    const [r] = (await db.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'sentada')::int AS vieram,
             count(*) FILTER (WHERE status IN ('sentada', 'no_show'))::int AS total
      FROM reserva
      WHERE filial_id = ${filialId}
        AND data BETWEEN (${hojeBr()}::date - 60) AND (${hojeBr()}::date - 1)
        AND coalesce(valor, 0) = 0
        AND confirmada_cliente_em IS NULL
    `)) as unknown as Array<{ vieram: number; total: number }>;
    if (r && r.total >= 30) peso = Math.min(PESO_MAX, Math.max(PESO_MIN, r.vieram / r.total));
  } catch {
    /* sem histórico: fica no teto de 50% */
  }
  cachePeso.set(filialId, { peso, em: Date.now() });
  return peso;
}

/** Quantas mesas contam PRO TETO: `ocupadas.size` menos a parte das reservas
 *  pendentes (grátis, sem confirmação do cliente) que historicamente não vem. */
export async function ocupadasParaTeto(params: {
  filialId: string;
  data: string;
  area: string;
  ocupadas: Set<string>;
  excluirReservaId?: string;
}): Promise<number> {
  const { filialId, data, area, ocupadas, excluirReservaId } = params;
  try {
    const rows = await db
      .select({ mesa: schema.reserva.mesa, mesaJuntada: schema.reserva.mesaJuntada })
      .from(schema.reserva)
      .where(
        and(
          eq(schema.reserva.filialId, filialId),
          eq(schema.reserva.data, data),
          eq(schema.reserva.area, area),
          eq(schema.reserva.status, 'pendente'),
          isNull(schema.reserva.confirmadaClienteEm),
          isNull(schema.reserva.pagamentoStatus),
          ...(excluirReservaId ? [ne(schema.reserva.id, excluirReservaId)] : []),
        ),
      );
    let mesasPendentes = 0;
    for (const r of rows) {
      if (r.mesa && ocupadas.has(String(r.mesa).trim())) mesasPendentes += 1;
      for (const m of parseJuntadas(r.mesaJuntada)) if (ocupadas.has(m)) mesasPendentes += 1;
    }
    if (mesasPendentes === 0) return ocupadas.size;
    const peso = await pesoNaoConfirmada(filialId);
    return ocupadas.size - mesasPendentes + Math.ceil(mesasPendentes * peso);
  } catch {
    return ocupadas.size;
  }
}
