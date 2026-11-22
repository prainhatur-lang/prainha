// Link público do boy (/delivery/entrega/<token>) — dono 22/11/2026.
// GET  → dados da entrega e do cadastro dele.
// POST { acao: 'enviar_otp' }                         → código no WhatsApp dele
// POST { acao: 'cadastrar', nome, cpf, pixChave, codigo } → cadastro (1ª vez)
// POST { acao: 'confirmar', codigo }                  → código do cliente → Pix
// A defesa é o token do link (aleatório, 18 bytes) + o código do cliente.

import { NextResponse } from 'next/server';
import { confirmarEntrega, enviarCodigoTelefone, salvarCadastroBoy, visaoDoBoy } from '@/lib/delivery/despacho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await visaoDoBoy(token);
  if (!v) return NextResponse.json({ error: 'link inválido' }, { status: 404 });
  return NextResponse.json(v);
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await request.json().catch(() => null);
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  let r: { ok: boolean; erro?: string; [k: string]: unknown };
  if (acao === 'enviar_otp') r = await enviarCodigoTelefone(token);
  else if (acao === 'cadastrar')
    r = await salvarCadastroBoy(token, {
      nome: String(b?.nome ?? ''),
      cpf: String(b?.cpf ?? ''),
      pixChave: String(b?.pixChave ?? ''),
      codigo: b?.codigo != null ? String(b.codigo) : undefined,
    });
  else if (acao === 'confirmar') r = await confirmarEntrega(token, String(b?.codigo ?? ''));
  else return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}
