// PATCH /api/clientes/[id] — edita o cadastro do cliente.
//
// Escreve nos DOIS lugares: na nuvem (efeito imediato nas telas) e na fila do
// agente, que aplica em CONTATOS na loja. Sem a segunda parte, o próximo sync
// do Consumer sobrescreveria a edição — o Firebird é a fonte da verdade.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { ErroCadastro, normalizarCliente, type CamposCliente } from '@/lib/cliente-cadastro';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cliente.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  let body: CamposCliente;
  try {
    body = (await req.json()) as CamposCliente;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const mexeNoFiado =
    'limiteCreditoContaCorrente' in body ||
    'bloquearVendaAposLimite' in body ||
    'arquivarFiado' in body;
  if (mexeNoFiado && !(await podeUsuario(user.id, 'conta_receber.update'))) {
    return NextResponse.json({ error: 'sem permissão pra mexer no fiado' }, { status: 403 });
  }

  const [cliente] = await db
    .select({
      id: schema.cliente.id,
      filialId: schema.cliente.filialId,
      codigoExterno: schema.cliente.codigoExterno,
    })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, id))
    .limit(1);
  if (!cliente) return NextResponse.json({ error: 'cliente não encontrado' }, { status: 404 });

  let campos;
  try {
    campos = normalizarCliente(body, { exigirNome: false });
  } catch (e) {
    if (e instanceof ErroCadastro) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (Object.keys(campos.nuvem).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db
    .update(schema.cliente)
    .set(campos.nuvem)
    .where(eq(schema.cliente.id, id));

  // codigoExterno <= 0 = cliente que ainda não existe no Consumer; não há o
  // que atualizar lá (o cadastro sobe pelo criar_cliente).
  let comandoId: string | null = null;
  if (cliente.codigoExterno > 0 && Object.keys(campos.loja).length > 0) {
    const [cmd] = await db
      .insert(schema.agenteComando)
      .values({
        filialId: cliente.filialId,
        tipo: 'atualizar_cliente',
        payload: { codigoExterno: cliente.codigoExterno, campos: campos.loja },
        criadoPor: user.id,
      })
      .returning({ id: schema.agenteComando.id });
    comandoId = cmd.id;
  }

  return NextResponse.json({ ok: true, comandoId });
}
