// PRODUÇÃO pelo celular do chef — loja ↔ nuvem. O chef entra com o PIN da
// loja (vendas-local /producao), escolhe um template (ou escreve à mão),
// a quantidade e o cozinheiro. A loja chama aqui assinada (escopo
// 'producao'); a OP nasce em RASCUNHO já com link público /op/<token>, e
// volta um wa.me pronto pro chef mandar pelo WhatsApp dele.
//
// GET ?f&e&s          → { templates, cozinheiros, ops (últimas 36h) }
// POST {f,e,s,...}    → cria a OP e devolve { opId, link, whatsapp }
import { NextResponse } from 'next/server';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autoriza(f: string, e: number, s: string) {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'producao', String(e)], s);
}

/** Telefone → dígitos com DDI 55 (wa.me). Vazio se não der pra usar. */
function foneWa(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '';
}

function fmtQtd(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const f = url.searchParams.get('f') ?? '';
  const e = Number(url.searchParams.get('e'));
  const s = url.searchParams.get('s') ?? '';
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });

  const { db, schema } = await import('@concilia/db');
  const { and, asc, desc, eq, exists, gte, or } = await import('drizzle-orm');

  const tpls = await db
    .select({ id: schema.templateOp.id, nome: schema.templateOp.nome, vezesUsado: schema.templateOp.vezesUsado })
    .from(schema.templateOp)
    .where(and(eq(schema.templateOp.filialId, f), eq(schema.templateOp.ativo, true)))
    .orderBy(desc(schema.templateOp.vezesUsado), asc(schema.templateOp.nome));

  // Entrada principal (a primeira) de cada template — o chef informa a qtd
  // dela e o resto escala junto.
  const entradas = tpls.length
    ? await db
        .select({
          templateId: schema.templateOpEntrada.templateId,
          qtd: schema.templateOpEntrada.quantidadePadrao,
          produto: schema.produto.nome,
          unidade: schema.produto.unidadeEstoque,
        })
        .from(schema.templateOpEntrada)
        .innerJoin(schema.templateOp, eq(schema.templateOp.id, schema.templateOpEntrada.templateId))
        .leftJoin(schema.produto, eq(schema.produto.id, schema.templateOpEntrada.produtoId))
        .where(eq(schema.templateOp.filialId, f))
        .orderBy(asc(schema.templateOpEntrada.id))
    : [];
  const principal = new Map<string, (typeof entradas)[number]>();
  for (const en of entradas) if (!principal.has(en.templateId)) principal.set(en.templateId, en);

  const pessoas = await db
    .select({ nome: schema.funcionario.nome, telefone: schema.funcionario.telefone, setor: schema.funcionario.setor })
    .from(schema.funcionario)
    .where(
      and(
        eq(schema.funcionario.ativo, true),
        or(
          eq(schema.funcionario.filialId, f),
          exists(
            db
              .select({ n: schema.funcionarioFilialExtra.id })
              .from(schema.funcionarioFilialExtra)
              .where(
                and(
                  eq(schema.funcionarioFilialExtra.funcionarioId, schema.funcionario.id),
                  eq(schema.funcionarioFilialExtra.filialId, f),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(schema.funcionario.nome));

  const ops = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      responsavel: schema.ordemProducao.responsavel,
      status: schema.ordemProducao.status,
      criadoEm: schema.ordemProducao.criadoEm,
      marcadaProntaEm: schema.ordemProducao.marcadaProntaEm,
      token: schema.ordemProducao.tokenPublico,
    })
    .from(schema.ordemProducao)
    .where(
      and(
        eq(schema.ordemProducao.filialId, f),
        gte(schema.ordemProducao.criadoEm, new Date(Date.now() - 36 * 3600 * 1000)),
      ),
    )
    .orderBy(desc(schema.ordemProducao.criadoEm))
    .limit(40);

  const base = url.origin;
  return NextResponse.json({
    ok: true,
    templates: tpls
      .filter((t) => principal.has(t.id))
      .map((t) => {
        const p = principal.get(t.id)!;
        return { id: t.id, nome: t.nome, qtd: Number(p.qtd), produto: p.produto ?? '', unidade: p.unidade ?? 'un' };
      }),
    cozinheiros: pessoas
      .filter((p) => p.setor === 'COZINHA')
      .map((p) => ({ nome: p.nome, telefone: foneWa(p.telefone) })),
    outros: pessoas
      .filter((p) => p.setor !== 'COZINHA')
      .map((p) => ({ nome: p.nome, telefone: foneWa(p.telefone) })),
    ops: ops
      .filter((o) => o.status !== 'CANCELADA')
      .map((o) => ({
        id: o.id,
        descricao: o.descricao,
        responsavel: o.responsavel,
        status: o.status,
        criadoEm: o.criadoEm,
        prontaEm: o.marcadaProntaEm,
        link: o.token ? `${base}/op/${o.token}` : null,
      })),
  });
}

const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  templateId: z.string().uuid().nullable().optional(),
  quantidade: z.number().positive().max(100000).nullable().optional(),
  texto: z.string().max(200).nullable().optional(),
  observacao: z.string().max(1000).nullable().optional(),
  cozinheiro: z.string().max(100).nullable().optional(),
  telefone: z.string().max(20).nullable().optional(),
  chef: z.string().max(100).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const b = parsed.data;
  if (!autoriza(b.f, b.e, b.s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  const f = b.f;

  const { db, schema } = await import('@concilia/db');
  const { and, eq, sql } = await import('drizzle-orm');

  const obsChef = [b.observacao?.trim(), b.chef ? `Pedido por ${b.chef.trim()} (celular)` : null]
    .filter(Boolean)
    .join('\n');
  const token = randomBytes(32).toString('base64url');
  const agora = new Date();
  let descricao: string;
  let resumo: string;
  let opId: string;

  if (b.templateId) {
    const [tpl] = await db
      .select()
      .from(schema.templateOp)
      .where(and(eq(schema.templateOp.id, b.templateId), eq(schema.templateOp.filialId, f)))
      .limit(1);
    if (!tpl || !tpl.ativo) return NextResponse.json({ ok: false, erro: 'template não encontrado' }, { status: 404 });
    const entradasTpl = await db
      .select()
      .from(schema.templateOpEntrada)
      .where(eq(schema.templateOpEntrada.templateId, tpl.id))
      .orderBy(schema.templateOpEntrada.id);
    const saidasTpl = await db
      .select()
      .from(schema.templateOpSaida)
      .where(eq(schema.templateOpSaida.templateId, tpl.id));
    if (!entradasTpl.length) return NextResponse.json({ ok: false, erro: 'template sem entradas' }, { status: 400 });

    const padrao = Number(entradasTpl[0]!.quantidadePadrao) || 1;
    const qtdPrincipal = b.quantidade ?? padrao;
    const fator = qtdPrincipal / padrao;
    const [prodPrinc] = await db
      .select({ nome: schema.produto.nome, unidade: schema.produto.unidadeEstoque })
      .from(schema.produto)
      .where(eq(schema.produto.id, entradasTpl[0]!.produtoId))
      .limit(1);
    descricao = (b.texto?.trim() || tpl.descricaoPadrao || tpl.nome).trim();
    resumo = `${descricao} — ${fmtQtd(qtdPrincipal)} ${prodPrinc?.unidade ?? ''} ${prodPrinc?.nome ?? ''}`.replace(/\s+/g, ' ').trim();

    opId = await db.transaction(async (tx) => {
      const [op] = await tx
        .insert(schema.ordemProducao)
        .values({
          filialId: f,
          descricao: descricao.slice(0, 200),
          observacao: [tpl.observacao, obsChef].filter(Boolean).join('\n') || null,
          responsavel: b.cozinheiro?.trim() || null,
          tokenPublico: token,
          enviadaEm: agora,
        })
        .returning({ id: schema.ordemProducao.id });
      for (const en of entradasTpl) {
        const [prod] = await tx
          .select({ precoCusto: schema.produto.precoCusto })
          .from(schema.produto)
          .where(eq(schema.produto.id, en.produtoId))
          .limit(1);
        const qtd = Number(en.quantidadePadrao) * fator;
        const preco = prod?.precoCusto ? Number(prod.precoCusto) : 0;
        await tx.insert(schema.ordemProducaoEntrada).values({
          ordemProducaoId: op!.id,
          produtoId: en.produtoId,
          quantidade: qtd.toFixed(4),
          precoUnitario: preco.toFixed(6),
          valorTotal: (qtd * preco).toFixed(2),
        });
      }
      for (const sd of saidasTpl) {
        await tx.insert(schema.ordemProducaoSaida).values({
          ordemProducaoId: op!.id,
          tipo: sd.tipo,
          produtoId: sd.produtoId,
          quantidade: (Number(sd.quantidadePadrao) * fator).toFixed(4),
          pesoRelativo: sd.pesoRelativo,
          observacao: sd.observacao,
        });
      }
      await tx
        .update(schema.templateOp)
        .set({ vezesUsado: sql`${schema.templateOp.vezesUsado} + 1` })
        .where(eq(schema.templateOp.id, tpl.id));
      return op!.id;
    });
  } else {
    const texto = b.texto?.trim();
    if (!texto) return NextResponse.json({ ok: false, erro: 'escolha um item ou escreva o que produzir' }, { status: 400 });
    descricao = texto.slice(0, 200);
    resumo = descricao;
    const [op] = await db
      .insert(schema.ordemProducao)
      .values({
        filialId: f,
        descricao,
        observacao: obsChef || null,
        responsavel: b.cozinheiro?.trim() || null,
        tokenPublico: token,
        enviadaEm: agora,
      })
      .returning({ id: schema.ordemProducao.id });
    opId = op!.id;
  }

  const link = `${new URL(request.url).origin}/op/${token}`;
  const primeiro = (b.cozinheiro ?? '').trim().split(/\s+/)[0] ?? '';
  const msg = [
    `${primeiro ? primeiro + ', p' : 'P'}rodução pra fazer:`,
    `*${resumo}*`,
    b.observacao?.trim() ? `Obs: ${b.observacao.trim()}` : '',
    '',
    `Quando terminar, marca PRONTO aqui: ${link}`,
  ]
    .filter((l, i) => l !== '' || i === 3)
    .join('\n');
  const fone = foneWa(b.telefone);
  const whatsapp = `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`;

  return NextResponse.json({ ok: true, opId, link, whatsapp, temFone: !!fone });
}
