// /api/lelis/entrada — notas de COMPRA da Lelis (01/11/2026).
// GET: notas que chegaram (SEFAZ/upload) + se já deram entrada; saldo do estoque.
// POST { notaId }: dá entrada → estoque (+), tributação da saída e contas a pagar.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { darEntradaNotaLelis } from '@/lib/lelis/movimento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const notas = await db.execute(sql`
    SELECT n.id, n.numero, n.serie, n.chave, n.emit_nome, n.emit_cnpj, n.valor_total::float AS valor_total,
           (n.data_emissao AT TIME ZONE 'America/Sao_Paulo')::date::text AS emissao,
           (SELECT count(*)::int FROM nota_compra_item i WHERE i.nota_compra_id = n.id) AS itens,
           (SELECT count(*)::int FROM revenda_movimento m JOIN nota_compra_item i ON i.id = m.nota_compra_item_id
             WHERE i.nota_compra_id = n.id AND m.tipo = 'ENTRADA_COMPRA') AS itens_entrada,
           (SELECT count(*)::int FROM conta_pagar c WHERE c.nota_compra_id = n.id) AS contas
      FROM nota_compra n
     WHERE n.filial_id = ${a.filialId}::uuid
     ORDER BY n.data_emissao DESC NULLS LAST
     LIMIT 200
  `);
  const estoque = await db.execute(sql`
    SELECT p.id, p.descricao, p.unidade, p.trib_icms, p.cst_pis_saida, p.trib_manual, p.cfop_entrada, p.cst_icms_entrada,
           p.cst_pis_entrada, p.icms_st_unit::float AS icms_st_unit,
           coalesce(sum(m.quantidade), 0)::float AS saldo,
           coalesce(sum(m.quantidade) FILTER (WHERE m.tipo = 'ENTRADA_COMPRA'), 0)::float AS entrou,
           coalesce(-sum(m.quantidade) FILTER (WHERE m.tipo IN ('SAIDA_VENDA','ESTORNO_VENDA')), 0)::float AS vendeu,
           (p.custo_unit + p.frete_unit)::float AS custo
      FROM revenda_produto p
      LEFT JOIN revenda_movimento m ON m.revenda_produto_id = p.id
     WHERE p.filial_id = ${a.filialId}::uuid AND p.ativo
     GROUP BY p.id
     ORDER BY p.descricao
  `);
  return NextResponse.json({ notas, estoque });
}

const Body = z.object({ notaId: z.string().uuid() });

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'nota inválida' }, { status: 400 });
  const r = await darEntradaNotaLelis(a.filialId, p.data.notaId, a.email);
  if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
