// GET/PUT /api/atendimento/config — configuração da Nina por filial.
// GET  ?filial=<id> → config + números conectados da filial.
// PUT  { filialId, ativo?, nomeAtendente?, persona?, conhecimento?,
//        espacosEvento?, numerosEquipe?, numeros?: [{phoneNumberId, atendenteAtivo}] }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import type { BlocoConhecimento, EspacoEvento } from '@concilia/db/schema';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { buscarNumeroExibicao } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;

  const url = new URL(request.url);
  const filialId = url.searchParams.get('filial');
  const filiais = await filiaisDoUsuario(user.id);
  const alvo = filialId ?? filiais[0]?.id;
  if (!alvo || !filiais.some((f) => f.id === alvo)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const [config] = await db
    .select()
    .from(schema.atendimentoConfig)
    .where(eq(schema.atendimentoConfig.filialId, alvo))
    .limit(1);
  const numeros = await db
    .select()
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, alvo));

  // Preenche o numero de exibicao a partir da Meta na primeira visita
  // (o token so existe em producao — por isso nao veio no seed).
  for (const n of numeros) {
    if (n.numeroExibicao) continue;
    const exibicao = await buscarNumeroExibicao(n.phoneNumberId);
    if (exibicao) {
      n.numeroExibicao = exibicao;
      await db
        .update(schema.whatsappNumero)
        .set({ numeroExibicao: exibicao.replace(/\D/g, '').slice(0, 20) })
        .where(eq(schema.whatsappNumero.phoneNumberId, n.phoneNumberId));
    }
  }

  return NextResponse.json({
    config: config ?? null,
    numeros,
    filiais: filiais.map((f) => ({ id: f.id, nome: f.nome })),
    filialId: alvo,
  });
}

function sanitizarConhecimento(v: unknown): BlocoConhecimento[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: BlocoConhecimento[] = [];
  for (const b of v.slice(0, 50)) {
    const titulo = typeof b?.titulo === 'string' ? b.titulo.trim().slice(0, 120) : '';
    const conteudo = typeof b?.conteudo === 'string' ? b.conteudo.trim().slice(0, 4000) : '';
    if (!titulo && !conteudo) continue;
    out.push({
      id: typeof b?.id === 'string' && b.id ? b.id.slice(0, 40) : `b${out.length}-${Math.random().toString(36).slice(2, 8)}`,
      titulo: titulo || 'Sem título',
      conteudo,
    });
  }
  return out;
}

function sanitizarEspacos(v: unknown): EspacoEvento[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: EspacoEvento[] = [];
  for (const e of v.slice(0, 20)) {
    const nome = typeof e?.nome === 'string' ? e.nome.trim().slice(0, 80) : '';
    if (!nome) continue;
    out.push({
      id: typeof e?.id === 'string' && e.id ? e.id.slice(0, 40) : `e${out.length}-${Math.random().toString(36).slice(2, 8)}`,
      nome,
      capacidade: typeof e?.capacidade === 'string' ? e.capacidade.trim().slice(0, 120) : '',
      descricao: typeof e?.descricao === 'string' ? e.descricao.trim().slice(0, 600) : '',
      preco: typeof e?.preco === 'string' ? e.preco.trim().slice(0, 300) : '',
      condicoes: typeof e?.condicoes === 'string' ? e.condicoes.trim().slice(0, 600) : '',
      ativo: e?.ativo !== false,
    });
  }
  return out;
}

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('atendimento.config');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const conhecimento = sanitizarConhecimento(b?.conhecimento);
  const espacos = sanitizarEspacos(b?.espacosEvento);
  const numerosEquipe = Array.isArray(b?.numerosEquipe)
    ? (b.numerosEquipe as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/\D/g, ''))
        .filter((x) => x.length >= 10 && x.length <= 15)
        .slice(0, 10)
    : undefined;

  const valores = {
    ...(typeof b?.ativo === 'boolean' ? { ativo: b.ativo } : {}),
    ...(typeof b?.nomeAtendente === 'string' && b.nomeAtendente.trim()
      ? { nomeAtendente: b.nomeAtendente.trim().slice(0, 50) }
      : {}),
    ...(typeof b?.persona === 'string' ? { persona: b.persona.trim().slice(0, 3000) } : {}),
    ...(conhecimento !== undefined ? { conhecimento } : {}),
    ...(espacos !== undefined ? { espacosEvento: espacos } : {}),
    ...(numerosEquipe !== undefined ? { numerosEquipe } : {}),
    atualizadoEm: sql`now()`,
  };

  await db
    .insert(schema.atendimentoConfig)
    .values({ filialId, ...valores })
    .onConflictDoUpdate({ target: schema.atendimentoConfig.filialId, set: valores });

  // Toggle do atendente por numero conectado
  if (Array.isArray(b?.numeros)) {
    for (const n of b.numeros as Array<{ phoneNumberId?: string; atendenteAtivo?: boolean }>) {
      if (typeof n?.phoneNumberId !== 'string' || typeof n?.atendenteAtivo !== 'boolean') continue;
      await db
        .update(schema.whatsappNumero)
        .set({ atendenteAtivo: n.atendenteAtivo })
        .where(
          and(
            eq(schema.whatsappNumero.phoneNumberId, n.phoneNumberId),
            eq(schema.whatsappNumero.filialId, filialId),
          ),
        );
    }
  }

  return NextResponse.json({ ok: true });
}
