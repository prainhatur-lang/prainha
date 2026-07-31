// Endpoints pro agente local trabalhar com a fila de comandos.
// Auth: Bearer <agente_token> (NAO eh sessao de usuario).
//
// GET  /api/agente/comandos        — lista comandos pendentes da filial
//   Long-poll: se a fila está vazia, segura a resposta em aberto (até
//   LONG_POLL_TIMEOUT_MS) reconsultando a cada LONG_POLL_STEP_MS, em vez de
//   devolver vazio na hora — o agente fica com a conexão aberta esperando,
//   e um comando novo sai em ~1s em vez de esperar o próximo poll do
//   agente. Sem isso, "lançar bebida" confirmado na recepção só saía no
//   próximo ciclo do agente (era 15min, depois 15s — ainda não é "na hora").
// PATCH /api/agente/comandos       — agente reporta resultado (id, status, resultado)

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

export const maxDuration = 30;

const LONG_POLL_TIMEOUT_MS = 25_000;
const LONG_POLL_STEP_MS = 1_000;

async function getFilialFromAuth(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  return filial ?? null;
}

export async function GET(req: NextRequest) {
  const filial = await getFilialFromAuth(req);
  if (!filial) return new NextResponse('token inválido', { status: 401 });

  // Atualiza ultimo_ping (heartbeat)
  await db
    .update(schema.filial)
    .set({ ultimoPing: new Date() })
    .where(eq(schema.filial.id, filial.id));

  const filialId = filial.id;
  async function buscarPendentes() {
    return db
      .select()
      .from(schema.agenteComando)
      .where(
        and(
          eq(schema.agenteComando.filialId, filialId),
          eq(schema.agenteComando.status, 'pendente'),
        ),
      )
      .limit(20);
  }

  const inicio = Date.now();
  let pendentes = await buscarPendentes();
  while (pendentes.length === 0 && Date.now() - inicio < LONG_POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, LONG_POLL_STEP_MS));
    pendentes = await buscarPendentes();
  }

  return NextResponse.json({ comandos: pendentes });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  // 'pendente' = recoloca na fila pra tentar de novo no próximo ciclo (ex:
  // comando que depende de algo ainda não pronto, como mesa não aberta).
  status: z.enum(['pendente', 'executando', 'sucesso', 'erro']),
  resultado: z.unknown().optional(),
});

export async function PATCH(req: NextRequest) {
  const filial = await getFilialFromAuth(req);
  if (!filial) return new NextResponse('token inválido', { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  // Confere que o comando é da filial
  const [cmd] = await db
    .select({ filialId: schema.agenteComando.filialId, tipo: schema.agenteComando.tipo, payload: schema.agenteComando.payload })
    .from(schema.agenteComando)
    .where(eq(schema.agenteComando.id, body.id))
    .limit(1);
  if (!cmd) return new NextResponse('Comando não encontrado', { status: 404 });
  if (cmd.filialId !== filial.id) return new NextResponse('Filial inválida', { status: 403 });

  const set: Record<string, unknown> = { status: body.status };
  if (body.resultado !== undefined) set.resultado = body.resultado;
  if (body.status === 'executando') set.iniciadoEm = new Date();
  if (body.status === 'sucesso' || body.status === 'erro') set.finalizadoEm = new Date();

  await db.update(schema.agenteComando).set(set).where(eq(schema.agenteComando.id, body.id));

  // Reflete o resultado do lançamento de bebida na reserva — sem isso a
  // recepção não tem como saber que o lançamento automático falhou (o
  // agente só reporta aqui, ninguém olha essa tabela na tela normal).
  if (cmd.tipo === 'lancar_bebida_reserva' && (body.status === 'sucesso' || body.status === 'erro')) {
    const reservaId = (cmd.payload as { reservaId?: string })?.reservaId;
    if (reservaId) {
      await db
        .update(schema.reserva)
        .set({ bebidaLancamentoStatus: body.status })
        .where(eq(schema.reserva.id, reservaId));
    }
  }

  return NextResponse.json({ ok: true });
}
