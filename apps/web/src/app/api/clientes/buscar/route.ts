// POST /api/clientes/buscar  { cpf, filialId, forcarSpc? }
//
// Painel interno. A cascata (nossas bases → cache → SPC pago) mora em
// @/lib/identificar-cpf, compartilhada com a reserva pública. Aqui, como tem
// gente logada e com permissão, o cadastro volta COMPLETO pra preencher o
// formulário.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { cpfValido } from '@/lib/spc';
import { identificarPorCpf } from '@/lib/identificar-cpf';

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

  let body: { cpf?: string; filialId?: string; forcarSpc?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const cpf = String(body.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });

  const filialId = String(body.filialId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });
  }

  try {
    const r = await identificarPorCpf(cpf, filialId, {
      forcarSpc: body.forcarSpc,
      usuarioId: user.id,
    });
    return NextResponse.json(r);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('filial não encontrada')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
