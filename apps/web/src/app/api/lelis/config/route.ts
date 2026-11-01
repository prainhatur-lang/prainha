// PUT /api/lelis/config — percentuais padrão do preço, tributação da venda e
// dados do emitente da NF-e (filial.fiscal_config da Lelis). Só o Admin.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import type { FiscalConfig } from '@concilia/db/schema';
import { eq } from 'drizzle-orm';
import { acessoLelisApi } from '@/lib/lelis/acesso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const pct = z.number().finite().min(0).max(99);
const Body = z.object({
  pctOperacional: pct,
  pctMargem: pct,
  pctImpostosVenda: pct,
  fiscal: z.object({
    cstIcms: z.string().trim().max(3).optional(),
    aliqIcms: z.number().finite().min(0).max(40).optional(),
    csosn: z.string().trim().max(3).optional(),
    cstPis: z.string().trim().max(2).optional(),
    aliqPis: z.number().finite().min(0).max(20).optional(),
    cstCofins: z.string().trim().max(2).optional(),
    aliqCofins: z.number().finite().min(0).max(20).optional(),
    infCpl: z.string().max(1500).optional(),
  }),
  emitente: z
    .object({
      razaoSocial: z.string().trim().min(2).max(60),
      nomeFantasia: z.string().trim().max(60).optional(),
      ie: z.string().trim().max(20),
      crt: z.union([z.literal(1), z.literal(3)]),
      endereco: z.object({
        logradouro: z.string().trim().min(1).max(60),
        numero: z.string().trim().min(1).max(60),
        complemento: z.string().trim().max(60).optional(),
        bairro: z.string().trim().min(1).max(60),
        codigoMunicipio: z.string().regex(/^\d{7}$/),
        municipio: z.string().trim().min(1).max(60),
        uf: z.string().length(2),
        cep: z.string().regex(/^\d{8}$/),
        fone: z.string().max(14).optional(),
      }),
      nfeSerie: z.number().int().min(1).max(889),
      nfeAmbiente: z.union([z.literal(1), z.literal(2)]),
    })
    .optional(),
});

export async function PUT(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    return NextResponse.json({ error: 'dados inválidos: ' + p.error.issues.map((i) => i.path.join('.')).join(', ') }, { status: 400 });
  }
  const b = p.data;
  const valores = {
    pctOperacional: String(b.pctOperacional),
    pctMargem: String(b.pctMargem),
    pctImpostosVenda: String(b.pctImpostosVenda),
    fiscal: b.fiscal,
    atualizadoEm: new Date(),
    atualizadoPor: a.email,
  };
  await db
    .insert(schema.revendaConfig)
    .values({ filialId: a.filialId, ...valores })
    .onConflictDoUpdate({ target: schema.revendaConfig.filialId, set: valores });

  if (b.emitente) {
    const [f] = await db
      .select({ fiscalConfig: schema.filial.fiscalConfig })
      .from(schema.filial)
      .where(eq(schema.filial.id, a.filialId))
      .limit(1);
    const atual = (f?.fiscalConfig ?? {}) as FiscalConfig;
    const e = b.emitente;
    const novo: FiscalConfig = {
      ...atual,
      razaoSocial: e.razaoSocial,
      nomeFantasia: e.nomeFantasia || atual.nomeFantasia,
      ie: e.ie.replace(/\D/g, ''),
      crt: e.crt,
      endereco: { ...e.endereco, uf: e.endereco.uf.toUpperCase(), fone: e.endereco.fone?.replace(/\D/g, '') || undefined },
      nfe: { ...(atual.nfe ?? {}), serie: e.nfeSerie, ambiente: e.nfeAmbiente, crt: e.crt },
    };
    await db.update(schema.filial).set({ fiscalConfig: novo }).where(eq(schema.filial.id, a.filialId));
  }
  return NextResponse.json({ ok: true });
}
