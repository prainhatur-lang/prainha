// POST /api/nota-compra/[id]/mover-casa — "Lançar direto na casa" (dono 22/11/2026).
// As NF-e das compras do Mercado Livre caem pela SEFAZ na E.B. Serviços, mas a
// mercadoria é do Bar/Mar/Tabuará. Passa a nota (itens, duplicatas, boletos) pra
// casa certa ANTES da entrada, pra o estoque e a conta nascerem lá.
// Só Admin, só nota sem nada lançado (estoque, conta a pagar, pedido, transferência).
// Guarda a casa de origem em filial_origem_id: o DF-e não traz a chave de volta.
// Body: { filialId: string }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { garantirFornecedorDoPedido } from '@/lib/pedido-sem-nota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ filialId: z.string().uuid() });

type Linha = Record<string, unknown>;
const q = async <T = Linha>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await ehAdmin(user.id))) return NextResponse.json({ error: 'Só o Admin passa nota de uma casa pra outra.' }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'escolha a casa' }, { status: 400 });
  const destino = parsed.data.filialId;

  const [nota] = await q<{
    filial_id: string; chave: string | null; emit_cnpj: string | null; emit_nome: string | null;
    origem_importacao: string | null; filial_origem_id: string | null;
  }>(sql`SELECT filial_id::text, chave, emit_cnpj, emit_nome, origem_importacao, filial_origem_id::text
           FROM nota_compra WHERE id = ${id}`);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });
  if (nota.filial_id === destino) return NextResponse.json({ ok: true, filialId: destino, jaEstava: true });

  const [casa] = await q<{ nome: string }>(sql`SELECT nome FROM filial WHERE id = ${destino}`);
  if (!casa) return NextResponse.json({ error: 'casa nao encontrada' }, { status: 404 });

  if (nota.origem_importacao === 'SEFAZ_DFE_RESUMO' || nota.origem_importacao === 'SEFAZ_DFE_RESUMO_CIENTE') {
    return NextResponse.json(
      { error: 'Esta nota ainda é só o resumo da SEFAZ (sem itens). Espere o XML completo chegar e passe depois.' },
      { status: 409 },
    );
  }

  // Nada pode ter nascido na casa de agora.
  const [trava] = await q<{ estoque: number; contas: number; pedidos: number; transf: number; revenda: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM movimento_estoque m JOIN nota_compra_item i ON i.id = m.nota_compra_item_id WHERE i.nota_compra_id = ${id}) AS estoque,
      (SELECT count(*)::int FROM conta_pagar WHERE nota_compra_id = ${id} AND data_delete IS NULL) AS contas,
      (SELECT count(*)::int FROM pedido_compra WHERE nota_compra_id = ${id})
        + (SELECT count(*)::int FROM pedido_compra_item pci JOIN nota_compra_item i ON i.id = pci.nota_compra_item_id WHERE i.nota_compra_id = ${id}) AS pedidos,
      (SELECT count(*)::int FROM transferencia_filial WHERE nota_compra_id = ${id} AND cancelado_em IS NULL) AS transf,
      (SELECT count(*)::int FROM revenda_movimento r JOIN nota_compra_item i ON i.id = r.nota_compra_item_id WHERE i.nota_compra_id = ${id}) AS revenda
  `);
  const motivos: string[] = [];
  if (trava?.estoque) motivos.push('estoque já lançado');
  if (trava?.contas) motivos.push('conta a pagar criada');
  if (trava?.pedidos) motivos.push('ligada a pedido de compra');
  if (trava?.transf) motivos.push('tem transferência');
  if (trava?.revenda) motivos.push('tem movimento de revenda');
  if (motivos.length) {
    return NextResponse.json(
      { error: `Não dá pra passar: ${motivos.join(', ')}. Desfaça na casa de agora ou use a transferência entre casas.` },
      { status: 409 },
    );
  }

  if (nota.chave) {
    const [dup] = await q(sql`SELECT 1 FROM nota_compra WHERE filial_id = ${destino} AND chave = ${nota.chave} AND id <> ${id}`);
    if (dup) return NextResponse.json({ error: `A ${casa.nome} já tem esta mesma nota.` }, { status: 409 });
  }

  // Fornecedor da casa de destino com o mesmo CNPJ (copia de outra casa / Receita).
  const doc = (nota.emit_cnpj ?? '').replace(/\D/g, '');
  const forn = doc
    ? await garantirFornecedorDoPedido(destino, { fornecedorCnpj: doc, fornecedorNome: nota.emit_nome }).catch(() => null)
    : null;

  const origem = nota.filial_origem_id ?? nota.filial_id;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE nota_compra
         SET filial_id = ${destino},
             filial_origem_id = ${origem},
             movida_em = now(),
             fornecedor_id = ${forn?.id ?? null},
             atualizado_em = now()
       WHERE id = ${id}`);
    // Produto vinculado é da casa de antes: o vínculo cai e a entrada liga de novo.
    await tx.execute(sql`
      UPDATE nota_compra_item i
         SET filial_id = ${destino},
             produto_id = CASE WHEN EXISTS (SELECT 1 FROM produto p WHERE p.id = i.produto_id AND p.filial_id = ${destino})
                               THEN i.produto_id ELSE NULL END,
             sem_vinculo_auto = false
       WHERE i.nota_compra_id = ${id}`);
    await tx.execute(sql`UPDATE nota_compra_duplicata SET filial_id = ${destino} WHERE nota_compra_id = ${id}`);
    await tx.execute(sql`UPDATE nota_compra_boleto_pendente SET filial_id = ${destino} WHERE nota_compra_id = ${id}`);
    await tx.execute(sql`UPDATE nota_chave_leitura SET filial_id = ${destino} WHERE nota_compra_id = ${id}`);
  });

  return NextResponse.json({ ok: true, filialId: destino, casa: casa.nome, fornecedor: forn?.nome ?? null });
}
