// POST /api/clientes — cadastra cliente novo.
//
// O CODIGO do cliente é do Consumer (trigger do Firebird), não da nuvem. Então
// aqui a gente NÃO cria a linha em `cliente`: enfileira `criar_cliente` pro
// agente inserir em CONTATOS, e o cliente aparece na lista quando o CDC trouxer
// (CONTATOS é sincronizado por completo). Isso evita cliente fantasma na nuvem
// com código inventado — que depois brigaria com o código real.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { ErroCadastro, normalizarCliente, type CamposCliente } from '@/lib/cliente-cadastro';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cliente.create');
  if (semPerm) return semPerm;

  let body: CamposCliente & { filialId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const filialId = (body.filialId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });
  }

  // Limite de fiado é liberar crédito — permissão à parte de cadastrar.
  if ('limiteCreditoContaCorrente' in body || 'bloquearVendaAposLimite' in body) {
    if (!(await podeUsuario(user.id, 'conta_receber.update'))) {
      return NextResponse.json(
        { error: 'sem permissão pra definir limite de fiado' },
        { status: 403 },
      );
    }
  }

  let campos;
  try {
    campos = normalizarCliente(body, { exigirNome: true });
  } catch (e) {
    if (e instanceof ErroCadastro) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  // Duplicado por documento: barra antes de mandar pra loja.
  const doc = campos.nuvem.cpfOuCnpj as string | null;
  if (doc) {
    const [existe] = await db
      .select({ id: schema.cliente.id, nome: schema.cliente.nome })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, filialId),
          eq(schema.cliente.cpfOuCnpj, doc),
          isNull(schema.cliente.dataDelete),
        ),
      )
      .limit(1);
    if (existe) {
      return NextResponse.json(
        { error: `já existe cliente com esse documento: ${existe.nome}`, clienteId: existe.id },
        { status: 409 },
      );
    }
  }

  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, ultimoPing: schema.filial.ultimoPing })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const [cmd] = await db
    .insert(schema.agenteComando)
    .values({
      filialId,
      tipo: 'criar_cliente',
      payload: { campos: campos.loja },
      criadoPor: user.id,
    })
    .returning({ id: schema.agenteComando.id });

  // Agente mudo há mais de 10 min = a loja não vai aplicar agora. O comando
  // fica na fila e roda quando voltar; quem está na tela precisa saber.
  const pingAtras = filial.ultimoPing
    ? (Date.now() - new Date(filial.ultimoPing).getTime()) / 60000
    : null;

  return NextResponse.json({
    ok: true,
    comandoId: cmd.id,
    lojaOnline: pingAtras != null && pingAtras < 10,
    ultimoPing: filial.ultimoPing,
  });
}

// GET /api/clientes?comandoId=... — status do cadastro enfileirado.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cliente.read');
  if (semPerm) return semPerm;

  const comandoId = new URL(req.url).searchParams.get('comandoId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(comandoId)) {
    return NextResponse.json({ error: 'comandoId inválido' }, { status: 400 });
  }

  const [cmd] = await db
    .select({
      status: schema.agenteComando.status,
      resultado: schema.agenteComando.resultado,
      filialId: schema.agenteComando.filialId,
    })
    .from(schema.agenteComando)
    .where(eq(schema.agenteComando.id, comandoId))
    .limit(1);
  if (!cmd) return NextResponse.json({ error: 'comando não encontrado' }, { status: 404 });

  // Quando o agente responde com o CODIGO, o cliente já pode ter chegado pelo
  // CDC — devolve o id da nuvem pra tela poder abrir o cadastro.
  const codigo = (cmd.resultado as { codigo?: number } | null)?.codigo;
  let clienteId: string | null = null;
  if (codigo) {
    const [c] = await db
      .select({ id: schema.cliente.id })
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, cmd.filialId),
          eq(schema.cliente.codigoExterno, codigo),
        ),
      )
      .limit(1);
    clienteId = c?.id ?? null;
  }

  return NextResponse.json({ status: cmd.status, codigo: codigo ?? null, clienteId });
}
