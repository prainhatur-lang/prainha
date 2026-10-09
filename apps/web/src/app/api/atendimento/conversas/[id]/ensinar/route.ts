// POST /api/atendimento/conversas/[id]/ensinar — a Nina não soube responder,
// a equipe ensina pelo painel. Body: { pergunta, resposta }.
// Grava o par na base de conhecimento da filial (bloco "Respostas da equipe"),
// devolve a conversa pra Nina e ela responde o cliente já com a informação.
// Mexe na base de conhecimento → mesma permissão da tela de configuração.

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import type { BlocoConhecimento } from '@concilia/db/schema';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import { responderPendenteAposDevolucao } from '@/lib/atendimento/motor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PREFIXO_ID = 'aprendido';
const TITULO =
  'Respostas da equipe (aprendido) — VALE MAIS que qualquer [PENDENTE] ou trecho mais antigo desta base';
// A tela de configuração corta bloco em 4000 caracteres: passou disso, abre outro.
const LIMITE_BLOCO = 3500;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;
  const { id } = await params;

  const b = await request.json().catch(() => null);
  const limpa = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const pergunta = limpa(b?.pergunta, 400);
  const resposta = limpa(b?.resposta, 1200);
  if (!pergunta || !resposta) {
    return NextResponse.json({ error: 'preencha a pergunta e a resposta' }, { status: 400 });
  }

  const [conversa] = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(eq(schema.atendimentoConversa.id, id))
    .limit(1);
  if (!conversa) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === conversa.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const [config] = await db
    .select({ conhecimento: schema.atendimentoConfig.conhecimento })
    .from(schema.atendimentoConfig)
    .where(eq(schema.atendimentoConfig.filialId, conversa.filialId))
    .limit(1);
  if (!config) {
    return NextResponse.json({ error: 'a Nina ainda não foi configurada nessa filial' }, { status: 400 });
  }

  const linha = `- (${hojeBr()}) Pergunta: ${pergunta}\n  Resposta: ${resposta}`;
  const blocos: BlocoConhecimento[] = [...(config.conhecimento ?? [])];
  const aprendidos = blocos.filter((x) => x.id.startsWith(PREFIXO_ID));
  const atual = aprendidos[aprendidos.length - 1];
  if (atual && atual.conteudo.length + linha.length + 1 <= LIMITE_BLOCO) {
    atual.conteudo = `${atual.conteudo}\n${linha}`;
  } else {
    blocos.push({ id: `${PREFIXO_ID}-${aprendidos.length + 1}`, titulo: TITULO, conteudo: linha });
  }

  await db
    .update(schema.atendimentoConfig)
    .set({ conhecimento: blocos, atualizadoEm: sql`now()` })
    .where(eq(schema.atendimentoConfig.filialId, conversa.filialId));

  await db
    .update(schema.atendimentoConversa)
    .set({ status: 'bot', motivoTransferencia: null, atualizadoEm: sql`now()` })
    .where(eq(schema.atendimentoConversa.id, id));

  // A Nina responde o cliente agora, mesmo que a última mensagem da conversa
  // seja a promessa dela ("assim que meu colega responder eu te chamo").
  after(() => responderPendenteAposDevolucao(id, { forcar: true }));

  return NextResponse.json({ ok: true });
}
