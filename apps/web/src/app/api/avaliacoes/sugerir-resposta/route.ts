// POST /api/avaliacoes/sugerir-resposta — a IA escreve o RASCUNHO da resposta
// da casa a uma avaliação. Não publica nem envia: devolve o texto pra quem está
// na tela conferir, ajustar e publicar/enviar. Grava só a resposta que a IA
// escreveu (`avaliacao_resposta_ia`, nunca o texto da avaliação) e manda as
// últimas da casa pra próxima não sair repetida (18/10/2026).
//
// Dois jeitos de chamar:
//  - { avaliacaoId, orientacao? } → mensagem particular de WhatsApp pro cliente
//    de um feedback da própria casa (o texto é lido do banco, não do navegador);
//  - { filialId, canal: 'tripadvisor'|'google', nota?, texto, orientacao? } →
//    resposta pública; `texto` é o que a pessoa COLOU da página da avaliação.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { sugerirResposta, type PedidoResposta } from '@/lib/avaliacao-resposta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_TEXTO = 4000;
const MAX_ORIENTACAO = 800;

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('avaliacao.update');
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }
  const orientacao =
    typeof body.orientacao === 'string' ? body.orientacao.trim().slice(0, MAX_ORIENTACAO) : '';

  // só casas que o usuário enxerga
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) {
    return NextResponse.json({ error: 'sem filiais' }, { status: 403 });
  }

  let pedido: PedidoResposta;
  let filialAlvo: string;

  if (typeof body.avaliacaoId === 'string' && body.avaliacaoId) {
    const [av] = await db
      .select({
        filialId: schema.avaliacao.filialId,
        nota: schema.avaliacao.nota,
        comentario: schema.avaliacao.comentario,
        nome: schema.avaliacao.nome,
      })
      .from(schema.avaliacao)
      .where(and(eq(schema.avaliacao.id, body.avaliacaoId), inArray(schema.avaliacao.filialId, filialIds)))
      .limit(1);
    if (!av) return NextResponse.json({ error: 'avaliação não encontrada' }, { status: 404 });
    filialAlvo = av.filialId;
    pedido = {
      canal: 'whatsapp',
      casa: filiais.find((f) => f.id === av.filialId)?.nome ?? 'restaurante',
      nota: av.nota,
      texto: (av.comentario ?? '').trim() || '(o cliente deu a nota e não escreveu comentário)',
      nome: av.nome,
      orientacao,
    };
  } else {
    const filial = filiais.find((f) => f.id === body.filialId);
    if (!filial) return NextResponse.json({ error: 'casa não encontrada' }, { status: 404 });
    filialAlvo = filial.id;
    const canal = body.canal === 'google' ? 'google' : body.canal === 'tripadvisor' ? 'tripadvisor' : null;
    if (!canal) return NextResponse.json({ error: 'canal inválido' }, { status: 400 });
    const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
    if (texto.length < 5) {
      return NextResponse.json({ error: 'cole o texto da avaliação' }, { status: 400 });
    }
    if (texto.length > MAX_TEXTO) {
      return NextResponse.json({ error: `avaliação com mais de ${MAX_TEXTO} caracteres` }, { status: 400 });
    }
    const n = Number(body.nota);
    pedido = {
      canal,
      casa: filial.nome,
      nota: Number.isInteger(n) && n >= 1 && n <= 5 ? n : null,
      texto,
      orientacao,
    };
  }

  // últimas respostas da IA nessa casa e nesse tipo (pública × WhatsApp)
  {
    const canais = pedido.canal === 'whatsapp' ? ['whatsapp'] : ['tripadvisor', 'google'];
    const ult = await db
      .select({ resposta: schema.avaliacaoRespostaIa.resposta })
      .from(schema.avaliacaoRespostaIa)
      .where(
        and(
          eq(schema.avaliacaoRespostaIa.filialId, filialAlvo),
          inArray(schema.avaliacaoRespostaIa.canal, canais),
        ),
      )
      .orderBy(desc(schema.avaliacaoRespostaIa.criadoEm))
      .limit(12)
      .catch(() => []);
    pedido.anteriores = ult.map((u) => u.resposta);
  }

  try {
    const r = await sugerirResposta(pedido);
    await db
      .insert(schema.avaliacaoRespostaIa)
      .values({
        filialId: filialAlvo,
        canal: pedido.canal,
        nota: pedido.nota,
        resposta: r.resposta.slice(0, 4000),
        criadoPor: user.id,
      })
      .catch((e) => console.error('[avaliacao] guardar resposta IA falhou:', e));
    return NextResponse.json({ ok: true, resposta: r.resposta, conferir: r.conferir, motor: r.motor });
  } catch (e) {
    console.error('[avaliacao] sugerir-resposta falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'falha na IA' },
      { status: 502 },
    );
  }
}
