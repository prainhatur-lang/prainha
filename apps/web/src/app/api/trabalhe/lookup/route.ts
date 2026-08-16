// POST /api/trabalhe/lookup — { cpf } -> { nome?, whatsapp? } (prefill).
// Público: devolve APENAS nome e telefone que a base já tem pro CPF digitado
// (o dono do CPF já conhece os próprios dados; nada de endereço/e-mail aqui).

import { NextResponse } from 'next/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

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
  const b = (await request.json().catch(() => null)) as { cpf?: string } | null;
  const cpf = (b?.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) {
    return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });
  }

  // Já é talento cadastrado? Devolve o cadastro pra edição.
  const [t] = (await db.execute(sql`
    SELECT nome, whatsapp, endereco, funcoes, experiencia FROM talento
    WHERE cpf = ${cpf} LIMIT 1
  `)) as unknown as Array<{
    nome: string;
    whatsapp: string;
    endereco: string | null;
    funcoes: string[];
    experiencia: string | null;
  }>;
  if (t) return NextResponse.json({ achou: true, recadastro: true, ...t });

  // Cliente conhecido da casa (Consumer)? Prefill de nome/telefone.
  const [cli] = (await db.execute(sql`
    SELECT nome, telefone FROM cliente
    WHERE data_delete IS NULL
      AND regexp_replace(coalesce(cpf_ou_cnpj, ''), '\\D', '', 'g') = ${cpf}
      AND coalesce(nome, '') <> ''
    LIMIT 1
  `)) as unknown as Array<{ nome: string | null; telefone: string | null }>;
  if (cli) {
    return NextResponse.json({
      achou: true,
      recadastro: false,
      nome: cli.nome ?? '',
      whatsapp: (cli.telefone ?? '').replace(/\D/g, ''),
    });
  }

  return NextResponse.json({ achou: false });
}
