// Credencial e ajustes do iFood por filial.
//
//   GET    → o que cada filial tem. O client_secret volta só como PISTA; o
//            resto volta inteiro, porque é identificação/ajuste e esconder
//            atrapalharia quem precisa conferir qual loja está apontada.
//   PUT    → grava as chaves de UMA filial (cifradas).
//   DELETE → apaga a config da filial; ela para de receber pelo Concilia.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, decifrar, pista, segredoConfigurado } from '@/lib/segredo';
import { CHAVES_IFOOD, CHAVES_IFOOD_SECRETAS, CAMPOS_IFOOD, PROVEDOR_IFOOD, type ChaveIfood } from '@/lib/ifood-credenciais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { user, error } = await exigirPermApi('configuracao.read');
  if (error) return error;

  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) return NextResponse.json({ filiais: [], segredoConfigurado: segredoConfigurado() });

  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      chave: schema.filialCredencial.chave,
      valor: schema.filialCredencial.valor,
      pista: schema.filialCredencial.pista,
    })
    .from(schema.filialCredencial)
    .where(and(
      inArray(schema.filialCredencial.filialId, filiais.map((f) => f.id)),
      eq(schema.filialCredencial.provedor, PROVEDOR_IFOOD),
    ));

  const porFilial = new Map<string, Record<string, string>>();
  for (const l of linhas) {
    const m = porFilial.get(l.filialId) ?? {};
    if ((CHAVES_IFOOD_SECRETAS as string[]).includes(l.chave)) {
      m[l.chave] = l.pista ?? '••••';
    } else {
      try { m[l.chave] = decifrar(l.valor); } catch { m[l.chave] = ''; }
    }
    porFilial.set(l.filialId, m);
  }

  return NextResponse.json({
    segredoConfigurado: segredoConfigurado(),
    campos: CAMPOS_IFOOD,
    secretas: CHAVES_IFOOD_SECRETAS,
    filiais: filiais.map((f) => ({
      id: f.id,
      nome: f.nome,
      configurada: porFilial.has(f.id),
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

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const valores = (b?.valores ?? {}) as Record<string, unknown>;

  // Ligar a integração sem credencial só encheria o log de erro da loja de
  // 30 em 30 segundos — a checagem é aqui, onde dá pra explicar o motivo.
  if (String(valores.ativo ?? '') === '1') {
    const jaTem = await db
      .select({ chave: schema.filialCredencial.chave })
      .from(schema.filialCredencial)
      .where(and(
        eq(schema.filialCredencial.filialId, filialId),
        eq(schema.filialCredencial.provedor, PROVEDOR_IFOOD),
      ));
    const tem = (c: string) => jaTem.some((l) => l.chave === c) || !!String(valores[c] ?? '').trim();
    if (!tem('clientId') || !tem('clientSecret')) {
      return NextResponse.json({ error: 'preencha client_id e client_secret antes de ligar a integração' }, { status: 400 });
    }
  }

  let gravadas = 0;
  for (const chave of CHAVES_IFOOD as ChaveIfood[]) {
    const bruto = valores[chave];
    // Campo em branco = "não mexi nesse" (o segredo nunca volta pra tela, só
    // a pista). Pra apagar tudo existe o DELETE.
    if (typeof bruto !== 'string' || !bruto.trim()) continue;
    const valor = bruto.trim();
    const linha = {
      valor: cifrar(valor),
      pista: pista(valor),
      atualizadoPor: user.id,
    };
    await db
      .insert(schema.filialCredencial)
      .values({ filialId, provedor: PROVEDOR_IFOOD, chave, ...linha })
      .onConflictDoUpdate({
        target: [schema.filialCredencial.filialId, schema.filialCredencial.provedor, schema.filialCredencial.chave],
        set: { ...linha, atualizadoEm: new Date() },
      });
    gravadas += 1;
  }

  return NextResponse.json({ ok: true, gravadas });
}

export async function DELETE(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;

  const filialId = new URL(request.url).searchParams.get('filialId') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  await db
    .delete(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, PROVEDOR_IFOOD),
    ));

  return NextResponse.json({ ok: true });
}
