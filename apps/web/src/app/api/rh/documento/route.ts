// Documentos de entrada e saída do funcionário (25/10/2026) — regra em
// lib/rh/documento-vinculo.ts.
// POST { acao: 'upload_url', funcionarioId, nome, tamanho } → endereço assinado
//      pro navegador mandar o arquivo direto pro bucket (Vercel não aguenta >4,5 MB)
// POST { acao: 'criar', funcionarioId, momento, tipo, arquivoPath, arquivoNome?, descricao? }
// POST { acao: 'cancelar', id, motivo } — só marca, não apaga
// GET  ?id=<documento> → redireciona pro arquivo (endereço assinado de 1 minuto)
// Entrada = 'funcionario.update'; saída = 'funcionario.desligar'; ver = 'funcionario.read'.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import {
  BUCKET_DOC_RH,
  DOC_RH_EXTENSOES,
  DOC_RH_TAMANHO_MAX,
  extensaoDoc,
  pastaDocRh,
  tipoValido,
} from '@/lib/rh/documento-vinculo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Momento = z.enum(['admissao', 'desligamento']);

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('upload_url'),
    funcionarioId: z.string().uuid(),
    momento: Momento,
    nome: z.string().trim().min(1).max(200),
    tamanho: z.number().positive(),
  }),
  z.object({
    acao: z.literal('criar'),
    funcionarioId: z.string().uuid(),
    momento: Momento,
    tipo: z.string().min(1).max(40),
    arquivoPath: z.string().min(1).max(500),
    arquivoNome: z.string().max(200).optional(),
    descricao: z.string().trim().max(500).optional(),
  }),
  z.object({
    acao: z.literal('cancelar'),
    id: z.string().uuid(),
    motivo: z.string().trim().min(3).max(500),
  }),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lotação da pessoa, se o usuário enxerga a lotação ou uma casa extra dela. */
async function casaDaPessoa(userId: string, funcionarioId: string): Promise<string | NextResponse> {
  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const extras = await db
    .select({ filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(eq(schema.funcionarioFilialExtra.funcionarioId, funcionarioId));
  const casas = [func.filialId, ...extras.map((e) => e.filialId)];
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => casas.includes(f.id))) {
    return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
  }
  return func.filialId;
}

const permDo = (m: 'admissao' | 'desligamento') => (m === 'admissao' ? 'funcionario.update' : 'funcionario.desligar');

export async function POST(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const user = auth.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (d.acao === 'cancelar') {
    const t = schema.funcionarioDocumento;
    const [a] = await db
      .select({ funcionarioId: t.funcionarioId, momento: t.momento })
      .from(t)
      .where(and(eq(t.id, d.id), isNull(t.canceladoEm)))
      .limit(1);
    if (!a) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
    const semPerm = await negarSemPerm(user.id, permDo(a.momento as 'admissao' | 'desligamento'));
    if (semPerm) return semPerm;
    const casa = await casaDaPessoa(user.id, a.funcionarioId);
    if (casa instanceof NextResponse) return casa;
    await db
      .update(t)
      .set({ canceladoEm: new Date(), canceladoPor: user.id, canceladoMotivo: d.motivo })
      .where(eq(t.id, d.id));
    return NextResponse.json({ ok: true });
  }

  const semPerm = await negarSemPerm(user.id, permDo(d.momento));
  if (semPerm) return semPerm;
  const casa = await casaDaPessoa(user.id, d.funcionarioId);
  if (casa instanceof NextResponse) return casa;

  if (d.acao === 'upload_url') {
    if (!DOC_RH_EXTENSOES.includes(extensaoDoc(d.nome))) {
      return NextResponse.json({ error: 'envie foto (JPG, PNG, HEIC) ou PDF' }, { status: 400 });
    }
    if (d.tamanho > DOC_RH_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 25 MB' }, { status: 413 });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = d.nome.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pastaDocRh(casa)}/${d.funcionarioId}/${ts}-${safe}`;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_DOC_RH).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.json({ bucket: BUCKET_DOC_RH, path: data.path, token: data.token });
  }

  // criar
  if (!tipoValido(d.momento, d.tipo)) return NextResponse.json({ error: 'tipo de documento inválido' }, { status: 400 });
  if (!d.arquivoPath.startsWith(`${pastaDocRh(casa)}/${d.funcionarioId}/`)) {
    return NextResponse.json({ error: 'arquivo de outra pessoa' }, { status: 400 });
  }
  const [criado] = await db
    .insert(schema.funcionarioDocumento)
    .values({
      funcionarioId: d.funcionarioId,
      filialId: casa,
      momento: d.momento,
      tipo: d.tipo,
      descricao: d.descricao || null,
      arquivoPath: d.arquivoPath,
      arquivoNome: d.arquivoNome || null,
      usuarioId: user.id,
    })
    .returning({ id: schema.funcionarioDocumento.id });
  return NextResponse.json({ ok: true, id: criado?.id });
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const t = schema.funcionarioDocumento;
  const [a] = await db
    .select({ funcionarioId: t.funcionarioId, arquivoPath: t.arquivoPath })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  if (!a) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
  const casa = await casaDaPessoa(auth.user.id, a.funcionarioId);
  if (casa instanceof NextResponse) return casa;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_DOC_RH).createSignedUrl(a.arquivoPath, 60);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
