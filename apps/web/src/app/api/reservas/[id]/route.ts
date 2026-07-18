// PATCH /api/reservas/[id] — atualiza status / mesa / area de uma reserva.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { mesaEstaLivre } from '@/lib/reservas/mesa-disponivel';
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
    set.status = b.status;
  }
  if (b?.mesa !== undefined) set.mesa = typeof b.mesa === 'string' && b.mesa.trim() ? b.mesa.trim().slice(0, 20) : null;
  if (b?.area !== undefined) set.area = typeof b.area === 'string' && b.area.trim() ? b.area.trim().slice(0, 100) : null;
  if (b?.observacao !== undefined)
    set.observacao = typeof b.observacao === 'string' && b.observacao.trim() ? b.observacao.trim().slice(0, 2000) : null;
  if (b?.preferencias !== undefined)
    set.preferencias = typeof b.preferencias === 'string' && b.preferencias.trim() ? b.preferencias.trim().slice(0, 500) : null;
  if (typeof b?.bebidaConfirmada === 'boolean') set.bebidaConfirmada = b.bebidaConfirmada;
  if (b?.bebidaPedido !== undefined)
    set.bebidaPedido = typeof b.bebidaPedido === 'string' && b.bebidaPedido.trim() ? b.bebidaPedido.trim().slice(0, 100) : null;

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
  const mudaStatus = typeof set.status === 'string';
  const confirmaBebida = set.bebidaConfirmada === true;
  let atual: {
    filialId: string;
    data: string;
    hora: string;
    area: string | null;
    mesa: string | null;
    status: string;
    clienteNome: string;
    clienteTelefone: string | null;
    pessoas: number;
    bebidaPedido: string | null;
    bebidaComboQtd: number | null;
    bebidaCodigoPdv: number | null;
  } | null = null;
  if (mudaMesa || mudaStatus || confirmaBebida) {
    const [row] = await db
      .select({
        filialId: schema.reserva.filialId,
        data: schema.reserva.data,
        hora: schema.reserva.hora,
        area: schema.reserva.area,
        mesa: schema.reserva.mesa,
        status: schema.reserva.status,
        clienteNome: schema.reserva.clienteNome,
        clienteTelefone: schema.reserva.clienteTelefone,
        pessoas: schema.reserva.pessoas,
        bebidaPedido: schema.reserva.bebidaPedido,
        bebidaComboQtd: schema.reserva.bebidaComboQtd,
        bebidaCodigoPdv: schema.reserva.bebidaCodigoPdv,
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

  // Troca de mesa (recepção): a nova mesa não pode já estar ocupada por outra
  // reserva ativa no mesmo espaço/data. Só checa quando uma mesa está sendo
  // atribuída (null = "tirar a mesa", sempre permitido).
  if (mudaMesa && atual) {
    const areaFinal = (typeof set.area === 'string' ? set.area : atual.area) as string | null;
    // Mantendo a mesma mesa que já tinha: sempre permitido, mesmo que o
    // Consumer mostre ela como ocupada (é a própria comanda dessa reserva).
    if (areaFinal && set.mesa !== atual.mesa) {
      const livre = await mesaEstaLivre({
        filialId: atual.filialId,
        data: atual.data,
        area: areaFinal,
        mesa: set.mesa as string,
        excluirReservaId: id,
      });
      if (!livre) {
        return NextResponse.json(
          { error: `Mesa ${set.mesa} já está ocupada em ${areaFinal} nessa data.` },
          { status: 409 },
        );
      }
    }
  }

  const upd = await db
    .update(schema.reserva)
    .set(set)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
    .returning({ id: schema.reserva.id });

  if (upd.length === 0) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });

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
        mensagem = `Sua reserva de ${dataBr} às ${atual.hora} foi cancelada. Se foi engano ou quiser remarcar, é só chamar a gente!`;
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
