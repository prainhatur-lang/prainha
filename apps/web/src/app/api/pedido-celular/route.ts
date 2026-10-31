// Pedido sem nota pelo celular — rota PÚBLICA da página /pedido-celular.
// Sem login: o link do QR é assinado (lib/pedido-celular-link.ts) e a cada
// chamada confere que quem gerou o QR ainda tem acesso à casa.
// O celular só guarda as fotos; quem lê o pedido é o computador que mostrou o
// QR (pela rota de sempre, com o login de quem está lá).
// POST { f,u,k,e,s, acao: 'upload_url', grupo, n, tipo } → endereço pra subir a foto n do pedido
// POST { f,u,k,e,s, acao: 'pronto', grupo }               → pedido completo, o computador pode pegar

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { pastaPedidoCelular, validarLinkPedidoCelular } from '@/lib/pedido-celular-link';
import { BUCKET_PEDIDO, MARCA_PRONTO, MARCAS_PRONTO } from '@/lib/pedido-sem-nota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Link = { f: z.string(), u: z.string(), k: z.string(), e: z.coerce.number(), s: z.string() };
const Grupo = z.string().regex(/^[a-z0-9]{8,32}$/);

const Body = z.discriminatedUnion('acao', [
  z.object({
    ...Link,
    acao: z.literal('upload_url'),
    grupo: Grupo,
    n: z.number().int().min(1).max(10),
    tipo: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  }),
  z.object({ ...Link, acao: z.literal('pronto'), grupo: Grupo }),
]);

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// A marca de "pedido pronto" é um PNG de 1 pixel: o balde producao-fotos só aceita
// imagem/PDF e recusava o pronto.json ("mime type application/json is not supported").
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;
  const link = validarLinkPedidoCelular(d.f, d.u, d.k, d.e, d.s);
  if (!link) return NextResponse.json({ error: 'link vencido — gere outro QR no computador' }, { status: 401 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, link.usuarioId), eq(schema.usuarioFilial.filialId, link.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'quem gerou o QR não tem mais acesso a essa casa' }, { status: 403 });

  const pasta = `${pastaPedidoCelular(link.filialId, link.sessao)}/${d.grupo}`;
  const admin = await createAdminClient();

  if (d.acao === 'upload_url') {
    const path = `${pasta}/${String(d.n).padStart(2, '0')}.${EXT[d.tipo]}`;
    const { data, error } = await admin.storage.from(BUCKET_PEDIDO).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? 'sem resposta'}` }, { status: 500 });
    return NextResponse.json({ bucket: BUCKET_PEDIDO, path: data.path, token: data.token });
  }

  // pronto: marca por último — o computador só pega pedido com a marca
  const { data: arquivos } = await admin.storage.from(BUCKET_PEDIDO).list(pasta, { limit: 20 });
  const fotos = (arquivos ?? []).filter((a) => a.id && !MARCAS_PRONTO.includes(a.name));
  if (!fotos.length) return NextResponse.json({ error: 'nenhuma foto chegou — tente de novo' }, { status: 400 });
  const up = await admin.storage
    .from(BUCKET_PEDIDO)
    .upload(`${pasta}/${MARCA_PRONTO}`, PNG_1PX, { contentType: 'image/png', upsert: true });
  if (up.error) return NextResponse.json({ error: `storage: ${up.error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, fotos: fotos.length });
}
