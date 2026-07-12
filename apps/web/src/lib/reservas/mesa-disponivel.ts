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
 *  com sua mesa atual. */
export async function mesasOcupadas(params: {
  filialId: string;
  data: string;
  area: string;
  excluirReservaId?: string;
}): Promise<Set<string>> {
  const { filialId, data, area, excluirReservaId } = params;
  const condicoes = [
    eq(schema.reserva.filialId, filialId),
    eq(schema.reserva.data, data),
    eq(schema.reserva.area, area),
    inArray(schema.reserva.status, STATUS_ATIVOS),
  ];
  if (excluirReservaId) condicoes.push(ne(schema.reserva.id, excluirReservaId));

  const ativas = await db
    .select({ mesa: schema.reserva.mesa })
    .from(schema.reserva)
    .where(and(...condicoes));

  const ocupadas = new Set(ativas.filter((r) => r.mesa).map((r) => String(r.mesa).trim()));

  if (data === hojeBr()) {
    const doConsumer = await mesasOcupadasNoConsumer(filialId);
    for (const m of doConsumer) ocupadas.add(m);
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
}): Promise<boolean> {
  const ocupadas = await mesasOcupadas(params);
  return !ocupadas.has(String(params.mesa).trim());
}
