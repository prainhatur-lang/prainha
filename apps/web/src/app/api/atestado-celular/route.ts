// Atestado pelo celular (21/10/2026) — página pública /atestado-celular.
// Sem login: o link do QR é assinado (lib/rh/atestado-link.ts) e carrega quem
// gerou; a cada chamada confere que essa pessoa ainda tem 'ponto.corrigir' na casa.
// POST { f,u,e,s, acao: 'upload_url', nome, tamanho } → endereço pra subir a foto
// POST { ..., acao: 'ler', path, nome } → IA lê, acha quem é, guarda pendente
// POST { ..., acao: 'confirmar', leituraId, funcionarioId, dataInicio, dataFim, abona }
// POST { ..., acao: 'descartar', leituraId }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { validarLinkAtestado } from '@/lib/rh/atestado-link';
import {
  ATESTADO_EXTENSOES,
  ATESTADO_TAMANHO_MAX,
  BUCKET_ATESTADO,
  extensaoAtestado,
  pastaAtestado,
} from '@/lib/rh/atestado';
import {
  confirmarLeitura,
  descartarLeitura,
  pessoasDaCasa,
  podeLancarNaCasa,
  processarFoto,
} from '@/lib/rh/atestado-ler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Link = { f: z.string(), u: z.string(), e: z.coerce.number(), s: z.string() };

const Body = z.discriminatedUnion('acao', [
  z.object({ ...Link, acao: z.literal('upload_url'), nome: z.string().trim().min(1).max(200), tamanho: z.number().positive() }),
  z.object({ ...Link, acao: z.literal('ler'), path: z.string().min(1).max(500), nome: z.string().trim().min(1).max(200) }),
  z.object({
    ...Link,
    acao: z.literal('confirmar'),
    leituraId: z.string().uuid(),
    funcionarioId: z.string().uuid(),
    dataInicio: Dia,
    dataFim: Dia,
    abona: z.boolean(),
  }),
  z.object({ ...Link, acao: z.literal('descartar'), leituraId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;
  const link = validarLinkAtestado(d.f, d.u, d.e, d.s);
  if (!link) return NextResponse.json({ error: 'link vencido — gere outro QR no computador' }, { status: 401 });
  if (!(await podeLancarNaCasa(link.usuarioId, link.filialId))) {
    return NextResponse.json({ error: 'quem gerou o QR não lança mais atestado nessa casa' }, { status: 403 });
  }

  if (d.acao === 'upload_url') {
    if (!ATESTADO_EXTENSOES.includes(extensaoAtestado(d.nome))) {
      return NextResponse.json({ error: 'envie foto (JPG, PNG) ou PDF' }, { status: 400 });
    }
    if (d.tamanho > ATESTADO_TAMANHO_MAX) return NextResponse.json({ error: 'arquivo maior que 20 MB' }, { status: 413 });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = d.nome.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${pastaAtestado(link.filialId)}/${ts}-cel-${safe}`;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_ATESTADO).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.json({ bucket: BUCKET_ATESTADO, path: data.path, token: data.token });
  }

  if (d.acao === 'ler') {
    try {
      const leitura = await processarFoto({
        filialId: link.filialId,
        usuarioId: link.usuarioId,
        linkE: link.e,
        path: d.path,
        nome: d.nome,
      });
      const pessoas = (await pessoasDaCasa(link.filialId)).map(({ id, nome, cargo }) => ({ id, nome, cargo }));
      return NextResponse.json({ ok: true, leitura, pessoas });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  if (d.acao === 'confirmar') {
    const r = await confirmarLeitura({
      leituraId: d.leituraId,
      filialId: link.filialId,
      usuarioId: link.usuarioId,
      funcionarioId: d.funcionarioId,
      dataInicio: d.dataInicio,
      dataFim: d.dataFim,
      abona: d.abona,
    });
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
  }

  const ok = await descartarLeitura(d.leituraId, link.filialId);
  return NextResponse.json({ ok });
}
