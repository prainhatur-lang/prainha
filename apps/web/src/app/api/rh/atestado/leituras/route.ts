// Fotos de atestado que o celular mandou pelo QR (painel do Banco de horas).
// GET  ?filialId&e → leituras desse QR + pessoas da casa
// GET  ?filialId&foto=<leitura> → abre a foto (endereço assinado de 1 minuto)
// POST { acao: 'confirmar', filialId, leituraId, funcionarioId, dataInicio, dataFim, abona }
// POST { acao: 'descartar', filialId, leituraId }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { BUCKET_ATESTADO } from '@/lib/rh/atestado';
import { filiaisDoUsuario } from '@/lib/filiais';
import { confirmarLeitura, descartarLeitura, leiturasDoLink, pessoasDaCasa } from '@/lib/rh/atestado-ler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('confirmar'),
    filialId: z.string().uuid(),
    leituraId: z.string().uuid(),
    funcionarioId: z.string().uuid(),
    dataInicio: Dia,
    dataFim: Dia,
    abona: z.boolean(),
  }),
  z.object({ acao: z.literal('descartar'), filialId: z.string().uuid(), leituraId: z.string().uuid() }),
]);

async function temCasa(userId: string, filialId: string) {
  return (await filiaisDoUsuario(userId)).some((f) => f.id === filialId);
}

export async function GET(req: Request) {
  const auth = await exigirPermApi('ponto.corrigir');
  if (auth.error) return auth.error;
  const sp = new URL(req.url).searchParams;
  const filialId = sp.get('filialId') ?? '';
  const foto = sp.get('foto') ?? '';
  const e = Number(sp.get('e'));
  if (!/^[0-9a-f-]{36}$/i.test(filialId) || (!foto && !Number.isInteger(e))) {
    return NextResponse.json({ error: 'parâmetros inválidos' }, { status: 400 });
  }
  if (!(await temCasa(auth.user.id, filialId))) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  if (foto) {
    if (!/^[0-9a-f-]{36}$/i.test(foto)) return NextResponse.json({ error: 'foto inválida' }, { status: 400 });
    const L = schema.atestadoLeitura;
    const [l] = await db
      .select({ path: L.arquivoPath })
      .from(L)
      .where(and(eq(L.id, foto), eq(L.filialId, filialId)))
      .limit(1);
    if (!l) return NextResponse.json({ error: 'foto não encontrada' }, { status: 404 });
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_ATESTADO).createSignedUrl(l.path, 60);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.redirect(data.signedUrl);
  }
  const [leituras, pessoas] = await Promise.all([leiturasDoLink(filialId, e), pessoasDaCasa(filialId)]);
  return NextResponse.json({ leituras, pessoas: pessoas.map(({ id, nome, cargo }) => ({ id, nome, cargo })) });
}

export async function POST(req: Request) {
  const auth = await exigirPermApi('ponto.corrigir');
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;
  if (!(await temCasa(auth.user.id, d.filialId))) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  if (d.acao === 'descartar') return NextResponse.json({ ok: await descartarLeitura(d.leituraId, d.filialId) });
  const r = await confirmarLeitura({
    leituraId: d.leituraId,
    filialId: d.filialId,
    usuarioId: auth.user.id,
    funcionarioId: d.funcionarioId,
    dataInicio: d.dataInicio,
    dataFim: d.dataFim,
    abona: d.abona,
  });
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
}
