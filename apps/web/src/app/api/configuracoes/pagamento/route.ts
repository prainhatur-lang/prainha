// Credencial Cielo por filial.
//
//   GET  → estado de cada filial (o que tem cadastrado, em PISTA — nunca o
//          segredo). Serve pra tela mostrar "usando a conta própria" ou
//          "caindo na global".
//   PUT  → grava/atualiza as chaves de UMA filial (cifradas).
//   DELETE → apaga as chaves da filial; ela volta pra env global.
//
// O segredo NUNCA volta pro navegador, nem pra quem tem permissão: a tela
// mostra "1001…7289" e a pessoa redigita se precisar trocar. Assim nem um
// print de tela nem o histórico do navegador carregam chave de cartão.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, pista, segredoConfigurado } from '@/lib/segredo';
import { CHAVES_CIELO, CHAVES_CIELO_SECRETAS } from '@/lib/cielo-credenciais';
import { CHAVES_REDE, CHAVES_REDE_SECRETAS } from '@/lib/rede-credenciais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Dois provedores na mesma tabela: 'cielo' (padrão) e 'rede' (e.Rede).
type Provedor = 'cielo' | 'rede';
const provedorDe = (v: unknown): Provedor => (v === 'rede' ? 'rede' : 'cielo');
const chavesDe = (p: Provedor): readonly string[] => (p === 'rede' ? CHAVES_REDE : CHAVES_CIELO);
const secretasDe = (p: Provedor): readonly string[] => (p === 'rede' ? CHAVES_REDE_SECRETAS : CHAVES_CIELO_SECRETAS);

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.read');
  if (error) return error;
  const PROVEDOR = provedorDe(new URL(request.url).searchParams.get('provedor'));

  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) return NextResponse.json({ filiais: [], segredoConfigurado: segredoConfigurado() });

  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      chave: schema.filialCredencial.chave,
      pista: schema.filialCredencial.pista,
      atualizadoEm: schema.filialCredencial.atualizadoEm,
    })
    .from(schema.filialCredencial)
    .where(and(
      inArray(schema.filialCredencial.filialId, filiais.map((f) => f.id)),
      eq(schema.filialCredencial.provedor, PROVEDOR),
    ));

  const porFilial = new Map<string, Record<string, { pista: string | null; atualizadoEm: string }>>();
  for (const l of linhas) {
    const m = porFilial.get(l.filialId) ?? {};
    m[l.chave] = { pista: l.pista, atualizadoEm: l.atualizadoEm.toISOString() };
    porFilial.set(l.filialId, m);
  }

  return NextResponse.json({
    segredoConfigurado: segredoConfigurado(),
    provedor: PROVEDOR,
    chaves: chavesDe(PROVEDOR),
    secretas: secretasDe(PROVEDOR),
    filiais: filiais.map((f) => ({
      id: f.id,
      nome: f.nome,
      // Sem cadastro = a filial cobra pela credencial global do .env.
      propria: porFilial.has(f.id),
      valores: porFilial.get(f.id) ?? {},
    })),
  });
}

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;

  if (!segredoConfigurado()) {
    return NextResponse.json(
      { error: 'CREDENCIAL_SECRET não está configurada no servidor — sem ela não dá pra guardar credencial em segurança.' },
      { status: 503 },
    );
  }

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });
  const PROVEDOR = provedorDe(b?.provedor);

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const valores = (b?.valores ?? {}) as Record<string, unknown>;
  let gravadas = 0;
  for (const chave of chavesDe(PROVEDOR)) {
    const bruto = valores[chave];
    // Campo em branco = "não mexi nesse" (a tela nunca devolve o segredo, só
    // a pista). Pra apagar tudo existe o DELETE.
    if (typeof bruto !== 'string' || !bruto.trim()) continue;
    const valor = bruto.trim();
    await db
      .insert(schema.filialCredencial)
      .values({
        filialId,
        provedor: PROVEDOR,
        chave,
        valor: cifrar(valor),
        pista: pista(valor),
        atualizadoPor: user.id,
      })
      .onConflictDoUpdate({
        target: [schema.filialCredencial.filialId, schema.filialCredencial.provedor, schema.filialCredencial.chave],
        set: {
          valor: cifrar(valor),
          pista: pista(valor),
          atualizadoPor: user.id,
          atualizadoEm: new Date(),
        },
      });
    gravadas += 1;
  }

  return NextResponse.json({ ok: true, gravadas });
}

export async function DELETE(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;

  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filialId') ?? '';
  const PROVEDOR = provedorDe(sp.get('provedor'));
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  await db
    .delete(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, PROVEDOR),
    ));

  return NextResponse.json({ ok: true });
}
