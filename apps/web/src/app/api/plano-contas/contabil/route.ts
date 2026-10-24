// De-para categoria → conta do contador (24/10/2026). Só mexe nas colunas
// conta_contabil*; o resto da categoria (que vem do Consumer) fica intacto.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SITUACOES = new Set(['ok', 'conferir', 'decidir']);

export async function PATCH(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const categoriaId = typeof b?.categoriaId === 'string' ? b.categoriaId : null;
  const contaContabil =
    typeof b?.contaContabil === 'string' && b.contaContabil.trim() ? b.contaContabil.trim().slice(0, 30) : null;
  const situacao = typeof b?.situacao === 'string' && SITUACOES.has(b.situacao) ? b.situacao : null;
  const obs = typeof b?.obs === 'string' && b.obs.trim() ? b.obs.trim().slice(0, 500) : null;
  if (!filialId || !categoriaId || !situacao) {
    return NextResponse.json({ error: 'filial, categoria e situação são obrigatórios' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  if (contaContabil) {
    const [f] = await db
      .select({ organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId));
    const [conta] = await db
      .select({ id: schema.planoContabil.id })
      .from(schema.planoContabil)
      .where(
        and(
          eq(schema.planoContabil.organizacaoId, f.organizacaoId),
          eq(schema.planoContabil.classificacao, contaContabil),
        ),
      );
    if (!conta) return NextResponse.json({ error: `conta ${contaContabil} não existe no plano do contador` }, { status: 400 });
    // Conta de grupo (sintética) é aceita: nossas categorias-grupo ligam no grupo do contador.
  }

  const upd = await db
    .update(schema.categoriaConta)
    .set({
      contaContabil,
      contaContabilSituacao: situacao,
      contaContabilObs: obs,
      contaContabilEm: new Date(),
      contaContabilPor: user.id,
    })
    .where(and(eq(schema.categoriaConta.id, categoriaId), eq(schema.categoriaConta.filialId, filialId)))
    .returning({ id: schema.categoriaConta.id });
  if (upd.length === 0) return NextResponse.json({ error: 'categoria não encontrada' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
