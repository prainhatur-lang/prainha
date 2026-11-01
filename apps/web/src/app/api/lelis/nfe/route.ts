// /api/lelis/nfe — NF-e de VENDA DE MERCADORIA da Lelis (01/11/2026).
// POST emite (itens = produtos da tela de preço + quantidade + preço); GET lista.
// Só o Admin, só na filial da Lelis. Idempotente pelo id que a tela gera.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { emitirNfeVenda, nfesVendaLelis } from '@/lib/nfe/emitir-venda';
import { cstsDaVenda } from '@/lib/lelis/tributacao';
import { parcelasPadrao, registrarVendaLelis } from '@/lib/lelis/movimento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const txt = (max: number) => z.string().trim().max(max);
const Body = z.object({
  id: z.string().uuid(),
  homologacao: z.boolean().optional(),
  destinatario: z.object({
    documento: txt(20),
    nome: txt(120),
    ie: txt(20).optional(),
    email: txt(80).optional(),
    logradouro: txt(120),
    numero: txt(60).optional(),
    complemento: txt(60).optional(),
    bairro: txt(60),
    codigoMunicipio: txt(10),
    municipio: txt(60),
    uf: txt(2),
    cep: txt(10),
    fone: txt(20).optional(),
  }),
  itens: z
    .array(
      z.object({
        produtoId: z.string().uuid(),
        quantidade: z.number().positive().max(9_999_999),
        preco: z.number().positive().max(99_999_999),
      }),
    )
    .min(1)
    .max(990),
  formaPagamento: txt(2),
  modFrete: txt(1).optional(),
  cfop: txt(4).optional(),
  infoExtra: txt(2000).optional(),
  /** Vencimentos do a receber (vazio = um só: hoje, ou +28 dias no boleto). */
  vencimentos: z
    .array(z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.number().positive() }))
    .max(24)
    .optional(),
});

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const campo = parsed.error.issues[0]?.path.join('.') ?? '';
    return NextResponse.json({ error: `confira os dados da nota${campo ? ` (${campo})` : ''}` }, { status: 400 });
  }
  const d = parsed.data;

  const ids = [...new Set(d.itens.map((i) => i.produtoId))];
  const prods = await db
    .select()
    .from(schema.revendaProduto)
    .where(and(eq(schema.revendaProduto.filialId, a.filialId), inArray(schema.revendaProduto.id, ids)));
  const porId = new Map(prods.map((p) => [p.id, p]));
  const faltando = ids.filter((id) => !porId.has(id));
  if (faltando.length) return NextResponse.json({ error: 'produto não encontrado — recarregue a página' }, { status: 400 });

  const [cfg] = await db
    .select({ fiscal: schema.revendaConfig.fiscal })
    .from(schema.revendaConfig)
    .where(eq(schema.revendaConfig.filialId, a.filialId))
    .limit(1);

  const r = await emitirNfeVenda({
    id: d.id,
    filialId: a.filialId,
    userId: a.userId,
    destinatario: d.destinatario,
    itens: d.itens.map((i) => {
      const p = porId.get(i.produtoId)!;
      return {
        codigo: p.codigoFornecedor || p.ean || p.id.slice(0, 8),
        ean: p.ean,
        descricao: p.descricao,
        ncm: p.ncm,
        cest: p.cest,
        unidade: p.unidade,
        quantidade: i.quantidade,
        valorUnitario: i.preco,
        // compra de fora do país não passa por aqui: mercadoria nacional
        origem: '0',
        // tributação tirada da nota de entrada (ou escolhida à mão no produto)
        ...cstsDaVenda(p),
      };
    }),
    formaPagamento: d.formaPagamento,
    modFrete: d.modFrete,
    cfop: d.cfop,
    fiscal: cfg?.fiscal ?? {},
    infoExtra: d.infoExtra,
    homologacao: d.homologacao === true,
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.erro, cstat: r.cstat, transitorio: r.transitorio === true },
      { status: r.transitorio ? 503 : 400 },
    );
  }
  // nota de verdade: baixa o estoque e lança o a receber (idempotente — reenvio não duplica)
  let avisoFin: string | undefined;
  if (r.nota.ambiente === 1 && r.nota.status === 'AUTORIZADA') {
    try {
      const porProd = new Map<string, number>();
      for (const i of d.itens) porProd.set(i.produtoId, (porProd.get(i.produtoId) ?? 0) + i.quantidade);
      const total = r.nota.valorTotal;
      const somaV = (d.vencimentos ?? []).reduce((s, v) => s + v.valor, 0);
      const parcelas =
        d.vencimentos?.length && Math.abs(somaV - total) < 0.05
          ? d.vencimentos.map((v) => ({ vencimento: v.data, valor: v.valor }))
          : parcelasPadrao(total, d.formaPagamento);
      await registrarVendaLelis({
        filialId: a.filialId,
        nfeId: r.nota.id,
        numero: r.nota.numero,
        usuario: a.email ?? a.userId,
        compradorDoc: d.destinatario.documento.replace(/\D/g, ''),
        compradorNome: d.destinatario.nome,
        formaPagamento: d.formaPagamento,
        itens: [...porProd].map(([produtoId, quantidade]) => {
          const p = porId.get(produtoId)!;
          return { produtoId, quantidade, custoUnit: Number(p.custoUnit) + Number(p.freteUnit) };
        }),
        parcelas,
      });
    } catch (e) {
      console.error('[lelis/nfe] estoque/receber', e);
      avisoFin = 'A nota saiu, mas não consegui baixar o estoque/lançar o a receber — me avise.';
    }
  }
  return NextResponse.json({ ok: true, jaExistia: r.jaExistia, nota: r.nota, aviso: [r.aviso, avisoFin].filter(Boolean).join(' ') || undefined });
}

export async function GET() {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const notas = await nfesVendaLelis(a.filialId);
  return NextResponse.json({
    notas: notas.map((n) => ({
      id: n.id,
      numero: n.numero,
      serie: n.serie,
      chave: n.chave,
      status: n.status,
      ambiente: n.ambiente,
      valorTotal: Number(n.valorTotal),
      destNome: (n.dest as { nome?: string } | null)?.nome ?? null,
      xmotivo: n.xmotivo,
      criadoEm: n.criadoEm,
    })),
  });
}
