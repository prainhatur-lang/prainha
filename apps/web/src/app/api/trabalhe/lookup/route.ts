// POST /api/trabalhe/lookup — { cpf } -> prefill MASCARADO.
//
// SEGURANÇA (revisão 16/08, pergunta do Elison): este endpoint é público e
// CPF é enumerável — então ele NUNCA devolve dado pessoal em claro:
//  - nome: só o PRIMEIRO nome (saudação), nunca o completo;
//  - telefone: mascarado (79 9****-1234), só pra pessoa reconhecer — o campo
//    do WhatsApp ela digita por inteiro (ela sabe o próprio número);
//  - endereço: NUNCA volta;
//  - recadastro (talento): volta funções/experiência (dados que a própria
//    pessoa enviou pra este fim) + os mascarados acima.
//  - Rate limit: máx 15 consultas por IP por hora (tabela trabalhe_lookup_log).

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

function primeiroNome(nome: string | null): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

function mascararFone(fone: string | null): string {
  const d = (fone ?? '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return '';
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)}****-${d.slice(-4)}`;
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { cpf?: string } | null;
  const cpf = (b?.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) {
    return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });
  }

  // Rate limit por IP: 15/h (enumeração de CPF fica inviável)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'desconhecido';
  const [rl] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM trabalhe_lookup_log
    WHERE ip = ${ip} AND criado_em > now() - interval '1 hour'
  `)) as unknown as Array<{ n: number }>;
  if ((rl?.n ?? 0) >= 15) {
    return NextResponse.json({ error: 'Muitas tentativas — tente de novo mais tarde.' }, { status: 429 });
  }
  await db.execute(sql`INSERT INTO trabalhe_lookup_log (ip) VALUES (${ip})`);

  // Já é talento (dados que a própria pessoa enviou pra este cadastro)
  const [t] = (await db.execute(sql`
    SELECT nome, whatsapp, funcoes, experiencia FROM talento WHERE cpf = ${cpf} LIMIT 1
  `)) as unknown as Array<{
    nome: string;
    whatsapp: string;
    funcoes: string[];
    experiencia: string | null;
  }>;
  if (t) {
    return NextResponse.json({
      achou: true,
      recadastro: true,
      primeiroNome: primeiroNome(t.nome),
      foneMascarado: mascararFone(t.whatsapp),
      funcoes: t.funcoes,
      experiencia: t.experiencia,
    });
  }

  // Cliente da casa: só saudação com primeiro nome + fone mascarado
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
      primeiroNome: primeiroNome(cli.nome),
      foneMascarado: mascararFone(cli.telefone),
    });
  }

  return NextResponse.json({ achou: false });
}
