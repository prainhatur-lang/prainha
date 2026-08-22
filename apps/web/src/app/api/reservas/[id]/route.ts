// PATCH /api/reservas/[id] — atualiza status / mesa / area de uma reserva.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { estornarReservaSePago } from '@/lib/reservas/estorno';
import { filiaisDoUsuario } from '@/lib/filiais';
import { mesasEstaoLivres } from '@/lib/reservas/mesa-disponivel';
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
  if (b?.mesa !== undefined) set.mesa = typeof b.mesa === 'string' && b.mesa.trim() ? b.mesa.trim().slice(0, 20) : null;
  // Segunda mesa juntada lateralmente (grupo maior que 1 mesa só). null =
  // desfaz a junção (volta a ser só a mesa principal).
  if (b?.mesaJuntada !== undefined)
    set.mesaJuntada = typeof b.mesaJuntada === 'string' && b.mesaJuntada.trim() ? b.mesaJuntada.trim().slice(0, 20) : null;
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
    atual = row;
  }

  // Confirmou a bebida (recepção clicou "quer sim, senta"): se veio do
  // catálogo real (tem código PDV) e já tem mesa, entra na fila do agente
  // pra lançar na comanda assim que ela abrir no Consumer (F2).
  if (confirmaBebida && atual?.mesa && atual?.bebidaCodigoPdv) {
    set.bebidaLancamentoStatus = 'aguardando';
  }

  // Mesas do espaço (pra escopar a ocupação do Consumer — ver comentário em
  // mesasOcupadas: sem isso, conta comandas abertas da casa INTEIRA e
  // derruba espaços pequenos como "ocupado" à toa). Só busca quando alguma
  // checagem abaixo vai precisar.
  let mesasValidas: string[] | undefined;
  if (atual && (mudaMesa || mudaMesaJuntada || vaiSentar)) {
    const [fil] = await db
      .select({ reservaConfig: schema.filial.reservaConfig })
      .from(schema.filial)
      .where(eq(schema.filial.id, atual.filialId))
      .limit(1);
    const areaParaBuscar = (typeof set.area === 'string' ? set.area : atual.area) ?? undefined;
    const espacoCfg = fil?.reservaConfig?.areas?.find((a) => a.nome === areaParaBuscar);
    mesasValidas = espacoCfg?.mesas?.map((m) => String(m.numero));
  }

  // Troca de mesa e/ou junção (recepção): a mesa (ou o par mesa+mesaJuntada)
  // não pode já estar ocupada por outra reserva ativa no mesmo espaço/data.
  // Só checa quando o par final mudou — manter o que já tinha é sempre
  // permitido, mesmo que o Consumer mostre ocupada (é a própria comanda).
  if ((mudaMesa || mudaMesaJuntada) && atual) {
    const areaFinal = (typeof set.area === 'string' ? set.area : atual.area) as string | null;
    const mesaFinal = (mudaMesa ? set.mesa : atual.mesa) as string | null;
    const mesaJuntadaFinal = (mudaMesaJuntada ? set.mesaJuntada : atual.mesaJuntada) as string | null;
    const parMudou = mesaFinal !== atual.mesa || mesaJuntadaFinal !== atual.mesaJuntada;
    if (areaFinal && mesaFinal && parMudou) {
      const mesas = mesaJuntadaFinal ? [mesaFinal, mesaJuntadaFinal] : [mesaFinal];
      const livre = await mesasEstaoLivres({
        filialId: atual.filialId,
        data: atual.data,
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
    const mesas = atual.mesaJuntada ? [atual.mesa, atual.mesaJuntada] : [atual.mesa];
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
    if (mudaStatus && set.status !== atual.status) {
      if (set.status === 'no_show') {
        mensagem = `Notamos que você não compareceu à sua reserva de ${dataBr} às ${atual.hora}. Se quiser remarcar, é só chamar a gente!`;
      } else if (set.status === 'cancelada') {
        // Cancelamento pela CASA: estorno integral do Pix, sempre.
        const estorno = await estornarReservaSePago(
          { id, data: atual.data, hora: atual.hora, pagamentoStatus: atual.pagamentoStatus, pagamentoId: atual.pagamentoId, pagamentoValor: atual.pagamentoValor, filialId: atual.filialId },
          true,
        ).catch(() => null);
        const linhaEstorno =
          estorno && estorno.percentual === 100
            ? ` O valor pago (R$ ${Number(atual.pagamentoValor).toFixed(2)}) volta integral no seu Pix — o banco leva alguns dias pra creditar.`
            : '';
        mensagem = `Sua reserva de ${dataBr} às ${atual.hora} foi cancelada.${linhaEstorno} Se foi engano ou quiser remarcar, é só chamar a gente!`;
      }
    }
    if (mensagem) {
      // Vercel pode congelar a function assim que a resposta sai — aguarda
      // o envio (best-effort) em vez de disparar sem esperar.
      try {
        await enviarAtualizacaoReserva(atual.clienteTelefone, { nome: atual.clienteNome, mensagem });
      } catch (e) {
        console.error('Erro enviando atualizacao de reserva:', (e as Error).message);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
