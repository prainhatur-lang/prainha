// GET /api/atendimento/conversas — lista pro painel (ordem: mais recente).
// Query: ?filial=<id> (opcional; default todas as filiais do usuario).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.read');
  if (error) return error;

  const url = new URL(request.url);
  const filialParam = url.searchParams.get('filial');

  const filiais = await filiaisDoUsuario(user.id);
  let ids = filiais.map((f) => f.id);
  if (filialParam) {
    if (!ids.includes(filialParam)) {
      return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
    }
    ids = [filialParam];
  }
  if (ids.length === 0) return NextResponse.json({ conversas: [] });

  const conversas = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(inArray(schema.atendimentoConversa.filialId, ids))
    .orderBy(desc(schema.atendimentoConversa.ultimaMsgEm))
    .limit(200);

  // Conversa esperando a equipe (status humano) fica na lista mesmo fora das
  // 200 mais recentes — senão o aviso "sem resposta há mais de 1 dia" aponta
  // pra uma conversa que não aparece (caso Fernanda Priscilla 13/10).
  const jaVieram = conversas.map((c) => c.id);
  const esperando = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(
      and(
        inArray(schema.atendimentoConversa.filialId, ids),
        eq(schema.atendimentoConversa.status, 'humano'),
        ...(jaVieram.length > 0 ? [notInArray(schema.atendimentoConversa.id, jaVieram)] : []),
      ),
    )
    .orderBy(desc(schema.atendimentoConversa.ultimaMsgEm))
    .limit(50)
    .catch(() => []);
  conversas.push(...esperando);

  const nomes = new Map(filiais.map((f) => [f.id, f.nome]));
  // Nome do atendente de cada casa (Nina no Bar, Otávio na Tabuará, Marina na Mar).
  const cfgs = await db
    .select({ filialId: schema.atendimentoConfig.filialId, nome: schema.atendimentoConfig.nomeAtendente })
    .from(schema.atendimentoConfig)
    .where(inArray(schema.atendimentoConfig.filialId, ids))
    .catch(() => []);
  const atendentes = new Map(cfgs.map((x) => [x.filialId, x.nome]));
  return NextResponse.json({
    conversas: conversas.map((c) => ({
      ...c,
      filialNome: nomes.get(c.filialId) ?? '',
      atendente: atendentes.get(c.filialId) || 'Nina',
    })),
    filiais: filiais.map((f) => ({ id: f.id, nome: f.nome })),
  });
}
