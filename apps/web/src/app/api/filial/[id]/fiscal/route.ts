// PATCH /api/filial/[id]/fiscal — salva a config de emissão de NFC-e da filial.
// Permissão configuracao.editar + vínculo com a filial.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Endereco = z.object({
  logradouro: z.string().min(1).max(60),
  numero: z.string().min(1).max(60),
  complemento: z.string().max(60).optional(),
  bairro: z.string().min(1).max(60),
  codigoMunicipio: z.string().regex(/^\d{7}$/),
  municipio: z.string().min(1).max(60),
  uf: z.string().length(2),
  cep: z.string().regex(/^\d{8}$/),
  fone: z.string().max(14).optional(),
});

const Body = z.object({
  ativo: z.boolean(),
  ambiente: z.union([z.literal(1), z.literal(2)]),
  serie: z.number().int().min(1).max(999),
  razaoSocial: z.string().min(1).max(60),
  nomeFantasia: z.string().max(60).optional(),
  ie: z.string().regex(/^\d{2,14}$/),
  crt: z.union([z.literal(1), z.literal(3)]).default(1),
  endereco: Endereco,
  cscId: z.string().max(6).optional(),
  cscToken: z.string().max(64).optional(),
  cscIdHom: z.string().max(6).optional(),
  cscTokenHom: z.string().max(64).optional(),
  padraoItem: z
    .object({
      ncm: z.string().regex(/^\d{8}$/),
      cfop: z.string().regex(/^5\d{3}$/),
      csosn: z.string().regex(/^\d{3}$/),
      origem: z.string().regex(/^[0-8]$/).optional(),
    })
    .optional(),
  respTec: z
    .object({
      cnpj: z.string().regex(/^\d{14}$/),
      contato: z.string().min(1).max(60),
      email: z.string().email().max(60),
      fone: z.string().regex(/^\d{6,14}$/),
    })
    .optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await exigirPermApi('configuracao.editar');
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(eq(schema.usuarioFilial.usuarioId, auth.user.id), eq(schema.usuarioFilial.filialId, id)),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(schema.filial)
    .set({ fiscalConfig: parsed.data })
    .where(eq(schema.filial.id, id))
    .returning({ id: schema.filial.id });

  return NextResponse.json({ ok: true, id: updated?.id });
}
