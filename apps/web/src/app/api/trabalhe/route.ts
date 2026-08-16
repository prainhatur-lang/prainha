// Banco de talentos — APIs públicas do /trabalhe (sem login).
//  POST /api/trabalhe/lookup  { cpf }  -> prefill do que já sabemos (cliente)
//  POST /api/trabalhe         { cpf, nome, whatsapp, endereco, funcoes[], experiencia }
//     -> upsert por CPF (recadastro atualiza os dados)
//
// Proteções: CPF com dígito verificador válido; campos limitados; sem dados
// sensíveis devolvidos além de nome/contato que o próprio dono do CPF já tem.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { FUNCOES_TALENTO } from '@concilia/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += parseInt(d[i], 10) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== parseInt(d[t], 10)) return false;
  }
  return true;
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as {
    cpf?: string;
    nome?: string;
    whatsapp?: string;
    endereco?: string;
    funcoes?: unknown;
    experiencia?: string;
  } | null;
  const cpf = (b?.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) {
    return NextResponse.json({ error: 'CPF inválido — confira os 11 dígitos.' }, { status: 400 });
  }

  const nome = (b?.nome ?? '').trim().slice(0, 200);
  const whatsapp = (b?.whatsapp ?? '').replace(/\D/g, '').slice(0, 20);
  const endereco = (b?.endereco ?? '').trim().slice(0, 500) || null;
  const experiencia = (b?.experiencia ?? '').trim().slice(0, 2000) || null;
  const funcoes = Array.isArray(b?.funcoes)
    ? b.funcoes.map(String).filter((f) => (FUNCOES_TALENTO as readonly string[]).includes(f)).slice(0, 12)
    : [];

  if (!nome || whatsapp.length < 10 || funcoes.length === 0) {
    return NextResponse.json(
      { error: 'Preencha nome, WhatsApp e pelo menos uma função.' },
      { status: 400 },
    );
  }

  await db
    .insert(schema.talento)
    .values({ cpf, nome, whatsapp, endereco, funcoes, experiencia })
    .onConflictDoUpdate({
      target: schema.talento.cpf,
      set: {
        nome,
        whatsapp,
        endereco,
        funcoes,
        experiencia,
        atualizadoEm: sql`now()`,
      },
    });

  return NextResponse.json({ ok: true });
}
