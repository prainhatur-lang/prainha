// POST /api/nfce/emitir-pedido — emite a NFC-e de um pedido pelo PAINEL,
// montando a nota do espelho Postgres (não precisa da loja de pé).
//
// Diferente de /api/nfce/emitir, que é o canal da LOJA (auth por HMAC, recebe
// itens/pagamentos já montados do Firebird). Aqui a auth é a sessão do
// usuário + permissão nfce.emitir, e o payload é só o pedido.
//
// Idempotente pelo mesmo caminho do outro: emitirNfcePedido() devolve a nota
// já autorizada se o pedidoChave repetir.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { emitirNfcePedido } from '@/lib/nfce/emitir';
import { montarNfceDoEspelho } from '@/lib/nfce/montar-do-espelho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  filialId: z.string().uuid(),
  codigoExterno: z.number().int().positive(),
  /** CPF/CNPJ do consumidor (opcional — nota sem destinatário é válida). */
  documento: z.string().max(20).nullish(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('nfce.emitir');
  if (error) return error;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, erro: 'body inválido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { filialId, codigoExterno, documento } = parsed.data;

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });

  const montado = await montarNfceDoEspelho(filialId, codigoExterno);
  if (!montado.ok || !montado.input) {
    return NextResponse.json({ ok: false, erro: montado.erro ?? 'falha ao montar a nota' }, { status: 422 });
  }

  try {
    const r = await emitirNfcePedido(filialId, {
      ...montado.input,
      documento: documento ?? null,
      solicitadoPor: (user.email ?? 'painel').slice(0, 60),
    });
    return NextResponse.json({ ...r, resumo: montado.resumo }, { status: r.ok ? 200 : 422 });
  } catch (err) {
    console.error('[nfce/emitir-pedido]', err);
    return NextResponse.json(
      { ok: false, erro: `erro interno: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
