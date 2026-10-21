// Atestado médico (21/10/2026) — lib/rh/atestado.ts explica a regra.
// POST { acao: 'upload_url', funcionarioId, nome, tamanho } → endereço assinado
//      pro navegador mandar a foto direto pro bucket (Vercel não aguenta >4,5 MB)
// POST { acao: 'criar', funcionarioId, dataInicio, dataFim, descricao?, arquivoPath?, arquivoNome? }
// POST { acao: 'cancelar', id, motivo } — só marca, não apaga
// GET  ?id=<atestado> → redireciona pra foto (endereço assinado de 1 minuto)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import { somarDias } from '@/lib/rh/dia-operacional';
import {
  ATESTADO_EXTENSOES,
  ATESTADO_MAX_DIAS,
  ATESTADO_TAMANHO_MAX,
  BUCKET_ATESTADO,
  extensaoAtestado,
  pastaAtestado,
} from '@/lib/rh/atestado';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('upload_url'),
    funcionarioId: z.string().uuid(),
    nome: z.string().trim().min(1).max(200),
    tamanho: z.number().positive(),
  }),
  z.object({
    acao: z.literal('criar'),
    funcionarioId: z.string().uuid(),
    dataInicio: Dia,
    dataFim: Dia,
    descricao: z.string().trim().max(500).optional(),
    arquivoPath: z.string().max(500).optional(),
    arquivoNome: z.string().max(200).optional(),
  }),
  z.object({
    acao: z.literal('cancelar'),
    id: z.string().uuid(),
    motivo: z.string().trim().min(5).max(500),
  }),
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Casa da pessoa, se o usuário enxerga essa casa. */
async function casaDaPessoa(userId: string, funcionarioId: string): Promise<string | NextResponse> {
  const [func] = await db
    .select({ filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, funcionarioId))
    .limit(1);
  if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === func.filialId)) {
    return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
  }
  return func.filialId;
}

export async function POST(req: Request) {
  const auth = await exigirPermApi('ponto.corrigir');
  if (auth.error) return auth.error;
  const user = auth.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (d.acao === 'cancelar') {
    const t = schema.funcionarioAtestado;
    const [a] = await db
      .select({ funcionarioId: t.funcionarioId })
      .from(t)
      .where(and(eq(t.id, d.id), isNull(t.canceladoEm)))
      .limit(1);
    if (!a) return NextResponse.json({ error: 'atestado não encontrado' }, { status: 404 });
    const casa = await casaDaPessoa(user.id, a.funcionarioId);
    if (casa instanceof NextResponse) return casa;
    await db
      .update(t)
      .set({ canceladoEm: new Date(), canceladoPor: user.id, canceladoMotivo: d.motivo })
      .where(eq(t.id, d.id));
    return NextResponse.json({ ok: true });
  }

  const casa = await casaDaPessoa(user.id, d.funcionarioId);
  if (casa instanceof NextResponse) return casa;

  if (d.acao === 'upload_url') {
    if (!ATESTADO_EXTENSOES.includes(extensaoAtestado(d.nome))) {
      return NextResponse.json({ error: 'envie foto (JPG, PNG, HEIC) ou PDF' }, { status: 400 });
    }
    if (d.tamanho > ATESTADO_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 20 MB' }, { status: 413 });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = d.nome.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pastaAtestado(casa)}/${ts}-${safe}`;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_ATESTADO).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.json({ bucket: BUCKET_ATESTADO, path: data.path, token: data.token });
  }

  // criar
  if (d.dataFim < d.dataInicio) return NextResponse.json({ error: 'o último dia é antes do primeiro' }, { status: 400 });
  if (d.dataFim > somarDias(d.dataInicio, ATESTADO_MAX_DIAS - 1)) {
    return NextResponse.json({ error: `no máximo ${ATESTADO_MAX_DIAS} dias por atestado` }, { status: 400 });
  }
  if (d.dataInicio > somarDias(hojeBr(), 30)) {
    return NextResponse.json({ error: 'atestado começa mais de 30 dias no futuro' }, { status: 400 });
  }
  if (d.arquivoPath && !d.arquivoPath.startsWith(`${pastaAtestado(casa)}/`)) {
    return NextResponse.json({ error: 'arquivo de outra casa' }, { status: 400 });
  }
  const [criado] = await db
    .insert(schema.funcionarioAtestado)
    .values({
      funcionarioId: d.funcionarioId,
      filialId: casa,
      dataInicio: d.dataInicio,
      dataFim: d.dataFim,
      descricao: d.descricao || null,
      arquivoPath: d.arquivoPath || null,
      arquivoNome: d.arquivoNome || null,
      usuarioId: user.id,
    })
    .returning({ id: schema.funcionarioAtestado.id });
  return NextResponse.json({ ok: true, id: criado?.id });
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('ponto.read');
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const t = schema.funcionarioAtestado;
  const [a] = await db
    .select({ funcionarioId: t.funcionarioId, arquivoPath: t.arquivoPath })
    .from(t)
    .where(eq(t.id, id))
    .limit(1);
  if (!a || !a.arquivoPath) return NextResponse.json({ error: 'atestado sem foto' }, { status: 404 });
  const casa = await casaDaPessoa(auth.user.id, a.funcionarioId);
  if (casa instanceof NextResponse) return casa;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_ATESTADO).createSignedUrl(a.arquivoPath, 60);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
