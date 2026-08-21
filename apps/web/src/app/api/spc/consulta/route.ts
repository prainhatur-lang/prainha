// POST /api/spc/consulta  { cpf }  -> dados cadastrais do CPF
// GET  /api/spc/consulta            -> diagnóstico da credencial (sem revelar)
//
// A consulta é paga por CPF; o cache em `spc_consulta` garante que o mesmo
// documento só é cobrado uma vez. Exige permissão de cadastro — não é
// consulta de CPF pra qualquer um que tenha login.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { consultarCpf, cpfValido, spcConfigurado, spcStatus } from '@/lib/spc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const pode =
    (await podeUsuario(user.id, 'cliente.create')) ||
    (await podeUsuario(user.id, 'cliente.update'));
  if (!pode) return NextResponse.json({ error: 'sem permissão' }, { status: 403 });

  if (!spcConfigurado()) {
    return NextResponse.json({ error: 'SPC não configurado', configurado: false }, { status: 503 });
  }

  let body: { cpf?: string; filialId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const cpf = String(body.cpf ?? '');
  if (!cpfValido(cpf)) {
    return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });
  }

  try {
    const dados = await consultarCpf(cpf, {
      usuarioId: user.id,
      filialId: body.filialId && /^[0-9a-f-]{36}$/i.test(body.filialId) ? body.filialId : undefined,
    });
    if (!dados) {
      return NextResponse.json({ achou: false });
    }
    return NextResponse.json({ achou: true, ...dados });
  } catch (e) {
    // Erro do SPC (credencial, cota, timeout) não pode derrubar o cadastro —
    // a tela segue no preenchimento manual.
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await podeUsuario(user.id, 'cliente.create'))) {
    return NextResponse.json({ error: 'sem permissão' }, { status: 403 });
  }
  return NextResponse.json(spcStatus());
}
