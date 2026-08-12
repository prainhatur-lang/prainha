// POST /api/cotacao/preencher/[token]
// Endpoint publico (sem auth). Fornecedor submete preço/marca por item via token unico.
//
// Body: { respostas: Array<{ cotacaoItemId, precoUnitario, marca, observacao }> }
//   - precoUnitario null/undefined = nao tem o item
//   - respostas vazio = nao tem nada essa semana
// Marca o cotacao_fornecedor como RESPONDIDA. Idempotente: re-submeter substitui as respostas.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq } from 'drizzle-orm';

interface Body {
  respostas: Array<{
    cotacaoItemId: string;
    /** Preço DA EMBALAGEM que o fornecedor vende (não da unidade do pedido). */
    precoUnitario: number;
    marca: string | null;
    /** Como ele vende: "caixa 18 kg", "fardo", "un". */
    embalagem?: string | null;
    /** Quanto vem na embalagem, na unidade do pedido. 1 = vende na mesma unidade. */
    qtdPorEmbalagem?: number | null;
    observacao: string | null;
  }>;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await params;
  const token = rawToken.replace(/^(\{\{\d+\}\})+/, '');

  const [cf] = await db
    .select()
    .from(schema.cotacaoFornecedor)
    .where(eq(schema.cotacaoFornecedor.tokenPublico, token))
    .limit(1);
  if (!cf) return NextResponse.json({ error: 'token invalido' }, { status: 404 });

  // Verifica se cotacao ainda esta aberta
  const [cot] = await db
    .select({
      id: schema.cotacao.id,
      filialId: schema.cotacao.filialId,
      status: schema.cotacao.status,
      fechaEm: schema.cotacao.fechaEm,
    })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cf.cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (cot.status === 'CANCELADA') {
    return NextResponse.json({ error: 'cotacao cancelada' }, { status: 410 });
  }
  if (cot.fechaEm && new Date() > new Date(cot.fechaEm)) {
    return NextResponse.json({ error: 'cotacao expirou' }, { status: 410 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  const respostas = Array.isArray(body.respostas) ? body.respostas : [];

  // MARCA OBRIGATÓRIA (validação no servidor, não só no formulário): item com
  // preço tem que vir com marca, e quando o item define marcas aceitas a marca
  // informada precisa ser uma delas. A casa não compra marca qualquer.
  if (respostas.length > 0) {
    const itens = await db
      .select({
        id: schema.cotacaoItem.id,
        marcasAceitas: schema.cotacaoItem.marcasAceitas,
        unidade: schema.cotacaoItem.unidade,
        produtoId: schema.cotacaoItem.produtoId,
        produtoNome: schema.produto.nome,
      })
      .from(schema.cotacaoItem)
      .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
      .where(eq(schema.cotacaoItem.cotacaoId, cot.id));
    const porItem = new Map(itens.map((i) => [i.id, i]));

    const semMarca: string[] = [];
    const marcaForaDaLista: string[] = [];
    for (const r of respostas) {
      const item = porItem.get(r.cotacaoItemId);
      if (!item) continue;
      const marca = (r.marca ?? '').trim();
      if (!marca) {
        semMarca.push(item.produtoNome ?? 'item');
        continue;
      }
      const aceitas = (item.marcasAceitas ?? '')
        .split('|')
        .map((m) => m.trim())
        .filter(Boolean);
      if (aceitas.length > 0 && !aceitas.some((a) => a.toLowerCase() === marca.toLowerCase())) {
        marcaForaDaLista.push(`${item.produtoNome} (aceitas: ${aceitas.join(', ')})`);
      }
    }
    // Rede de segurança contra preço fora da realidade (vírgula esquecida):
    // compara o normalizado com a última nota fiscal do mesmo produto. 20x pra
    // cima ou pra baixo é erro de digitação, não negociação.
    const precoAbsurdo: string[] = [];
    for (const r of respostas) {
      const item = porItem.get(r.cotacaoItemId);
      if (!item?.produtoId) continue;
      const fator =
        r.qtdPorEmbalagem != null && Number(r.qtdPorEmbalagem) > 0 ? Number(r.qtdPorEmbalagem) : 1;
      const normalizado = Number(r.precoUnitario) / fator;
      if (!Number.isFinite(normalizado) || normalizado <= 0) continue;
      const [ultima] = await db
        .select({ valor: schema.notaCompraItem.valorUnitario })
        .from(schema.notaCompraItem)
        .innerJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.notaCompraItem.notaCompraId))
        .where(eq(schema.notaCompraItem.produtoId, item.produtoId))
        .orderBy(desc(schema.notaCompra.dataEmissao))
        .limit(1);
      const ref = ultima?.valor != null ? Number(ultima.valor) : null;
      if (!ref || ref <= 0) continue;
      if (normalizado > ref * 20 || normalizado < ref / 20) {
        precoAbsurdo.push(
          `${item.produtoNome}: R$ ${normalizado.toFixed(2)} por ${item.unidade} ` +
            `(última compra foi R$ ${ref.toFixed(2)}) — confira a vírgula e a embalagem`,
        );
      }
    }

    if (semMarca.length > 0 || marcaForaDaLista.length > 0 || precoAbsurdo.length > 0) {
      const partes = [
        semMarca.length ? `Informe a marca de: ${semMarca.join(', ')}.` : '',
        marcaForaDaLista.length ? `Marca não aceita em: ${marcaForaDaLista.join('; ')}.` : '',
        precoAbsurdo.length ? `Preço fora do esperado — ${precoAbsurdo.join('; ')}.` : '',
        'Se não tiver a marca pedida, deixe o preço em branco.',
      ].filter(Boolean);
      return NextResponse.json({ error: partes.join(' ') }, { status: 400 });
    }
  }

  // Limpa respostas anteriores deste fornecedor pra esta cotacao (re-submit substitui)
  await db
    .delete(schema.cotacaoRespostaItem)
    .where(eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cf.id));

  // Cria/acha marcas (texto livre por enquanto — vai criar marca nova se nao existir)
  async function acharOuCriarMarca(nome: string | null): Promise<string | null> {
    if (!nome || !nome.trim()) return null;
    const n = nome.trim();
    const existente = await db
      .select({ id: schema.marca.id })
      .from(schema.marca)
      .where(and(eq(schema.marca.filialId, cot.filialId), eq(schema.marca.nome, n)))
      .limit(1);
    if (existente[0]) return existente[0].id;
    const [novo] = await db
      .insert(schema.marca)
      .values({ filialId: cot.filialId, nome: n })
      .returning({ id: schema.marca.id });
    return novo.id;
  }

  if (respostas.length > 0) {
    for (const r of respostas) {
      const marcaId = await acharOuCriarMarca(r.marca);
      // Fornecedor cota o preço DA EMBALAGEM dele + quanto vem nela. O
      // normalizado (preço por unidade do pedido) é o que permite comparar
      // quem vende em caixa de 18 kg com quem vende no quilo.
      const precoNum = Number(r.precoUnitario);
      const fator =
        r.qtdPorEmbalagem != null && Number(r.qtdPorEmbalagem) > 0
          ? Number(r.qtdPorEmbalagem)
          : 1;
      await db.insert(schema.cotacaoRespostaItem).values({
        cotacaoFornecedorId: cf.id,
        cotacaoItemId: r.cotacaoItemId,
        marcaId,
        marcaTextoLivre: marcaId ? null : r.marca ?? null,
        precoUnitario: String(precoNum),
        precoUnitarioNormalizado: String(precoNum / fator),
        unidadeFornecedor: r.embalagem?.slice(0, 40) ?? null,
        fatorConversao: String(fator),
        observacao: r.observacao,
      });
    }
  }

  // Marca como RESPONDIDA
  await db
    .update(schema.cotacaoFornecedor)
    .set({
      status: 'RESPONDIDA',
      respondidoEm: new Date(),
    })
    .where(eq(schema.cotacaoFornecedor.id, cf.id));

  return NextResponse.json({ ok: true, count: respostas.length });
}
