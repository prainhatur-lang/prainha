// Transferência entre setores pelo TABLET da loja (vendas-local /transferencia).
// Mesma tabela e mesma regra da tela /estoque/locais (lib/estoque-local.ts):
// só muda ONDE o produto está, não mexe no saldo da casa.
//
// Quem chama é o vendas-local, assinado com o HMAC dos canais loja↔nuvem
// (escopo 'estoque-setor'). Quem está no tablet entrou com login + PIN da loja;
// o nome vem em `lancou` e fica em criado_por_email como "loja: <nome>".
//
//   GET  ?f&e&s → { ok, locais, produtos: [{ id, nome, unidade, porLocal }],
//                   pessoas: [{ id, nome }], recentes: [...] }
//   POST { f, e, s, produtoId, quantidade, origemId, destinoId,
//          funcionarioId? | pessoaNome?, observacao?, foto (data:image/...;base64),
//          lancou } → { ok, id, aviso }
//
// Toque duplo / reenvio: a mesma transferência (produto, qtd, origem, destino,
// pessoa) nos últimos 2 min devolve a que já existe em vez de duplicar.

import { NextResponse } from 'next/server';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_TRANSF_LOCAL, locaisDaFilial, saldoDoProdutoPorLocal, saldosPorLocal } from '@/lib/estoque-local';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ESCOPO = 'estoque-setor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOTO = 6 * 1024 * 1024;

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autoriza(f: string, e: number, s: string): NextResponse | null {
  if (!UUID.test(f) || !Number.isFinite(e)) return NextResponse.json({ ok: false, erro: 'parâmetros' }, { status: 400 });
  if (e * 1000 < Date.now()) return NextResponse.json({ ok: false, erro: 'assinatura vencida' }, { status: 403 });
  if (!confere([f, ESCOPO, String(e)], s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const u = new URL(request.url);
  const f = u.searchParams.get('f') ?? '';
  const nega = autoriza(f, Number(u.searchParams.get('e')), u.searchParams.get('s') ?? '');
  if (nega) return nega;

  const locais = await locaisDaFilial(f);
  const saldos = await saldosPorLocal(f, locais);
  const produtos = saldos
    .map((p) => ({ id: p.produtoId, nome: p.nome, unidade: p.unidade, porLocal: p.porLocal }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const pessoas = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, f), eq(schema.funcionario.ativo, true)))
    .orderBy(schema.funcionario.nome);

  // Últimas 36 h, pra quem está no tablet ver o que já foi.
  const desde = new Date(Date.now() - 36 * 3600 * 1000);
  const hist = await db
    .select({
      id: schema.estoqueTransferenciaLocal.id,
      produtoId: schema.estoqueTransferenciaLocal.produtoId,
      quantidade: schema.estoqueTransferenciaLocal.quantidade,
      unidade: schema.estoqueTransferenciaLocal.unidade,
      origemId: schema.estoqueTransferenciaLocal.localOrigemId,
      destinoId: schema.estoqueTransferenciaLocal.localDestinoId,
      pessoaNome: schema.estoqueTransferenciaLocal.pessoaNome,
      dataHora: schema.estoqueTransferenciaLocal.dataHora,
      canceladaEm: schema.estoqueTransferenciaLocal.canceladaEm,
    })
    .from(schema.estoqueTransferenciaLocal)
    .where(and(eq(schema.estoqueTransferenciaLocal.filialId, f), gte(schema.estoqueTransferenciaLocal.dataHora, desde)))
    .orderBy(desc(schema.estoqueTransferenciaLocal.dataHora))
    .limit(60);
  const nomeProd = new Map(produtos.map((p) => [p.id, p.nome]));
  const faltam = [...new Set(hist.map((h) => h.produtoId))].filter((id) => !nomeProd.has(id));
  if (faltam.length) {
    const extra = await db
      .select({ id: schema.produto.id, nome: schema.produto.nome })
      .from(schema.produto)
      .where(inArray(schema.produto.id, faltam));
    for (const p of extra) nomeProd.set(p.id, p.nome ?? '(produto)');
  }
  const nomeLocal = new Map(locais.map((l) => [l.id, l.nome]));
  const recentes = hist.map((h) => ({
    id: h.id,
    produto: nomeProd.get(h.produtoId) ?? '(produto)',
    quantidade: Number(h.quantidade),
    unidade: h.unidade ?? '',
    origem: nomeLocal.get(h.origemId) ?? '?',
    destino: nomeLocal.get(h.destinoId) ?? '?',
    pessoa: h.pessoaNome,
    quando: h.dataHora.toISOString(),
    cancelada: Boolean(h.canceladaEm),
  }));

  return NextResponse.json({
    ok: true,
    locais: locais.filter((l) => l.ativo).map((l) => ({ id: l.id, nome: l.nome, principal: l.principal })),
    produtos,
    pessoas,
    recentes,
  });
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const f = String(b.f ?? '');
  const nega = autoriza(f, Number(b.e), String(b.s ?? ''));
  if (nega) return nega;

  const s = (k: string) => String(b[k] ?? '').trim();
  const produtoId = s('produtoId');
  const origemId = s('origemId');
  const destinoId = s('destinoId');
  const funcionarioId = s('funcionarioId') || null;
  let pessoaNome = s('pessoaNome');
  const observacao = s('observacao').slice(0, 500) || null;
  const lancou = s('lancou').slice(0, 100) || 'tablet';
  const quantidade = Number(s('quantidade').replace(',', '.'));

  if (![produtoId, origemId, destinoId].every((x) => UUID.test(x))) {
    return NextResponse.json({ ok: false, erro: 'Escolha produto, origem e destino' });
  }
  if (!Number.isFinite(quantidade) || quantidade <= 0) return NextResponse.json({ ok: false, erro: 'Quantidade inválida' });
  if (origemId === destinoId) return NextResponse.json({ ok: false, erro: 'Origem e destino iguais' });

  // Foto: data URL base64 (o tablet tira e reduz antes de mandar).
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s('foto'));
  if (!m) return NextResponse.json({ ok: false, erro: 'Tire a foto de quem está levando' });
  const bytes = Buffer.from(m[3]!, 'base64');
  if (bytes.length < 1000) return NextResponse.json({ ok: false, erro: 'Foto vazia — tire de novo' });
  if (bytes.length > MAX_FOTO) return NextResponse.json({ ok: false, erro: 'Foto grande demais' });

  const locais = await locaisDaFilial(f);
  const origem = locais.find((l) => l.id === origemId);
  const destino = locais.find((l) => l.id === destinoId);
  if (!origem || !destino) return NextResponse.json({ ok: false, erro: 'Setor não é desta casa' });
  if (!destino.ativo) return NextResponse.json({ ok: false, erro: `Setor ${destino.nome} está desativado` });

  const [prod] = await db
    .select({ id: schema.produto.id, unidade: schema.produto.unidadeEstoque, nome: schema.produto.nome })
    .from(schema.produto)
    .where(and(eq(schema.produto.id, produtoId), eq(schema.produto.filialId, f)))
    .limit(1);
  if (!prod) return NextResponse.json({ ok: false, erro: 'Produto não é desta casa' });

  if (funcionarioId) {
    if (!UUID.test(funcionarioId)) return NextResponse.json({ ok: false, erro: 'pessoa inválida' });
    const [fu] = await db
      .select({ nome: schema.funcionario.nome })
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.id, funcionarioId), eq(schema.funcionario.filialId, f)))
      .limit(1);
    if (!fu) return NextResponse.json({ ok: false, erro: 'pessoa não encontrada' });
    pessoaNome = fu.nome;
  }
  if (pessoaNome.length < 2) return NextResponse.json({ ok: false, erro: 'Diga quem está levando' });
  pessoaNome = pessoaNome.slice(0, 200);

  // Toque duplo / reenvio da loja: não duplica.
  const [igual] = await db
    .select({ id: schema.estoqueTransferenciaLocal.id })
    .from(schema.estoqueTransferenciaLocal)
    .where(
      and(
        eq(schema.estoqueTransferenciaLocal.filialId, f),
        eq(schema.estoqueTransferenciaLocal.produtoId, produtoId),
        eq(schema.estoqueTransferenciaLocal.localOrigemId, origemId),
        eq(schema.estoqueTransferenciaLocal.localDestinoId, destinoId),
        eq(schema.estoqueTransferenciaLocal.pessoaNome, pessoaNome),
        sql`${schema.estoqueTransferenciaLocal.quantidade} = ${String(quantidade)}::numeric`,
        gte(schema.estoqueTransferenciaLocal.dataHora, new Date(Date.now() - 2 * 60 * 1000)),
        isNull(schema.estoqueTransferenciaLocal.canceladaEm),
      ),
    )
    .limit(1);
  if (igual) return NextResponse.json({ ok: true, id: igual.id, repetida: true, aviso: null });

  const saldo = await saldoDoProdutoPorLocal(f, produtoId);
  const naOrigem = saldo[origemId] ?? 0;

  const supa = await createAdminClient();
  const ext = m[2] === 'png' ? 'png' : m[2] === 'webp' ? 'webp' : 'jpg';
  const path = `${f}/${hojeBr().slice(0, 7)}/${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  const subir = () => supa.storage.from(BUCKET_TRANSF_LOCAL).upload(path, bytes, { contentType: m[1]!, upsert: false });
  let up = await subir();
  if (up.error && /bucket/i.test(up.error.message)) {
    await supa.storage.createBucket(BUCKET_TRANSF_LOCAL, { public: false });
    up = await subir();
  }
  if (up.error) return NextResponse.json({ ok: false, erro: `Não consegui salvar a foto: ${up.error.message}` });

  const [nova] = await db
    .insert(schema.estoqueTransferenciaLocal)
    .values({
      filialId: f,
      produtoId,
      quantidade: String(quantidade),
      unidade: prod.unidade,
      localOrigemId: origemId,
      localDestinoId: destinoId,
      funcionarioId,
      pessoaNome,
      fotoPath: path,
      observacao,
      criadoPor: null,
      criadoPorEmail: `loja: ${lancou}`,
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
