// GET/POST/PATCH /api/relatorios/diario/modelo — o modelo (template) `relatorio_diario`
// na Meta: GET diz como ele está; POST cria (o dono aperta o botão na tela) e
// a Meta analisa; PATCH conserta o que foi criado na mão sem o botão "Ver resumo". Sem o modelo aprovado o aviso das 07:00 só entra dentro da
// janela de 24 h do WhatsApp.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { corrigirModelo, criarModelo, estadoDoModelo, organizacoesDoDono } from '@/lib/relatorio-diario-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function soDono() {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const orgs = await organizacoesDoDono(guard.user.id);
  if (!orgs.length) return NextResponse.json({ error: 'só o dono mexe no modelo' }, { status: 403 });
  return null;
}

export async function GET() {
  const negado = await soDono();
  if (negado) return negado;
  return NextResponse.json({ ok: true, modelo: await estadoDoModelo() });
}

export async function POST() {
  const negado = await soDono();
  if (negado) return negado;
  const modelo = await criarModelo();
  if (modelo.situacao === 'indisponivel') {
    return NextResponse.json({ error: modelo.detalhe ?? 'A Meta não aceitou criar o modelo.', modelo }, { status: 502 });
  }
  return NextResponse.json({ ok: true, modelo });
}

export async function PATCH() {
  const negado = await soDono();
  if (negado) return negado;
  const modelo = await corrigirModelo();
  if (modelo.situacao === 'indisponivel') {
    return NextResponse.json({ error: modelo.detalhe ?? 'A Meta não aceitou a correção.', modelo }, { status: 502 });
  }
  return NextResponse.json({ ok: true, modelo });
}
