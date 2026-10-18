// PATCH /api/reservas/[id] — atualiza status / mesa / area / data / hora de uma reserva.
// DELETE /api/reservas/[id] — apaga reserva feita por engano (admin).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { estornarReservaSePago } from '@/lib/reservas/estorno';
import { filiaisDoUsuario } from '@/lib/filiais';
import { mesasEstaoLivres, mesasOcupadas } from '@/lib/reservas/mesa-disponivel';
import { hojeBr } from '@/lib/datas';
import { mesasDaReserva, parseJuntadas, serializeJuntadas } from '@/lib/reservas/mesas-juntadas';
import { registrarAlteracoesReserva } from '@/lib/reservas/alteracoes';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS = new Set(['pendente', 'confirmada', 'sentada', 'cancelada', 'no_show', 'concluida']);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;

  const { id } = await params;
  const b = await request.json().catch(() => null);

  const set: Record<string, unknown> = { atualizadoEm: sql`now()` };
  if (typeof b?.status === 'string') {
    if (!STATUS.has(b.status)) return NextResponse.json({ error: 'status inválido' }, { status: 400 });
    // Cancelar pelo painel é ato de ADMINISTRADOR (regra do Elison, 16/08):
    // exige reserva.delete (recepção/vendas têm só read/create/update) — e o
    // cancelamento dispara estorno INTEGRAL automático do Pix.
    if (b.status === 'cancelada') {
      const semPerm = await negarSemPerm(user.id, 'reserva.delete');
      if (semPerm) {
        return NextResponse.json(
          { error: 'cancelar reserva é restrito ao administrador' },
          { status: 403 },
        );
      }
    }
    set.status = b.status;
  }
  // Taxa devolvida FORA da Cielo (dinheiro/Pix manual no balcão) — marca o
  // pagamento como 'estornado_manual' pra NUNCA mais estornar automático
  // (cancelar, cron retry-estornos etc). Caso Italo/Ingrid 13→22/09/2026:
  // devolveram em dinheiro e o Cancelar do painel ia devolver de novo.
  const devolvidoManual = b?.devolvidoManual === true;
  if (devolvidoManual) {
    const semPerm = await negarSemPerm(user.id, 'reserva.delete');
    if (semPerm) {
      return NextResponse.json({ error: 'marcar devolução manual é restrito ao administrador' }, { status: 403 });
    }
    set.pagamentoStatus = 'estornado_manual';
  }
  if (b?.mesa !== undefined) set.mesa = typeof b.mesa === 'string' && b.mesa.trim() ? b.mesa.trim().slice(0, 20) : null;
  // Mesas extras juntadas lateralmente (grupo maior que 1 mesa só) — lista
  // (`mesasJuntadas: ['13','14']`) ou texto ("13,14"). null/[] = desfaz a
  // junção (volta a ser só a mesa principal).
  if (Array.isArray(b?.mesasJuntadas)) {
    set.mesaJuntada = serializeJuntadas(
      b.mesasJuntadas.filter((x: unknown): x is string => typeof x === 'string'),
      typeof set.mesa === 'string' ? set.mesa : null,
    );
  } else if (b?.mesaJuntada !== undefined) {
    set.mesaJuntada = serializeJuntadas(
      parseJuntadas(typeof b.mesaJuntada === 'string' ? b.mesaJuntada : null),
      typeof set.mesa === 'string' ? set.mesa : null,
    );
  }
  if (b?.area !== undefined) set.area = typeof b.area === 'string' && b.area.trim() ? b.area.trim().slice(0, 100) : null;
  if (b?.observacao !== undefined)
    set.observacao = typeof b.observacao === 'string' && b.observacao.trim() ? b.observacao.trim().slice(0, 2000) : null;
  if (b?.preferencias !== undefined)
    set.preferencias = typeof b.preferencias === 'string' && b.preferencias.trim() ? b.preferencias.trim().slice(0, 500) : null;
  if (typeof b?.bebidaConfirmada === 'boolean') set.bebidaConfirmada = b.bebidaConfirmada;
  if (b?.bebidaPedido !== undefined)
    set.bebidaPedido = typeof b.bebidaPedido === 'string' && b.bebidaPedido.trim() ? b.bebidaPedido.trim().slice(0, 100) : null;
  // Numero de pessoas editavel na recepcao (cliente mudou o tamanho do grupo).
  if (b?.pessoas !== undefined) {
    const n = Number(b.pessoas);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      return NextResponse.json({ error: 'pessoas inválido' }, { status: 400 });
    }
    set.pessoas = n;
  }
  // Data/hora editáveis pelo painel (dono 14/10/2026: "errei a data e não
  // consigo alterar"). Só grava se a mesa da reserva estiver livre no dia
  // novo — checado lá embaixo, com o estado atual em mãos. `semMesa: true`
  // = muda a data mesmo com a mesa tomada e solta a mesa (escolhe depois).
  if (b?.data !== undefined) {
    if (typeof b.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.data)) {
      return NextResponse.json({ error: 'data inválida' }, { status: 400 });
    }
    if (b.data < hojeBr()) return NextResponse.json({ error: 'essa data já passou' }, { status: 400 });
    set.data = b.data;
  }
  if (b?.hora !== undefined) {
    if (typeof b.hora !== 'string' || !/^\d{2}:\d{2}$/.test(b.hora)) {
      return NextResponse.json({ error: 'hora inválida' }, { status: 400 });
    }
    set.hora = b.hora;
  }
  const soltarMesaSeOcupada = b?.semMesa === true;
  const avisarCliente = b?.avisarCliente !== false;

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ error: 'sem filiais' }, { status: 403 });

  // Busca o estado atual quando mexe em mesa, status ou confirma a bebida —
  // usado pra checagem de conflito de mesa, aviso no WhatsApp (troca de
  // mesa/no-show/cancelamento) E pra enfileirar o lançamento da bebida no
  // Consumer quando confirmada.
  const mudaMesa = typeof set.mesa === 'string';
  const mudaMesaJuntada = 'mesaJuntada' in set;
  const mudaStatus = typeof set.status === 'string';
  const vaiSentar = set.status === 'sentada';
  const confirmaBebida = set.bebidaConfirmada === true;
  let atual: {
    filialId: string;
    data: string;
    hora: string;
    area: string | null;
    mesa: string | null;
    mesaJuntada: string | null;
    status: string;
    clienteNome: string;
    clienteTelefone: string | null;
    pessoas: number;
    observacao: string | null;
    bebidaPedido: string | null;
    bebidaComboQtd: number | null;
    bebidaCodigoPdv: number | null;
    pagamentoStatus: string | null;
    pagamentoId: string | null;
    pagamentoValor: string | null;
  } | null = null;
  {
    const [row] = await db
      .select({
        filialId: schema.reserva.filialId,
        data: schema.reserva.data,
        hora: schema.reserva.hora,
        area: schema.reserva.area,
        mesa: schema.reserva.mesa,
        mesaJuntada: schema.reserva.mesaJuntada,
        status: schema.reserva.status,
        clienteNome: schema.reserva.clienteNome,
        clienteTelefone: schema.reserva.clienteTelefone,
        pessoas: schema.reserva.pessoas,
        observacao: schema.reserva.observacao,
        bebidaPedido: schema.reserva.bebidaPedido,
        bebidaComboQtd: schema.reserva.bebidaComboQtd,
        bebidaCodigoPdv: schema.reserva.bebidaCodigoPdv,
        pagamentoStatus: schema.reserva.pagamentoStatus,
        pagamentoId: schema.reserva.pagamentoId,
        pagamentoValor: schema.reserva.pagamentoValor,
      })
      .from(schema.reserva)
      .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
    if (devolvidoManual && row.pagamentoStatus !== 'pago' && !(row.pagamentoStatus ?? '').startsWith('estorno_falhou')) {
      return NextResponse.json(
        { error: `não há taxa a devolver nesta reserva (pagamento: ${row.pagamentoStatus ?? 'nenhum'})` },
        { status: 400 },
      );
    }
    atual = row;
  }

  // Confirmou a bebida (recepção clicou "quer sim, senta"): se veio do
  // catálogo real (tem código PDV) e já tem mesa, entra na fila do agente
  // pra lançar na comanda assim que ela abrir no Consumer (F2).
  if (confirmaBebida && atual?.mesa && atual?.bebidaCodigoPdv) {
    set.bebidaLancamentoStatus = 'aguardando';
  }

  // Data/hora: só conta como mudança o que de fato é diferente do atual.
  const mudaData = !!atual && typeof set.data === 'string' && set.data !== atual.data;
  const mudaHora = !!atual && typeof set.hora === 'string' && set.hora !== atual.hora.slice(0, 5);
  if (atual && typeof set.data === 'string' && !mudaData) delete set.data;
  if (atual && typeof set.hora === 'string' && !mudaHora) delete set.hora;
  const dataFinal = (mudaData ? set.data : atual?.data) as string;

  // Mesas do espaço (pra escopar a ocupação do Consumer — ver comentário em
  // mesasOcupadas: sem isso, conta comandas abertas da casa INTEIRA e
  // derruba espaços pequenos como "ocupado" à toa). Só busca quando alguma
  // checagem abaixo vai precisar.
  let mesasValidas: string[] | undefined;
  let horaLimiteEspaco: string | null | undefined;
  if (atual && (mudaMesa || mudaMesaJuntada || vaiSentar || mudaData || mudaHora)) {
    const [fil] = await db
      .select({ reservaConfig: schema.filial.reservaConfig })
      .from(schema.filial)
      .where(eq(schema.filial.id, atual.filialId))
      .limit(1);
    const areaParaBuscar = (typeof set.area === 'string' ? set.area : atual.area) ?? undefined;
    const espacoCfg = fil?.reservaConfig?.areas?.find((a) => a.nome === areaParaBuscar);
    mesasValidas = espacoCfg?.mesas?.map((m) => String(m.numero));
    horaLimiteEspaco = espacoCfg?.horaLimite;
  }

  // Hora nova respeita o limite do espaço (mesma regra do POST da recepção).
  if (mudaHora && horaLimiteEspaco && (set.hora as string) > horaLimiteEspaco) {
    return NextResponse.json(
      { error: `${atual?.area ?? 'Esse espaço'} aceita reserva de mesa só até ${horaLimiteEspaco}` },
      { status: 400 },
    );
  }

  // Dia novo: a(s) mesa(s) que a reserva já tem têm que estar livres nele.
  // Se estiverem tomadas, devolve quais — o painel oferece mudar a data e
  // escolher outra mesa depois (`semMesa`). Troca de mesa no mesmo PATCH é
  // checada no bloco seguinte, já com a data nova.
  if (mudaData && !mudaMesa && !mudaMesaJuntada && atual?.mesa && atual.area) {
    const mesas = mesasDaReserva(atual.mesa, atual.mesaJuntada);
    const ocupadasNoDia = await mesasOcupadas({
      filialId: atual.filialId,
      data: dataFinal,
      area: atual.area,
      excluirReservaId: id,
      mesasValidas,
    });
    const tomadas = mesas.filter((m) => ocupadasNoDia.has(String(m).trim()));
    if (tomadas.length > 0) {
      if (!soltarMesaSeOcupada) {
        const [a, m, d] = dataFinal.split('-');
        return NextResponse.json(
          {
            error: `Mesa ${tomadas.join('/')} já está reservada em ${atual.area} no dia ${d}/${m}/${a}.`,
            mesasTomadas: tomadas,
          },
          { status: 409 },
        );
      }
      set.mesa = null;
      set.mesaJuntada = null;
    }
  }
  // Mudou o dia: o lembrete/confirmação do cliente era do dia antigo.
  if (mudaData) {
    set.lembreteConfirmacaoEm = null;
    set.confirmadaClienteEm = null;
  }

  // Troca de mesa e/ou junção (recepção): a mesa (ou o conjunto mesa+juntadas)
  // não pode já estar ocupada por outra reserva ativa no mesmo espaço/data.
  // Só checa quando o conjunto final mudou — manter o que já tinha é sempre
  // permitido, mesmo que o Consumer mostre ocupada (é a própria comanda).
  if ((mudaMesa || mudaMesaJuntada) && atual) {
    const areaFinal = (typeof set.area === 'string' ? set.area : atual.area) as string | null;
    const mesaFinal = (mudaMesa ? set.mesa : atual.mesa) as string | null;
    const mesaJuntadaFinal = (mudaMesaJuntada ? set.mesaJuntada : atual.mesaJuntada) as string | null;
    const parMudou = mesaFinal !== atual.mesa || mesaJuntadaFinal !== atual.mesaJuntada;
    if (areaFinal && mesaFinal && parMudou) {
      const mesas = mesasDaReserva(mesaFinal, mesaJuntadaFinal);
      const livre = await mesasEstaoLivres({
        filialId: atual.filialId,
        data: dataFinal,
        area: areaFinal,
        mesas,
        excluirReservaId: id,
        mesasValidas,
      });
      if (!livre) {
        return NextResponse.json(
          { error: `Mesa ${mesas.join('/')} já está ocupada em ${areaFinal} nessa data.` },
          { status: 409 },
        );
      }
    }
  }

  // Sentar (recepção confirma que o cliente chegou): a mesa dessa reserva
  // já pode estar ocupada por outra reserva ativa ou por alguém sentado de
  // verdade no Consumer (walk-in). Se a mesa também está sendo trocada
  // nesse mesmo PATCH, a checagem acima já validou o par novo — não
  // precisa checar o antigo de novo.
  if (vaiSentar && !mudaMesa && !mudaMesaJuntada && atual?.mesa && atual.area) {
    const mesas = mesasDaReserva(atual.mesa, atual.mesaJuntada);
    const livre = await mesasEstaoLivres({
      filialId: atual.filialId,
      data: atual.data,
      area: atual.area,
      mesas,
      excluirReservaId: id,
      mesasValidas,
    });
    if (!livre) {
      return NextResponse.json(
        { error: `Mesa ${mesas.join('/')} já está ocupada. Troque a mesa antes de sentar.` },
        { status: 409 },
      );
    }
  }

  const upd = await db
    .update(schema.reserva)
    .set(set)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
    .returning({ id: schema.reserva.id });

  if (upd.length === 0) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });

  // Auditoria: uma linha por campo que realmente mudou, com quem mudou.
  if (atual) {
    await registrarAlteracoesReserva(id, atual, set, {
      tipo: 'equipe',
      nome: user.email ?? null,
      id: user.id,
    });
  }

  // Enfileira o lançamento da bebida pro agente da filial processar — se a
  // mesa já estiver aberta no Consumer, usa ela; senão abre uma comanda
  // nova (a recepção já confirmou que o cliente chegou e sentou).
  if (confirmaBebida && atual?.mesa && atual?.bebidaCodigoPdv) {
    await db.insert(schema.agenteComando).values({
      filialId: atual.filialId,
      tipo: 'lancar_bebida_reserva',
      payload: {
        reservaId: id,
        numero: atual.mesa,
        codigoProdutoDetalhe: atual.bebidaCodigoPdv,
        nomeProduto: atual.bebidaPedido,
        quantidade: atual.bebidaComboQtd ?? 1,
        pessoas: atual.pessoas,
        nomeCliente: atual.clienteNome,
      },
    });
  }

  // Avisa o cliente no WhatsApp — troca de mesa de verdade (mesa diferente
  // da que já tinha), ou virou no-show/cancelada agora (não reenvia se já
  // estava nesse status). Best-effort, nunca bloqueia a resposta da API.
  if (atual?.clienteTelefone) {
    const [a, mes, d] = atual.data.split('-');
    const dataBr = `${d}/${mes}/${a}`;
    let mensagem: string | null = null;
    if (mudaMesa && set.mesa !== atual.mesa) {
      mensagem = set.mesa
        ? `Sua mesa pra reserva de ${dataBr} às ${atual.hora} foi alterada para a mesa ${set.mesa}.`
        : null;
    }
    if ((mudaData || mudaHora) && avisarCliente) {
      const [na, nm, nd] = dataFinal.split('-');
      const novaHora = (mudaHora ? set.hora : atual.hora) as string;
      const mesaNova = mudaMesa ? set.mesa : 'mesa' in set ? null : atual.mesa;
      mensagem = `Sua reserva de ${dataBr} às ${atual.hora} foi alterada para ${nd}/${nm}/${na} às ${novaHora}${atual.area ? ` (${atual.area}${mesaNova ? `, mesa ${mesaNova}` : ''})` : ''}.`;
    }
    if (mudaStatus && set.status !== atual.status) {
      if (set.status === 'no_show') {
        // Fechar o pedido/comanda no Consumer pra liberar a mesa
        // `pedido.numero` é integer e `reserva.mesa` é texto (mesa pode ser
        // "12A" em algumas áreas) — só fecha quando dá pra converter.
        const numeroMesa = Number((atual.mesa ?? '').replace(/\D/g, ''));
        if (atual.mesa && Number.isFinite(numeroMesa) && numeroMesa > 0) {
          await db
            .update(schema.pedido)
            .set({ dataFechamento: sql`now()` })
            .where(
              and(
                eq(schema.pedido.filialId, atual.filialId),
                eq(schema.pedido.numero, numeroMesa),
                isNull(schema.pedido.dataFechamento),
                // pedido excluído no Consumer nunca foi fechado: sem isto o no-show carimbava
                // todos os excluídos antigos da mesa e eles viravam "venda sem nota" (08/10)
                isNull(schema.pedido.dataDelete),
              ),
            )
            .catch(() => null); // Falha silenciosa se não achar pedido
        }
        mensagem = `Notamos que você não compareceu à sua reserva de ${dataBr} às ${atual.hora}. Se quiser remarcar, é só chamar a gente!`;
      } else if (set.status === 'cancelada') {
        // Cancelamento pela CASA: estorno integral do Pix, sempre — exceto
        // quando a taxa já foi devolvida na mão (estornado_manual): aí a
        // Cielo NÃO é chamada (senão devolve em dobro).
        const estorno = devolvidoManual
          ? null
          : await estornarReservaSePago(
              { id, data: atual.data, hora: atual.hora, pagamentoStatus: atual.pagamentoStatus, pagamentoId: atual.pagamentoId, pagamentoValor: atual.pagamentoValor, filialId: atual.filialId },
              true,
            ).catch(() => null);
        const linhaEstorno = devolvidoManual
          ? ` O valor pago (R$ ${Number(atual.pagamentoValor).toFixed(2)}) já foi devolvido pra você.`
          : estorno && estorno.percentual === 100
            ? ` O valor pago (R$ ${Number(atual.pagamentoValor).toFixed(2)}) volta integral no seu Pix — o banco leva alguns dias pra creditar.`
            : '';
        mensagem = `Sua reserva de ${dataBr} às ${atual.hora} foi cancelada.${linhaEstorno} Se foi engano ou quiser remarcar, é só chamar a gente!`;
      }
    }
    if (mensagem) {
      // Vercel pode congelar a function assim que a resposta sai — aguarda
      // o envio (best-effort) em vez de disparar sem esperar.
      try {
        await enviarAtualizacaoReserva(atual.clienteTelefone, { nome: atual.clienteNome, mensagem }, atual.filialId);
      } catch (e) {
        console.error('Erro enviando atualizacao de reserva:', (e as Error).message);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/reservas/[id] — apaga a reserva feita por engano (dono
// 14/10/2026: "ou ainda excluir"). Só administrador (reserva.delete, a mesma
// régua do Cancelar). Reserva com taxa paga NÃO se apaga: tem que Cancelar,
// que é o que estorna o Pix. O histórico (reserva_alteracao) vai junto
// (cascade); a linha inteira fica no log da Vercel pra recuperar se precisar.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.delete');
  if (error) return error;

  const { id } = await params;
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ error: 'sem filiais' }, { status: 403 });

  const [row] = await db
    .select()
    .from(schema.reserva)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
  if (row.pagamentoStatus === 'pago' || (row.pagamentoStatus ?? '').startsWith('estorno_falhou')) {
    return NextResponse.json(
      { error: 'Essa reserva tem taxa paga — use Cancelar (que devolve o Pix) em vez de excluir.' },
      { status: 409 },
    );
  }

  console.log(`[reserva] excluida por ${user.email ?? user.id}: ${JSON.stringify(row)}`);
  await db
    .delete(schema.reserva)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)));
  return NextResponse.json({ ok: true });
}
