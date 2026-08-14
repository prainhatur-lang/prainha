// GET /api/cardapio/itens?filialId=...
// Lista COMPLETA do cardápio público ativo (produto_variante.menu_dino — a
// mesma base do Menudino/Nina), com nome, tamanho, preço e descrição.
// Uso interno (auth): análises do cardápio — ex: mapear itens sem glúten.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const FILIAL_PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId') ?? FILIAL_PRAINHA;

  const linhas = (await db.execute(sql`
    SELECT p.nome,
           COALESCE(t.descricao, t.sigla, '') AS tamanho,
           pv.preco_venda::float AS preco,
           COALESCE(p.descricao, '') AS descricao
    FROM produto_variante pv
    JOIN produto p ON p.id = pv.produto_id
    LEFT JOIN produto_tamanho t ON t.id = pv.produto_tamanho_id
    WHERE p.filial_id = ${filialId}
      AND pv.menu_dino
      AND pv.data_delete IS NULL
      AND pv.data_pausado IS NULL
      AND (p.descontinuado IS NOT TRUE)
      AND (p.data_pausado IS NULL)
      AND pv.preco_venda > 0
    ORDER BY p.nome, pv.preco_venda
    LIMIT 800
  `)) as unknown as Array<{ nome: string; tamanho: string; preco: number; descricao: string }>;

  return NextResponse.json({ itens: linhas });
}
