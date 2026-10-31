// Documentos da empresa por casa (26/10/2026) — regra em lib/empresa-documento.ts.
// POST { acao: 'upload_url', nome, tamanho } → endereço assinado pro navegador
//      mandar o arquivo direto pro bucket (Vercel não aguenta >4,5 MB)
// POST { acao: 'ler', arquivoPath, arquivoNome } → IA lê tipo/número/validade e
//      sugere a casa pelo CNPJ (não grava nada)
// POST { acao: 'criar', filialId, tipo, ..., substituiId? } → grava; com
//      substituiId é renovação (o antigo fica no histórico, não apaga)
// POST { acao: 'cancelar', id, motivo } — só marca
// GET  ?id=<documento> → redireciona pro arquivo (endereço assinado de 1 minuto)
// Ver = 'configuracao.read'; subir/editar = 'configuracao.editar'.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
// E.B. e Lelis só pro Admin; pros outros = filiaisDoUsuario de sempre.
import { filiaisDoFinanceiro as filiaisDoUsuario } from '@/lib/eb/acesso-financeiro';
import {
  BUCKET_DOC_EMPRESA,
  DOC_EMPRESA_EXTENSOES,
  DOC_EMPRESA_TAMANHO_MAX,
  lerDocEmpresa,
  tipoDocValido,
} from '@/lib/empresa-documento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const Ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('upload_url'), nome: z.string().trim().min(1).max(200), tamanho: z.number().positive() }),
  z.object({ acao: z.literal('ler'), arquivoPath: z.string().min(1).max(500), arquivoNome: z.string().max(200) }),
  z.object({
    acao: z.literal('criar'),
    filialId: z.string().uuid(),
    tipo: z.string().min(1).max(40),
    titulo: z.string().trim().max(300).nullable().optional(),
    numero: z.string().trim().max(80).nullable().optional(),
    orgao: z.string().trim().max(300).nullable().optional(),
    cnpj: z.string().trim().max(20).nullable().optional(),
    emissao: Ymd,
    validade: Ymd,
    semVencimento: z.boolean(),
    observacao: z.string().trim().max(1000).nullable().optional(),
    arquivoPath: z.string().min(1).max(500),
    arquivoNome: z.string().max(200).nullable().optional(),
    dados: z.record(z.string(), z.unknown()).nullable().optional(),
    substituiId: z.string().uuid().nullable().optional(),
  }),
  z.object({ acao: z.literal('cancelar'), id: z.string().uuid(), motivo: z.string().trim().min(3).max(500) }),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pastaDoUsuario = (userId: string) => `empresa-documentos/${userId}/`;
const extensao = (nome: string) => nome.toLowerCase().split('.').pop() ?? '';

export async function POST(req: Request) {
  const auth = await exigirPermApi('configuracao.read');
  if (auth.error) return auth.error;
  const user = auth.user;
  const semPerm = await negarSemPerm(user.id, 'configuracao.editar');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const filiais = await filiaisDoUsuario(user.id);
  const t = schema.empresaDocumento;

  if (d.acao === 'upload_url') {
    if (!DOC_EMPRESA_EXTENSOES.includes(extensao(d.nome))) {
      return NextResponse.json({ error: 'envie PDF ou foto (JPG, PNG)' }, { status: 400 });
    }
    if (d.tamanho > DOC_EMPRESA_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 25 MB' }, { status: 413 });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = d.nome.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pastaDoUsuario(user.id)}${ts}-${safe}`;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_DOC_EMPRESA).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.json({ bucket: BUCKET_DOC_EMPRESA, path: data.path, token: data.token });
  }

  if (d.acao === 'ler') {
    if (!d.arquivoPath.startsWith(pastaDoUsuario(user.id))) {
      return NextResponse.json({ error: 'arquivo de outro usuário' }, { status: 400 });
    }
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_DOC_EMPRESA).download(d.arquivoPath);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'arquivo não encontrado'}` }, { status: 404 });
    try {
      const lido = await lerDocEmpresa(new Uint8Array(await data.arrayBuffer()), d.arquivoNome);
      const casa = lido.cnpj ? filiais.find((f) => f.cnpj.replace(/\D/g, '') === lido.cnpj) : undefined;
      // CNPJ de outra unidade da mesma raiz: avisa, não escolhe sozinho.
      const mesmaRaiz = !casa && lido.cnpj ? filiais.filter((f) => f.cnpj.replace(/\D/g, '').slice(0, 8) === lido.cnpj!.slice(0, 8)) : [];
      return NextResponse.json({ ok: true, lido, filialId: casa?.id ?? null, casasMesmaRaiz: mesmaRaiz.map((f) => f.id) });
    } catch (e) {
      return NextResponse.json({ error: `não consegui ler: ${(e as Error).message}` }, { status: 502 });
    }
  }

  if (d.acao === 'cancelar') {
    const [a] = await db
      .select({ filialId: t.filialId })
      .from(t)
      .where(and(eq(t.id, d.id), isNull(t.canceladoEm)))
      .limit(1);
    if (!a) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
    if (!filiais.some((f) => f.id === a.filialId)) return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
    await db.update(t).set({ canceladoEm: new Date(), canceladoPor: user.id, canceladoMotivo: d.motivo }).where(eq(t.id, d.id));
    return NextResponse.json({ ok: true });
  }

  // criar
  if (!filiais.some((f) => f.id === d.filialId)) return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  if (!tipoDocValido(d.tipo)) return NextResponse.json({ error: 'tipo de documento inválido' }, { status: 400 });
  if (!d.arquivoPath.startsWith(pastaDoUsuario(user.id))) {
    return NextResponse.json({ error: 'arquivo de outro usuário' }, { status: 400 });
  }
  if (!d.semVencimento && !d.validade) {
    return NextResponse.json({ error: 'informe a validade ou marque "sem vencimento"' }, { status: 400 });
  }
  if (d.substituiId) {
    const [antigo] = await db
      .select({ filialId: t.filialId, substituidoPor: t.substituidoPor })
      .from(t)
      .where(and(eq(t.id, d.substituiId), isNull(t.canceladoEm)))
      .limit(1);
    if (!antigo) return NextResponse.json({ error: 'documento a renovar não encontrado' }, { status: 404 });
    if (antigo.filialId !== d.filialId) return NextResponse.json({ error: 'a renovação tem que ser da mesma casa' }, { status: 400 });
    if (antigo.substituidoPor) return NextResponse.json({ error: 'esse documento já foi renovado' }, { status: 409 });
  }
  const cnpj = d.cnpj?.replace(/\D/g, '') || null;
  const criado = await db.transaction(async (tx) => {
    const [novo] = await tx
      .insert(t)
      .values({
        filialId: d.filialId,
        tipo: d.tipo,
        titulo: d.titulo || null,
        numero: d.numero || null,
        orgao: d.orgao || null,
        cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
        emissao: d.emissao || null,
        validade: d.semVencimento ? null : d.validade || null,
        semVencimento: d.semVencimento,
        observacao: d.observacao || null,
        arquivoPath: d.arquivoPath,
        arquivoNome: d.arquivoNome || null,
        dados: d.dados ?? null,
        usuarioId: user.id,
      })
      .returning({ id: t.id });
    if (d.substituiId && novo) {
      await tx.update(t).set({ substituidoPor: novo.id, substituidoEm: new Date() }).where(eq(t.id, d.substituiId));
    }
    return novo;
  });
  return NextResponse.json({ ok: true, id: criado?.id });
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('configuracao.read');
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const t = schema.empresaDocumento;
  const [a] = await db.select({ filialId: t.filialId, arquivoPath: t.arquivoPath }).from(t).where(eq(t.id, id)).limit(1);
  if (!a) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === a.filialId)) return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_DOC_EMPRESA).createSignedUrl(a.arquivoPath, 60);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
