// /api/avaliacoes/google/fichas — qual ficha do Google é a de cada casa.
//  GET  → as fichas que a(s) conta(s) Google ligada(s) administra(m) + a escolha
//         atual e a sugestão por nome de cada casa.
//  POST { filialId, ficha: "accounts/1/locations/2" | "" } → grava a escolha
//         ("" tira a ficha da casa, ex.: filial de teste).
// Só pra quem tem avaliacao.configurar, e só nas casas que a pessoa enxerga.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import {
  ErroGoogle,
  casarFichas,
  googleConfigurado,
  listarFichas,
  tokenDeAcesso,
  type FichaGoogle,
} from '@/lib/google-avaliacoes';
import {
  ligacoesGoogle,
  limparFichaGoogle,
  salvarChaveGoogle,
  salvarFichaGoogle,
  type LigacaoGoogle,
} from '@/lib/google-avaliacoes-ligacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const chaveDe = (f: { conta: string; local: string }) => `${f.conta}/${f.local}`;

/** Lista as fichas de cada conta Google ligada (quase sempre uma só) e lembra
 *  qual chave enxerga cada ficha — a chave não sai daqui pro navegador. */
async function fichasDasContas(
  ligacoes: Map<string, LigacaoGoogle>,
): Promise<{ fichas: FichaGoogle[]; chaveDaFicha: Map<string, string> }> {
  const chaves = [...new Set([...ligacoes.values()].map((l) => l.refreshToken))];
  const fichas: FichaGoogle[] = [];
  const chaveDaFicha = new Map<string, string>();
  let erro: unknown = null;
  let leu = false;
  for (const rt of chaves) {
    try {
      for (const f of await listarFichas(await tokenDeAcesso(rt))) {
        if (chaveDaFicha.has(chaveDe(f))) continue;
        chaveDaFicha.set(chaveDe(f), rt);
        fichas.push(f);
      }
      leu = true;
    } catch (e) {
      erro ??= e;
    }
  }
  if (!leu && erro) throw erro;
  fichas.sort((a, b) => a.titulo.localeCompare(b.titulo));
  return { fichas, chaveDaFicha };
}

function falha(e: unknown) {
  if (e instanceof ErroGoogle) {
    const status = e.motivo === 'religar' ? 409 : e.motivo === 'sem-cota' ? 503 : 502;
    return NextResponse.json({ error: e.message, motivo: e.motivo }, { status });
  }
  console.error('[google-avaliacoes] fichas:', e);
  return NextResponse.json({ error: 'Não consegui falar com o Google agora.' }, { status: 502 });
}

export async function GET() {
  const { user, error } = await exigirPermApi('avaliacao.configurar');
  if (error) return error;
  if (!googleConfigurado()) {
    return NextResponse.json({ error: 'Faltam as chaves do Google na Vercel.' }, { status: 409 });
  }
  const casas = (await filiaisDoUsuario(user.id)).map((f) => ({ id: f.id, nome: f.nome }));
  const ligacoes = await ligacoesGoogle(casas.map((c) => c.id));
  if (ligacoes.size === 0) {
    return NextResponse.json({ error: 'Ligue a conta Google primeiro.' }, { status: 409 });
  }
  try {
    const { fichas } = await fichasDasContas(ligacoes);
    const sugeridas = casarFichas(casas, fichas);
    return NextResponse.json({
      ok: true,
      fichas: fichas.map((f) => ({ ficha: chaveDe(f), titulo: f.titulo, endereco: f.endereco })),
      casas: casas.map((c) => {
        const l = ligacoes.get(c.id);
        const s = sugeridas.get(c.id);
        return {
          id: c.id,
          nome: c.nome,
          atual: l?.local ? chaveDe(l) : '',
          sugestao: s ? chaveDe(s) : '',
        };
      }),
    });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('avaliacao.configurar');
  if (error) return error;
  const body = await request.json().catch(() => null);
  const filialId = typeof body?.filialId === 'string' ? body.filialId : '';
  const ficha = typeof body?.ficha === 'string' ? body.ficha.trim() : null;
  if (!filialId || ficha === null) {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }
  const casas = await filiaisDoUsuario(user.id);
  if (!casas.some((c) => c.id === filialId)) {
    return NextResponse.json({ error: 'filial fora do seu acesso' }, { status: 403 });
  }

  if (ficha === '') {
    await limparFichaGoogle(filialId);
    return NextResponse.json({ ok: true });
  }

  const ligacoes = await ligacoesGoogle(casas.map((c) => c.id));
  if (ligacoes.size === 0) {
    return NextResponse.json({ error: 'Ligue a conta Google primeiro.' }, { status: 409 });
  }
  try {
    // a ficha tem que estar na lista que o Google acabou de devolver — ninguém
    // grava um endereço de ficha digitado à mão
    const { fichas, chaveDaFicha } = await fichasDasContas(ligacoes);
    const f = fichas.find((x) => chaveDe(x) === ficha);
    const rt = chaveDaFicha.get(ficha);
    if (!f || !rt) {
      return NextResponse.json({ error: 'Essa ficha não está na conta Google ligada.' }, { status: 404 });
    }
    await salvarChaveGoogle(filialId, rt, user.id);
    await salvarFichaGoogle(filialId, f, user.id);
    return NextResponse.json({ ok: true, titulo: f.titulo });
  } catch (e) {
    return falha(e);
  }
}
