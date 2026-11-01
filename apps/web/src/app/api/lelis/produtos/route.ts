// POST /api/lelis/produtos — cadastra produto à mão (sem nota).
// PATCH /api/lelis/produtos — altera custo, percentuais, preço manual, dados fiscais.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { gtinValido } from '@/lib/lelis/sincronizar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const num = z.number().finite().nullable().optional();
const Campos = z.object({
  descricao: z.string().trim().min(1).max(200).optional(),
  ean: z.string().trim().max(14).nullable().optional(),
  ncm: z.string().trim().max(10).nullable().optional(),
  cest: z.string().trim().max(10).nullable().optional(),
  unidade: z.string().trim().min(1).max(6).optional(),
  custoUnit: num,
  pctIpi: num,
  aliqOrigem: num,
  pctCarga: num,
  cargaComIpi: z.boolean().optional(),
  freteUnit: num,
  pctOperacional: num,
  pctMargem: num,
  pctImpostosVenda: num,
  precoManual: num,
  ativo: z.boolean().optional(),
  /** Tributação da saída escolhida à mão (null = volta pro que a nota de entrada diz). */
  tribIcms: z.enum(['TRIBUTADO', 'ST', 'ISENTO', 'NAO_TRIB']).nullable().optional(),
  cstPisSaida: z.enum(['01', '04', '05', '06', '07', '08', '09']).nullable().optional(),
});

const txt = (x: number | null | undefined) => (x == null ? null : String(x));

function paraBanco(c: z.infer<typeof Campos>) {
  const s: Record<string, unknown> = {};
  if (c.descricao !== undefined) s.descricao = c.descricao;
  if (c.ean !== undefined) s.ean = c.ean ? c.ean.replace(/\D/g, '') || null : null;
  if (c.ncm !== undefined) s.ncm = c.ncm ? c.ncm.replace(/\D/g, '').slice(0, 8) || null : null;
  if (c.cest !== undefined) s.cest = c.cest ? c.cest.replace(/\D/g, '').slice(0, 7) || null : null;
  if (c.unidade !== undefined) s.unidade = c.unidade.toUpperCase();
  // Campos NOT NULL: null vira 0
  if (c.custoUnit !== undefined) s.custoUnit = String(c.custoUnit ?? 0);
  if (c.pctIpi !== undefined) s.pctIpi = String(c.pctIpi ?? 0);
  if (c.freteUnit !== undefined) s.freteUnit = String(c.freteUnit ?? 0);
  if (c.aliqOrigem !== undefined) s.aliqOrigem = txt(c.aliqOrigem);
  if (c.pctCarga !== undefined) s.pctCarga = txt(c.pctCarga);
  if (c.cargaComIpi !== undefined) s.cargaComIpi = c.cargaComIpi;
  if (c.pctOperacional !== undefined) s.pctOperacional = txt(c.pctOperacional);
  if (c.pctMargem !== undefined) s.pctMargem = txt(c.pctMargem);
  if (c.pctImpostosVenda !== undefined) s.pctImpostosVenda = txt(c.pctImpostosVenda);
  if (c.precoManual !== undefined) s.precoManual = c.precoManual && c.precoManual > 0 ? String(c.precoManual) : null;
  if (c.ativo !== undefined) s.ativo = c.ativo;
  if (c.tribIcms !== undefined || c.cstPisSaida !== undefined) {
    if (c.tribIcms !== undefined) s.tribIcms = c.tribIcms;
    if (c.cstPisSaida !== undefined) s.cstPisSaida = c.cstPisSaida;
    // os dois null = "voltar pro automático": a próxima sincronização refaz pela nota
    s.tribManual = !(c.tribIcms === null && (c.cstPisSaida === null || c.cstPisSaida === undefined));
  }
  return s;
}

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Campos.extend({ descricao: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const ean = gtinValido(p.data.ean);
  const chave = ean ?? `M:${randomUUID()}`;
  const [novo] = await db
    .insert(schema.revendaProduto)
    .values({ filialId: a.filialId, chave, descricao: p.data.descricao, ...paraBanco(p.data), atualizadoPor: a.email })
    .onConflictDoNothing()
    .returning({ id: schema.revendaProduto.id });
  if (!novo) return NextResponse.json({ error: 'Já existe produto com esse EAN' }, { status: 409 });
  return NextResponse.json({ ok: true, id: novo.id });
}

export async function PATCH(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Campos.extend({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const set = paraBanco(p.data);
  const [r] = await db
    .update(schema.revendaProduto)
    .set({ ...set, atualizadoEm: new Date(), atualizadoPor: a.email })
    .where(and(eq(schema.revendaProduto.id, p.data.id), eq(schema.revendaProduto.filialId, a.filialId)))
    .returning({ id: schema.revendaProduto.id });
  if (!r) return NextResponse.json({ error: 'produto não encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
