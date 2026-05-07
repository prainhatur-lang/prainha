// Endpoints pro agente local trabalhar com a fila de comandos.
// Auth: Bearer <agente_token> (NAO eh sessao de usuario).
//
// GET  /api/agente/comandos        — lista comandos pendentes da filial
// PATCH /api/agente/comandos       — agente reporta resultado (id, status, resultado)

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

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

  const pendentes = await db
    .select()
    .from(schema.agenteComando)
    .where(
      and(
        eq(schema.agenteComando.filialId, filial.id),
        eq(schema.agenteComando.status, 'pendente'),
      ),
    )
    .limit(20);

  return NextResponse.json({ comandos: pendentes });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  status: z.enum(['executando', 'sucesso', 'erro']),
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
    .select({ filialId: schema.agenteComando.filialId })
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

  return NextResponse.json({ ok: true });
}
