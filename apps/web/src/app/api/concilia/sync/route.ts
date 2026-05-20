// POST /api/concilia/sync
//
// Endpoint generico do CDC v2 — recebe registros brutos do Firebird do
// Consumer (drenados pelo agente) e aplica em batch nas tabelas do Postgres
// via mappers em lib/concilia-mappers.ts.
//
// Body: { registros: RegistroSync[] }
// Auth: Bearer {agente_token} (autentica a filial)
//
// Response: { recebidos, ok, naoImplementado, erros }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { aplicarRegistro, tabelasComMapper } from '@/lib/concilia-mappers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RegistroSchema = z.object({
  tabela: z.string().max(50),
  operacao: z.enum(['I', 'U', 'D']),
  chavePk: z.string().max(100),
  dados: z.record(z.string(), z.unknown()).nullable(),
});

const BodySchema = z.object({
  registros: z.array(RegistroSchema).max(500),
});

export async function POST(req: Request) {
  // 1. Auth
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return NextResponse.json({ error: 'sem bearer token' }, { status: 401 });
  const token = m[1];

  const [filial] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!filial) {
    return NextResponse.json({ error: 'token invalido' }, { status: 401 });
  }

  // 2. Parse
  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'body invalido', detalhes: (e as Error).message },
      { status: 400 },
    );
  }

  // 3. Atualiza ultimo_ping da filial
  await db
    .update(schema.filial)
    .set({ ultimoPing: new Date() })
    .where(eq(schema.filial.id, filial.id));

  // 4. Aplica cada registro
  let ok = 0;
  let naoImplementado = 0;
  const erros: Array<{ tabela: string; chave: string; msg: string }> = [];

  for (const r of body.registros) {
    const res = await aplicarRegistro(filial.id, r);
    if (res.status === 'ok') {
      ok++;
    } else if (res.status === 'nao_implementado') {
      naoImplementado++;
    } else {
      erros.push({
        tabela: r.tabela,
        chave: r.chavePk,
        msg: res.msg ?? 'erro desconhecido',
      });
    }
  }

  return NextResponse.json({
    filial: filial.nome,
    recebidos: body.registros.length,
    ok,
    naoImplementado,
    erros: erros.slice(0, 50), // limita resposta
    totalErros: erros.length,
    mappersDisponiveis: tabelasComMapper(),
  });
}
