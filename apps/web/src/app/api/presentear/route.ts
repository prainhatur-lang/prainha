// Vale-presente comprado no site (/presentear/[casa]) — PÚBLICO.
// POST { casa, valor, compradorNome, compradorTelefone, presenteados, mensagem, site }
// Cria o vale de crédito livre, gera o Pix e devolve o token (/presente/<token>).

import { NextResponse } from 'next/server';
import { criarValePorValor } from '@/lib/vale-presente';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Honeypot: campo escondido que só robô preenche.
  if (typeof b.site === 'string' && b.site.trim()) {
    return NextResponse.json({ error: 'não deu certo — tente de novo' }, { status: 400 });
  }
  try {
    const r = await criarValePorValor({
      casa: String(b.casa ?? ''),
      valor: Number(b.valor),
      compradorNome: String(b.compradorNome ?? ''),
      compradorTelefone: String(b.compradorTelefone ?? ''),
      presenteados: String(b.presenteados ?? ''),
      mensagem: typeof b.mensagem === 'string' ? b.mensagem : undefined,
    });
    if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ token: r.token });
  } catch (e) {
    console.error('[presentear]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'não consegui gerar o vale agora — tente de novo' }, { status: 500 });
  }
}
