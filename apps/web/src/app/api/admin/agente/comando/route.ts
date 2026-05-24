// POST /api/admin/agente/comando
//
// Cria um comando na fila pro agente local de uma filial. O agente faz
// polling em /api/agente/comandos e executa. Usado pelos botoes do
// dashboard (Instalar CDC, Atualizar, Status, etc).
//
// Body: { filialId: uuid, tipo: string, payload?: any }
// Auth: sessao de usuario (cookie supabase) + permissao configuracao.write

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIPOS_VALIDOS = [
  // CDC v2
  'instalar_cdc',
  'desinstalar_cdc',
  'status_cdc',
  'pular_tabelas',
  // Auto-update do agente
  'auto_update',
  // Write-back ja existentes
  'atualizar_fornecedor',
  'atualizar_cliente',
  'baixar_fiado',
] as const;

const BodySchema = z.object({
  filialId: z.string().uuid(),
  tipo: z.enum(TIPOS_VALIDOS),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(req: Request) {
  // 1. Auth de usuario + permissao (retorna JSON 401/403, nao redirect HTML)
  const { user, error: authErr } = await exigirPermApi('configuracao.editar');
  if (authErr) return authErr;

  // 2. Parse body
  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'body invalido', detalhes: (e as Error).message },
      { status: 400 },
    );
  }

  // 3. Confirma que filial existe
  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, body.filialId))
    .limit(1);
  if (!filial) {
    return NextResponse.json({ error: 'filial nao encontrada' }, { status: 404 });
  }

  // 4. Cria comando
  const [novo] = await db
    .insert(schema.agenteComando)
    .values({
      filialId: filial.id,
      tipo: body.tipo,
      payload: body.payload,
      status: 'pendente',
      criadoPor: user.id,
    })
    .returning({ id: schema.agenteComando.id, criadoEm: schema.agenteComando.criadoEm });

  return NextResponse.json({
    ok: true,
    comando: novo,
    msg: `comando ${body.tipo} criado pra filial ${filial.nome}. Agente vai executar na proxima rodada (proximo polling).`,
  });
}
