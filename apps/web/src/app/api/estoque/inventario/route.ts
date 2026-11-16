// /api/estoque/inventario — inventário (contagem física) do estoque da casa.
// Dono, 16/11/2026: "Ajuste manual (Saldo & Custo) deverá ser exclusivamente por
// inventário a partir de agora". É aqui que o saldo se corrige.
// POST { filialId, itens: [{ produtoId, contado }], observacao? }: pra cada
// produto contado grava UM movimento de ajuste com a diferença (contado − saldo
// do sistema na hora, calculada dentro da transação — mandar a mesma contagem
// duas vezes não ajusta em dobro). Produto fora da lista não é tocado.
// Produto de venda que baixa de insumo não entra: conta-se o insumo.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { aplicarMpmEntrada, aplicarSaida } from '@/lib/custo-medio';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  filialId: z.string().uuid(),
  itens: z
    .array(z.object({ produtoId: z.string().uuid(), contado: z.number().min(0).max(1_000_000) }))
    .min(1)
    .max(3000),
  observacao: z.string().trim().max(200).optional(),
});

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Contagem inválida' }, { status: 400 });
  const { filialId } = p.data;

  // mesmo acesso que o ajuste manual tinha: quem é da casa
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const contado = new Map<string, number>();
  for (const i of p.data.itens) contado.set(i.produtoId, i.contado);
  const [y, m, d] = hojeBr().split('-');
  const dia = `${d}/${m}/${y}`;
  const obs = p.data.observacao ? ` — ${p.data.observacao}` : '';

  try {
    const r = await db.transaction(async (tx) => {
      const linhas = (await tx.execute(sql`
        SELECT p.id, p.nome, p.controla_estoque AS controla,
               coalesce(p.estoque_atual, 0)::float AS saldo,
               coalesce(p.preco_custo, 0)::float AS custo,
               (p.tipo <> 'INSUMO' AND EXISTS (
                  SELECT 1 FROM ficha_tecnica ft JOIN produto i ON i.id = ft.insumo_id
                   WHERE ft.produto_id = p.id AND ft.baixa_estoque AND i.controla_estoque AND i.id <> p.id
               )) AS no_insumo
          FROM produto p
         WHERE p.filial_id = ${filialId}::uuid
           AND p.id IN (${sql.join([...contado.keys()].map((id) => sql`${id}::uuid`), sql`, `)})
         FOR UPDATE OF p
      `)) as unknown as Array<{ id: string; nome: string | null; controla: boolean; saldo: number; custo: number; no_insumo: boolean }>;
      if (linhas.length !== contado.size) throw new Recusa('Tem produto na contagem que não é desta casa.');
      const fora = linhas.filter((l) => !l.controla || l.no_insumo);
      if (fora.length) {
        throw new Recusa(
          `Não dá pra contar aqui: ${fora.slice(0, 5).map((l) => l.nome).join(', ')}. ` +
            'Produto que não controla estoque ou que baixa de insumo não guarda saldo — conte o insumo.',
        );
      }
      const agora = new Date();
      let ajustados = 0;
      let iguais = 0;
      for (const l of linhas) {
        const c = contado.get(l.id)!;
        const dif = Math.round((c - Number(l.saldo)) * 10000) / 10000;
        if (Math.abs(dif) < 0.00005) { iguais++; continue; }
        const q = Math.abs(dif);
        const custo = Number(l.custo);
        await tx.insert(schema.movimentoEstoque).values({
          filialId,
          produtoId: l.id,
          tipo: dif > 0 ? 'ENTRADA_AJUSTE' : 'SAIDA_AJUSTE',
          quantidade: dif.toFixed(4),
          precoUnitario: custo.toFixed(6),
          valorTotal: (q * custo).toFixed(2),
          dataHora: agora,
          observacao: `Inventário ${dia}: contado ${fmt(c)}, sistema ${fmt(Number(l.saldo))}${obs}`.slice(0, 500),
          criadoPor: user.id,
        });
        if (dif > 0) await aplicarMpmEntrada({ produtoId: l.id, qtdEntrada: q, custoEntrada: custo, exec: tx });
        else await aplicarSaida({ produtoId: l.id, qtdSaida: q, exec: tx });
        ajustados++;
      }
      return { ajustados, iguais };
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof Recusa) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

class Recusa extends Error {}
