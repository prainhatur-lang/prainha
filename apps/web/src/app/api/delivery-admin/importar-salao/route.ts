// GET  /api/delivery-admin/importar-salao?filialId= — lista os produtos do
//      salão (espelho do Consumer) com preço, pra escolher o que entra no
//      cardápio do delivery.
// POST — cria itens do delivery a partir dos produtos escolhidos. O preço
//      vem sugerido do salão mas é editável: preço do delivery é próprio.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto, normalizarNome } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const filialId = new URL(request.url).searchParams.get('filialId') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ itens: [] });
  }

  const rows = await db
    .select({
      varianteId: schema.produtoVariante.id,
      nome: schema.produto.nome,
      descricao: schema.produto.descricao,
      preco: schema.produtoVariante.precoVenda,
      precoProduto: schema.produto.precoVenda,
    })
    .from(schema.produtoVariante)
    .innerJoin(
      schema.produto,
      and(
        eq(schema.produto.filialId, schema.produtoVariante.filialId),
        eq(schema.produto.codigoExterno, schema.produtoVariante.codigoProdutoExterno),
      ),
    )
    .where(
      and(
        eq(schema.produtoVariante.filialId, filialId),
        isNull(schema.produtoVariante.dataPausado),
        isNull(schema.produtoVariante.dataDelete),
        or(eq(schema.produto.descontinuado, false), isNull(schema.produto.descontinuado)),
      ),
    );

  // Dedupe por nome normalizado, ficando com a variante que tem preço e
  // descrição (mesma lógica do cardápio do orçamento).
  const porChave = new Map<
    string,
    { varianteId: string; nome: string; descricao: string | null; precoCentavos: number }
  >();
  for (const r of rows) {
    const limpo = limparNomeProduto(r.nome);
    if (!limpo) continue;
    const precoNum = Number(r.preco ?? r.precoProduto ?? 0);
    if (!Number.isFinite(precoNum) || precoNum <= 0) continue;
    const chave = normalizarNome(limpo);
    const cand = {
      varianteId: r.varianteId,
      nome: limpo,
      descricao: (r.descricao ?? '').trim() || null,
      precoCentavos: Math.round(precoNum * 100),
    };
    const atual = porChave.get(chave);
    if (!atual || (!atual.descricao && cand.descricao)) porChave.set(chave, cand);
  }

  // Já no cardápio do delivery? Marca pra não duplicar.
  const jaTem = await db
    .select({ nome: schema.deliveryItem.nome })
    .from(schema.deliveryItem)
    .where(eq(schema.deliveryItem.filialId, filialId));
  const nomesExistentes = new Set(jaTem.map((i) => normalizarNome(i.nome)));

  const itens = [...porChave.entries()]
    .map(([chave, v]) => ({ ...v, jaNoCardapio: nomesExistentes.has(chave) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return NextResponse.json({ itens });
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.create');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const categoriaId = typeof b?.categoriaId === 'string' ? b.categoriaId : null;
  const itens = Array.isArray(b?.itens) ? b.itens : [];
  if (!filialId || !categoriaId || itens.length === 0) {
    return NextResponse.json({ error: 'filial, categoria e itens são obrigatórios' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  type LinhaItem = {
    filialId: string;
    categoriaId: string;
    nome: string;
    descricao: string | null;
    preco: string;
    varianteId: string | null;
  };

  const linhas: LinhaItem[] = (itens as unknown[])
    .map((i: unknown): LinhaItem | null => {
      const o = i as { nome?: unknown; descricao?: unknown; preco?: unknown; varianteId?: unknown };
      const nome = typeof o?.nome === 'string' ? o.nome.trim().slice(0, 160) : '';
      const preco = Number(o?.preco);
      if (!nome || !Number.isFinite(preco) || preco <= 0) return null;
      return {
        filialId,
        categoriaId,
        nome,
        descricao:
          typeof o?.descricao === 'string' && o.descricao.trim()
            ? o.descricao.trim().slice(0, 600)
            : null,
        preco: preco.toFixed(2),
        varianteId: typeof o?.varianteId === 'string' ? o.varianteId : null,
      };
    })
    .filter((l): l is LinhaItem => l != null)
    .slice(0, 300);

  if (linhas.length === 0) {
    return NextResponse.json({ error: 'nenhum item válido' }, { status: 400 });
  }

  await db.insert(schema.deliveryItem).values(linhas);
  return NextResponse.json({ ok: true, criados: linhas.length });
}
