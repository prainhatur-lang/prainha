// Permutas / parcerias comerciais (31/10/2026) — regra em lib/permuta.ts.
// POST { acao: 'upload_url', nome, tamanho } → endereço assinado pro navegador
//      mandar o contrato direto pro bucket
// POST { acao: 'criar', parceiro..., valorTotal, creditos: [{filialId, valor}] }
//      → grava o contrato e já pede cadastro/lança o crédito em cada casa
// POST { acao: 'ler', arquivos: [{path, nome}] } → IA lê as fotos/PDF do contrato
//      (todas juntas) e devolve o formulário preenchido (04/11/2026)
//      'criar' aceita tipo 'credito' (padrão, igual a antes) | 'receber' (débito
//      a prazo no fiado do parceiro) | 'pagar' (conta a pagar por parcela, exige
//      conta_pagar.create), vários arquivos e as parcelas.
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
import { BUCKET_PERMUTA, PERMUTA_EXTENSOES, PERMUTA_TAMANHO_MAX, lancarContasPagar, liberacoesDaCasa, processarPermutas } from '@/lib/permuta';
import { hojeBr } from '@/lib/datas';
import { lerContratoPermuta } from '@/lib/permuta-ler';
import { podeUsuario } from '@/lib/permissoes-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

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
    tipo: z.enum(['credito', 'receber', 'pagar']).optional(),
    arquivos: z.array(z.object({ path: z.string().min(1).max(500), nome: z.string().trim().min(1).max(200) })).max(20).optional(),
    vencimentos: z
      .array(z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.number().positive() }))
      .max(120)
      .optional(),
    creditos: z.array(z.object({ filialId: z.string().uuid(), valor: z.number().positive() })).min(1).max(10),
    /** Crédito liberado mês a mês (só tipo 'credito'); vazio = tudo de uma vez. */
    liberacaoMeses: z.number().int().min(2).max(60).nullable().optional(),
    liberacaoInicio: Ymd,
  }),
  z.object({
    acao: z.literal('ler'),
    arquivos: z.array(z.object({ path: z.string().min(1).max(500), nome: z.string().trim().min(1).max(200) })).min(1).max(20),
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

  if (d.acao === 'ler') {
    if (d.arquivos.some((a) => !a.path.startsWith(pastaDoUsuario(user.id)))) {
      return NextResponse.json({ error: 'arquivo de outro usuário' }, { status: 400 });
    }
    const admin = await createAdminClient();
    const baixados: Array<{ bytes: Uint8Array; nome: string }> = [];
    for (const a of d.arquivos) {
      const { data, error } = await admin.storage.from(BUCKET_PERMUTA).download(a.path);
      if (error || !data) return NextResponse.json({ error: `não abri ${a.nome}: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
      baixados.push({ bytes: new Uint8Array(await data.arrayBuffer()), nome: a.nome });
    }
    const filiais = await filiaisDoUsuario(user.id);
    try {
      const lido = await lerContratoPermuta(
        baixados,
        filiais.map((f) => ({ id: f.id, nome: f.nome, cnpj: f.cnpj ?? null })),
      );
      return NextResponse.json({ ok: true, lido });
    } catch (e) {
      return NextResponse.json({ error: `leitura: ${(e as Error).message}` }, { status: 502 });
    }
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
      // Liberação mensal que ainda não saiu também não sai mais (a que já saiu fica).
      await tx
        .update(schema.permutaLiberacao)
        .set({ status: 'cancelada' })
        .where(and(eq(schema.permutaLiberacao.contratoId, k.id), eq(schema.permutaLiberacao.status, 'agendada')));
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
  const tipo = d.tipo ?? 'credito';
  const arquivos = d.arquivos ?? [];
  if (arquivos.some((a) => !a.path.startsWith(pastaDoUsuario(user.id)))) {
    return NextResponse.json({ error: 'arquivo de outro usuário' }, { status: 400 });
  }
  if (tipo === 'pagar' && !(await podeUsuario(user.id, 'conta_pagar.create'))) {
    return NextResponse.json({ error: 'sem permissão pra lançar conta a pagar' }, { status: 403 });
  }
  const vencimentos = tipo === 'credito' ? [] : (d.vencimentos ?? []);
  if (vencimentos.length) {
    const somaV = vencimentos.reduce((s, v) => s + centavos(v.valor), 0);
    if (somaV !== centavos(d.valorTotal)) {
      return NextResponse.json({ error: `as parcelas (R$ ${(somaV / 100).toFixed(2)}) não fecham com o valor do contrato` }, { status: 400 });
    }
  }
  // Liberação mensal: só no crédito de consumo. Cada casa precisa dar ao menos 1 centavo por mês.
  const meses = tipo === 'credito' && d.liberacaoMeses ? d.liberacaoMeses : null;
  const liberacaoInicio = meses ? d.liberacaoInicio || hojeBr() : null;
  if (meses && d.creditos.some((c) => centavos(c.valor) < meses)) {
    return NextResponse.json({ error: 'valor da casa pequeno demais pra dividir nesses meses' }, { status: 400 });
  }
  const primeiro = arquivos[0];
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
        arquivoPath: d.arquivoPath || primeiro?.path || null,
        arquivoNome: d.arquivoNome || primeiro?.nome || null,
        tipo,
        arquivos: arquivos.length ? arquivos : null,
        vencimentos: vencimentos.length ? vencimentos : null,
        liberacaoMeses: meses,
        liberacaoInicio,
        criadoPor: user.email ?? user.id,
      })
      .returning({ id: schema.permutaContrato.id });
    const creds = await tx
      .insert(schema.permutaCredito)
      .values(d.creditos.map((c) => ({ contratoId: k!.id, filialId: c.filialId, valor: c.valor.toFixed(2) })))
      .returning({ id: schema.permutaCredito.id, filialId: schema.permutaCredito.filialId, valor: schema.permutaCredito.valor });
    if (meses && liberacaoInicio) {
      await tx.insert(schema.permutaLiberacao).values(
        creds.flatMap((c) =>
          liberacoesDaCasa(Number(c.valor), meses, liberacaoInicio).map((l) => ({
            creditoId: c.id,
            contratoId: k!.id,
            filialId: c.filialId,
            numero: l.numero,
            data: l.data,
            valor: l.valor.toFixed(2),
          })),
        ),
      );
    }
    return k!;
  });
  if (tipo === 'pagar') {
    // Conta a pagar sai na hora, com quem lançou; se falhar, o cron tenta de novo.
    const [k] = await db.select().from(schema.permutaContrato).where(eq(schema.permutaContrato.id, novo.id)).limit(1);
    const creds = await db.select().from(schema.permutaCredito).where(eq(schema.permutaCredito.contratoId, novo.id));
    for (const c of creds) {
      await lancarContasPagar(k!, c, user.id).catch(async (e) => {
        await db
          .update(schema.permutaCredito)
          .set({ status: 'erro', erro: String((e as Error).message ?? e).slice(0, 300) })
          .where(eq(schema.permutaCredito.id, c.id));
      });
    }
    return NextResponse.json({ ok: true, id: novo.id });
  }
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
  // ?n=<índice> abre o n-ésimo arquivo do contrato (várias fotos).
  const n = Number(new URL(req.url).searchParams.get('n') ?? '');
  const caminho = Number.isInteger(n) && k.arquivos?.[n] ? k.arquivos[n]!.path : k.arquivoPath;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_PERMUTA).createSignedUrl(caminho, 60);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
