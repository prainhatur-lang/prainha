// Transferência de produto entre setores da casa (Depósito → Bar, etc.).
// POST multipart: filialId, produtoId, quantidade, origemId, destinoId,
//   funcionarioId (ou pessoaNome), observacao, foto (obrigatória — foto da
//   pessoa que levou, tirada na hora).
// POST JSON { acao: 'cancelar', id, motivo } — só marca, nunca apaga.
// GET ?foto=<id> — abre a foto (link assinado do bucket privado).
// Não mexe no saldo da casa: só muda ONDE o produto está (lib/estoque-local.ts).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { exigirPermApi } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_TRANSF_LOCAL, locaisDaFilial, saldoDoProdutoPorLocal } from '@/lib/estoque-local';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FOTO = 10 * 1024 * 1024;

async function filiaisPermitidas(userId: string) {
  return new Set((await filiaisDoUsuario(userId)).map((f) => f.id));
}

export async function GET(req: Request) {
  const g = await exigirPermApi('produto.read');
  if (g.error) return g.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('foto') ?? '';
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const [t] = await db
    .select({ filialId: schema.estoqueTransferenciaLocal.filialId, fotoPath: schema.estoqueTransferenciaLocal.fotoPath })
    .from(schema.estoqueTransferenciaLocal)
    .where(eq(schema.estoqueTransferenciaLocal.id, id))
    .limit(1);
  if (!t || !(await filiaisPermitidas(g.user.id)).has(t.filialId) || !t.fotoPath) {
    return NextResponse.json({ error: 'foto não encontrada' }, { status: 404 });
  }
  const supa = await createAdminClient();
  const { data, error } = await supa.storage.from(BUCKET_TRANSF_LOCAL).createSignedUrl(t.fotoPath, 60 * 10);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'foto indisponível' }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 302);
}

const Cancelar = z.object({ acao: z.literal('cancelar'), id: z.string().uuid(), motivo: z.string().trim().min(3).max(300) });

export async function POST(req: Request) {
  const g = await exigirPermApi('produto.read');
  if (g.error) return g.error;
  const user = g.user;
  const filiais = await filiaisPermitidas(user.id);
  const ct = req.headers.get('content-type') ?? '';

  // ---- cancelar ----
  if (ct.includes('application/json')) {
    if (!(await podeUsuario(user.id, 'produto.update'))) {
      return NextResponse.json({ error: 'Sem permissão pra cancelar transferência' }, { status: 403 });
    }
    const p = Cancelar.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: 'Informe o motivo' }, { status: 400 });
    const [t] = await db
      .select({ filialId: schema.estoqueTransferenciaLocal.filialId, canceladaEm: schema.estoqueTransferenciaLocal.canceladaEm })
      .from(schema.estoqueTransferenciaLocal)
      .where(eq(schema.estoqueTransferenciaLocal.id, p.data.id))
      .limit(1);
    if (!t || !filiais.has(t.filialId)) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });
    if (t.canceladaEm) return NextResponse.json({ ok: true });
    await db
      .update(schema.estoqueTransferenciaLocal)
      .set({ canceladaEm: new Date(), canceladaPor: user.email ?? user.id, motivoCancelamento: p.data.motivo })
      .where(eq(schema.estoqueTransferenciaLocal.id, p.data.id));
    return NextResponse.json({ ok: true });
  }

  // ---- nova transferência ----
  if (!ct.includes('multipart/form-data')) return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  const form = await req.formData();
  const s = (k: string) => String(form.get(k) ?? '').trim();
  const filialId = s('filialId');
  const produtoId = s('produtoId');
  const origemId = s('origemId');
  const destinoId = s('destinoId');
  const funcionarioId = s('funcionarioId') || null;
  let pessoaNome = s('pessoaNome');
  const observacao = s('observacao') || null;
  const quantidade = Number(s('quantidade').replace(',', '.'));
  const foto = form.get('foto');

  const uuid = z.string().uuid();
  if (![filialId, produtoId, origemId, destinoId].every((x) => uuid.safeParse(x).success)) {
    return NextResponse.json({ error: 'Escolha produto, origem e destino' }, { status: 400 });
  }
  if (!filiais.has(filialId)) return NextResponse.json({ error: 'sem acesso a esta casa' }, { status: 403 });
  if (!Number.isFinite(quantidade) || quantidade <= 0) return NextResponse.json({ error: 'Quantidade inválida' }, { status: 400 });
  if (origemId === destinoId) return NextResponse.json({ error: 'Origem e destino iguais' }, { status: 400 });
  if (!(foto instanceof File) || foto.size === 0) {
    return NextResponse.json({ error: 'Tire a foto de quem está levando' }, { status: 400 });
  }
  if (foto.size > MAX_FOTO) return NextResponse.json({ error: 'Foto grande demais' }, { status: 413 });
  if (!foto.type.toLowerCase().startsWith('image/')) return NextResponse.json({ error: 'A foto tem que ser imagem' }, { status: 400 });

  const locais = await locaisDaFilial(filialId);
  const origem = locais.find((l) => l.id === origemId);
  const destino = locais.find((l) => l.id === destinoId);
  if (!origem || !destino) return NextResponse.json({ error: 'Setor não é desta casa' }, { status: 400 });
  if (!destino.ativo) return NextResponse.json({ error: `Setor ${destino.nome} está desativado` }, { status: 400 });

  const [prod] = await db
    .select({ id: schema.produto.id, unidade: schema.produto.unidadeEstoque, nome: schema.produto.nome })
    .from(schema.produto)
    .where(and(eq(schema.produto.id, produtoId), eq(schema.produto.filialId, filialId)))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'Produto não é desta casa' }, { status: 400 });

  if (funcionarioId) {
    if (!uuid.safeParse(funcionarioId).success) return NextResponse.json({ error: 'pessoa inválida' }, { status: 400 });
    const [f] = await db
      .select({ nome: schema.funcionario.nome })
      .from(schema.funcionario)
      .where(eq(schema.funcionario.id, funcionarioId))
      .limit(1);
    if (!f) return NextResponse.json({ error: 'pessoa não encontrada' }, { status: 400 });
    pessoaNome = f.nome;
  }
  if (pessoaNome.length < 2) return NextResponse.json({ error: 'Diga quem está levando' }, { status: 400 });

  // Aviso (não trava): saldo do setor de origem. O estoque do sistema nem
  // sempre bate com a prateleira, então só registra a falta na resposta.
  const saldo = await saldoDoProdutoPorLocal(filialId, produtoId);
  const naOrigem = saldo[origemId] ?? 0;

  // Foto no bucket privado.
  const supa = await createAdminClient();
  const ext = foto.type.includes('png') ? 'png' : foto.type.includes('webp') ? 'webp' : 'jpg';
  const path = `${filialId}/${hojeBr().slice(0, 7)}/${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  const bytes = Buffer.from(await foto.arrayBuffer());
  const subir = () => supa.storage.from(BUCKET_TRANSF_LOCAL).upload(path, bytes, { contentType: foto.type, upsert: false });
  let up = await subir();
  if (up.error && /bucket/i.test(up.error.message)) {
    await supa.storage.createBucket(BUCKET_TRANSF_LOCAL, { public: false });
    up = await subir();
  }
  if (up.error) return NextResponse.json({ error: `Não consegui salvar a foto: ${up.error.message}` }, { status: 500 });

  const [nova] = await db
    .insert(schema.estoqueTransferenciaLocal)
    .values({
      filialId,
      produtoId,
      quantidade: String(quantidade),
      unidade: prod.unidade,
      localOrigemId: origemId,
      localDestinoId: destinoId,
      funcionarioId,
      pessoaNome: pessoaNome.slice(0, 200),
      fotoPath: path,
      observacao,
      criadoPor: user.id,
      criadoPorEmail: user.email ?? null,
    })
    .returning({ id: schema.estoqueTransferenciaLocal.id });

  return NextResponse.json({
    ok: true,
    id: nova?.id,
    aviso:
      naOrigem < quantidade
        ? `No sistema, ${origem.nome} tinha ${naOrigem} ${prod.unidade} de ${prod.nome}. A transferência foi registrada mesmo assim.`
        : null,
  });
}
