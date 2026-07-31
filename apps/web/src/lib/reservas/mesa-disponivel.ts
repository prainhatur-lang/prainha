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
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

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
    if (r.mesaJuntada) ocupadas.add(String(r.mesaJuntada).trim());
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

/** Checa se TODAS as mesas de um grupo (ex: mesa + mesaJuntada) estão livres —
 *  usado quando a reserva junta 2 mesas lateralmente. */
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
