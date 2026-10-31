// Permutas / parcerias comerciais (31/10/2026) — regra em lib/permuta.ts.
// POST { acao: 'upload_url', nome, tamanho } → endereço assinado pro navegador
//      mandar o contrato direto pro bucket
// POST { acao: 'criar', parceiro..., valorTotal, creditos: [{filialId, valor}] }
//      → grava o contrato e já pede cadastro/lança o crédito em cada casa
// POST { acao: 'reprocessar', id } → "tentar de novo"
// POST { acao: 'cancelar', id, motivo } → só marca (crédito já lançado fica;
//      estorno é na conta corrente do cliente)
// GET  ?id=<contrato> → abre o arquivo (endereço assinado de 1 minuto)
// Ver = 'conta_receber.read'; criar/mexer = 'conta_receber.create'.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BUCKET_PERMUTA, PERMUTA_EXTENSOES, PERMUTA_TAMANHO_MAX, processarPermutas } from '@/lib/permuta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const txt = (max: number) => z.string().trim().max(max).nullable().optional();

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('upload_url'), nome: z.string().trim().min(1).max(200), tamanho: z.number().positive() }),
  z.object({
    acao: z.literal('criar'),
    parceiroNome: z.string().trim().min(2).max(200),
    documento: z.string().trim().max(20),
    contato: txt(200),
    telefone: txt(30),
    email: txt(200),
    valorTotal: z.number().positive().max(10_000_000),
    contrapartida: txt(2000),
    dataInicio: Ymd,
    dataFim: Ymd,
    observacao: txt(2000),
    arquivoPath: z.string().min(1).max(500).nullable().optional(),
    arquivoNome: txt(200),
    creditos: z.array(z.object({ filialId: z.string().uuid(), valor: z.number().positive() })).min(1).max(10),
  }),
  z.object({ acao: z.literal('reprocessar'), id: z.string().uuid() }),
  z.object({ acao: z.literal('cancelar'), id: z.string().uuid(), motivo: z.string().trim().min(3).max(500) }),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pastaDoUsuario = (userId: string) => `permutas/${userId}/`;
const extensao = (nome: string) => nome.toLowerCase().split('.').pop() ?? '';
const centavos = (v: number) => Math.round(v * 100);

/** Contrato existe e o usuário enxerga ao menos uma casa dele. */
async function contratoDoUsuario(id: string, userId: string) {
  const [k] = await db.select().from(schema.permutaContrato).where(eq(schema.permutaContrato.id, id)).limit(1);
  if (!k) return null;
  const casas = await db
    .select({ filialId: schema.permutaCredito.filialId })
    .from(schema.permutaCredito)
    .where(eq(schema.permutaCredito.contratoId, id));
  const filiais = await filiaisDoUsuario(userId);
  return casas.some((c) => filiais.some((f) => f.id === c.filialId)) ? k : null;
}

export async function POST(req: Request) {
  const auth = await exigirPermApi('conta_receber.read');
  if (auth.error) return auth.error;
  const user = auth.user;
  const semPerm = await negarSemPerm(user.id, 'conta_receber.create');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (d.acao === 'upload_url') {
    if (!PERMUTA_EXTENSOES.includes(extensao(d.nome))) {
      return NextResponse.json({ error: 'envie PDF, Word ou foto (JPG, PNG)' }, { status: 400 });
    }
    if (d.tamanho > PERMUTA_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 25 MB' }, { status: 413 });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = d.nome.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pastaDoUsuario(user.id)}${ts}-${safe}`;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_PERMUTA).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.json({ bucket: BUCKET_PERMUTA, path: data.path, token: data.token });
  }

  if (d.acao === 'reprocessar') {
    const k = await contratoDoUsuario(d.id, user.id);
    if (!k) return NextResponse.json({ error: 'contrato não encontrado' }, { status: 404 });
    const r = await processarPermutas({ contratoId: k.id, incluirErro: true });
    return NextResponse.json({ ok: true, ...r });
  }

  if (d.acao === 'cancelar') {
    const k = await contratoDoUsuario(d.id, user.id);
    if (!k || k.canceladoEm) return NextResponse.json({ error: 'contrato não encontrado' }, { status: 404 });
    await db.transaction(async (tx) => {
      await tx
        .update(schema.permutaContrato)
        .set({ canceladoEm: new Date(), canceladoPor: user.email ?? user.id, canceladoMotivo: d.motivo })
        .where(eq(schema.permutaContrato.id, k.id));
      // Crédito que ainda não foi lançado não sai mais.
      await tx
        .update(schema.permutaCredito)
        .set({ status: 'cancelado' })
        .where(and(eq(schema.permutaCredito.contratoId, k.id), isNull(schema.permutaCredito.fiadoLancamentoId)));
    });
    return NextResponse.json({ ok: true });
  }

  // criar
  const filiais = await filiaisDoUsuario(user.id);
  const doc = d.documento.replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) {
    return NextResponse.json({ error: 'CNPJ (14 dígitos) ou CPF (11) do parceiro é obrigatório — é por ele que o cadastro é achado em cada casa' }, { status: 400 });
  }
  const ids = d.creditos.map((c) => c.filialId);
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: 'casa repetida na divisão' }, { status: 400 });
  const casas = ids.map((id) => filiais.find((f) => f.id === id));
  if (casas.some((c) => !c)) return NextResponse.json({ error: 'sem acesso a uma das casas' }, { status: 403 });
  const orgs = new Set(casas.map((c) => c!.organizacaoNome));
  if (orgs.size > 1) return NextResponse.json({ error: 'as casas têm que ser da mesma empresa' }, { status: 400 });
  const soma = d.creditos.reduce((s, c) => s + centavos(c.valor), 0);
  if (soma !== centavos(d.valorTotal)) {
    return NextResponse.json({ error: `a divisão entre as casas (R$ ${(soma / 100).toFixed(2)}) não fecha com o valor do contrato` }, { status: 400 });
  }
  if (d.dataInicio && d.dataFim && d.dataFim < d.dataInicio) {
    return NextResponse.json({ error: 'fim da vigência antes do início' }, { status: 400 });
  }
  if (d.arquivoPath && !d.arquivoPath.startsWith(pastaDoUsuario(user.id))) {
    return NextResponse.json({ error: 'arquivo de outro usuário' }, { status: 400 });
  }
  const [org] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, ids[0]!))
    .limit(1);
  if (!org?.organizacaoId) return NextResponse.json({ error: 'casa sem empresa' }, { status: 400 });

  const novo = await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(schema.permutaContrato)
      .values({
        organizacaoId: org.organizacaoId,
        parceiroNome: d.parceiroNome,
        documento: doc,
        contato: d.contato || null,
        telefone: d.telefone?.replace(/\D/g, '') || null,
        email: d.email || null,
        valorTotal: d.valorTotal.toFixed(2),
        contrapartida: d.contrapartida || null,
        dataInicio: d.dataInicio || null,
        dataFim: d.dataFim || null,
        observacao: d.observacao || null,
        arquivoPath: d.arquivoPath || null,
        arquivoNome: d.arquivoNome || null,
        criadoPor: user.email ?? user.id,
      })
      .returning({ id: schema.permutaContrato.id });
    await tx.insert(schema.permutaCredito).values(
      d.creditos.map((c) => ({ contratoId: k!.id, filialId: c.filialId, valor: c.valor.toFixed(2) })),
    );
    return k!;
  });
  // Já pede o cadastro / lança onde o parceiro existe; o resto o cron conclui.
  await processarPermutas({ contratoId: novo.id }).catch(() => {});
  return NextResponse.json({ ok: true, id: novo.id });
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('conta_receber.read');
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const k = await contratoDoUsuario(id, auth.user.id);
  if (!k?.arquivoPath) return NextResponse.json({ error: 'contrato sem arquivo' }, { status: 404 });
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_PERMUTA).createSignedUrl(k.arquivoPath, 60);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
