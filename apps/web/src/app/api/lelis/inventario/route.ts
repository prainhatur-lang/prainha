// /api/lelis/inventario — inventário (contagem física) do estoque da Lelis
// (pedido do dono 11/11/2026: "fazer uma tela de inventario").
// POST { itens: [{ produtoId, contado }], observacao? }: pra cada produto contado,
// grava UM movimento AJUSTE com a diferença (contado − saldo do sistema na hora).
// A diferença é calculada aqui dentro da transação — mandar a mesma contagem duas
// vezes não ajusta em dobro. Produto fora da lista não é tocado. Só Admin.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  itens: z
    .array(z.object({ produtoId: z.string().uuid(), contado: z.number().min(0).max(1_000_000) }))
    .min(1)
    .max(2000),
  observacao: z.string().trim().max(200).optional(),
});

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Contagem inválida' }, { status: 400 });

  const contado = new Map<string, number>();
  for (const i of p.data.itens) contado.set(i.produtoId, i.contado);
  const [y, m, d] = hojeBr().split('-');
  const dia = `${d}/${m}/${y}`;
  const obs = p.data.observacao ? ` — ${p.data.observacao}` : '';

  const r = await db.transaction(async (tx) => {
    const linhas = (await tx.execute(sql`
      SELECT p.id, p.descricao, (p.custo_unit + p.frete_unit)::float AS custo,
             coalesce((SELECT sum(mv.quantidade) FROM revenda_movimento mv WHERE mv.revenda_produto_id = p.id), 0)::float AS saldo
        FROM revenda_produto p
       WHERE p.filial_id = ${a.filialId}::uuid
       FOR UPDATE OF p
    `)) as unknown as Array<{ id: string; descricao: string; custo: number; saldo: number }>;
    let ajustados = 0;
    let iguais = 0;
    for (const l of linhas) {
      const c = contado.get(l.id);
      if (c === undefined) continue;
      const dif = Math.round((c - Number(l.saldo)) * 10000) / 10000;
      if (Math.abs(dif) < 0.00005) { iguais++; continue; }
      await tx.execute(sql`
        INSERT INTO revenda_movimento (filial_id, revenda_produto_id, tipo, quantidade, custo_unit, observacao, criado_por)
        VALUES (${a.filialId}::uuid, ${l.id}::uuid, 'AJUSTE', ${String(dif)}::numeric, ${Number(l.custo).toFixed(4)}::numeric,
                ${`Inventário ${dia}: contado ${fmt(c)}, sistema ${fmt(Number(l.saldo))}${obs}`.slice(0, 400)}, ${a.email})
      `);
      ajustados++;
    }
    return { ajustados, iguais };
  });

  return NextResponse.json({ ok: true, ...r });
}
