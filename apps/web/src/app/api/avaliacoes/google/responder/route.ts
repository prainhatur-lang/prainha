// POST /api/avaliacoes/google/responder { filialId, reviewId, texto } — publica
// (ou troca) a resposta da casa numa avaliação do Google, pela API oficial do
// Perfil da Empresa. Só roda pelo clique de quem está na tela em "Publicar no
// Google": nada aqui responde sozinho, e o texto vem do quadro que a pessoa leu.
// Não grava o texto no banco.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import {
  ErroGoogle,
  MAX_RESPOSTA_BYTES,
  googleConfigurado,
  publicarResposta,
  tokenDeAcesso,
} from '@/lib/google-avaliacoes';
import { ligacoesGoogle } from '@/lib/google-avaliacoes-ligacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('avaliacao.update');
  if (error) return error;

  const body = await request.json().catch(() => null);
  const filialId = typeof body?.filialId === 'string' ? body.filialId : '';
  const reviewId = typeof body?.reviewId === 'string' ? body.reviewId : '';
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : '';
  if (!filialId || !reviewId) {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }
  if (texto.length < 2) {
    return NextResponse.json({ error: 'Escreva a resposta antes de publicar.' }, { status: 400 });
  }
  if (Buffer.byteLength(texto, 'utf8') > MAX_RESPOSTA_BYTES) {
    return NextResponse.json(
      { error: 'A resposta passou do tamanho que o Google aceita. Encurte o texto.' },
      { status: 400 },
    );
  }

  // só casas que o usuário enxerga
  const casas = await filiaisDoUsuario(user.id);
  if (!casas.some((c) => c.id === filialId)) {
    return NextResponse.json({ error: 'filial fora do seu acesso' }, { status: 403 });
  }
  if (!googleConfigurado()) {
    return NextResponse.json({ error: 'Faltam as chaves do Google na Vercel.' }, { status: 409 });
  }
  const l = (await ligacoesGoogle([filialId])).get(filialId);
  if (!l?.local) {
    return NextResponse.json({ error: 'Esta casa ainda não está ligada ao Google.' }, { status: 409 });
  }

  try {
    const acesso = await tokenDeAcesso(l.refreshToken);
    const r = await publicarResposta(acesso, l.conta, l.local, reviewId, texto);
    // rastro de quem publicou (sem o texto)
    console.log(`[google-avaliacoes] resposta publicada filial=${filialId} review=${reviewId} por=${user.id}`);
    return NextResponse.json({ ok: true, estado: r.estado });
  } catch (e) {
    if (e instanceof ErroGoogle) {
      const status = e.motivo === 'religar' ? 409 : e.motivo === 'sem-cota' ? 503 : 502;
      return NextResponse.json({ error: e.message, motivo: e.motivo }, { status });
    }
    console.error('[google-avaliacoes] responder:', e);
    return NextResponse.json({ error: 'Não consegui falar com o Google agora.' }, { status: 502 });
  }
}
