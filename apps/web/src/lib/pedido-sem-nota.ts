// Pedido SEM NOTA: o fornecedor entrega com um pedido/romaneio de papel em vez
// de NF-e. A foto (ou PDF) é lida pela IA e vira uma linha em nota_compra com
// origem_importacao = 'PEDIDO_FOTO' — daí pra frente é o mesmo caminho da NF-e
// (vincular produto, conferir, lançar no estoque, contas a pagar), sem tela nova.
//
// A chave de 44 posições não existe num pedido de papel: usamos 'SN' + 42
// primeiros caracteres do sha256 do arquivo. Mesma foto enviada de novo cai na
// mesma chave e não duplica.

import { createHash } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

export const ORIGEM_PEDIDO_FOTO = 'PEDIDO_FOTO';
export const BUCKET_PEDIDO = 'producao-fotos';

export const MIMES_PEDIDO = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/** URL pública da foto do pedido (o bucket é público). */
export function urlFotoPedido(storagePath: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!storagePath || !base) return null;
  return `${base}/storage/v1/object/public/${BUCKET_PEDIDO}/${storagePath}`;
}

export function chaveDoPedido(hash: string): string {
  return `SN${hash.slice(0, 42)}`;
}

export function hashArquivo(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ───────────────────────── leitura ─────────────────────────

export interface ItemLido {
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  /** índice no catálogo enviado (P12 → 12) quando a IA reconheceu o insumo */
  produtoIdx: number | null;
  certeza: 'alta' | 'media' | 'baixa';
}

export interface PedidoLido {
  fornecedorNome: string | null;
  fornecedorCnpj: string | null;
  fornecedorIdx: number | null;
  numero: string | null;
  data: string | null;
  vencimentos: Array<{ data: string; valor: number }>;
  total: number | null;
  desconto: number | null;
  legibilidade: 'alta' | 'media' | 'baixa';
  observacao: string | null;
  itens: ItemLido[];
}

const INSTRUCAO = `Você lê pedidos de compra, romaneios, canhotos e recibos de fornecedor de um restaurante brasileiro — documentos SEM nota fiscal, muitas vezes escritos à mão ou impressos em bobina. Sua leitura vai virar entrada de estoque e conta a pagar, então erro de número custa dinheiro.

Regras:
- Leia TODAS as linhas de item, na ordem do papel. Não invente, não junte e não pule linha.
- Número brasileiro: "1.234,56" = 1234.56. Devolva números com ponto decimal, nunca texto.
- Cada item tem quantidade, unidade (kg, un, cx, fd, pct, dz, l, sc...), valor unitário e valor total. Se o papel só traz dois dos três números, calcule o terceiro. Se não dá pra saber, null — nunca chute.
- "descricao" = o item como está escrito no papel (corrija só abreviação óbvia).
- Data em AAAA-MM-DD. Papel com dia/mês sem ano: use o ano de hoje, a não ser que isso caia no futuro.
- "vencimentos": só quando o papel traz prazo ou data de pagamento ("venc. 20/10", "30 dias", "2x"). Prazo em dias conta a partir da data do pedido. Sem prazo escrito: lista vazia.
- "total" = o total que está ESCRITO no papel (null se não tem). Não some por conta própria.
- "desconto" = desconto escrito no papel, se houver.
- "legibilidade": "alta" se leu tudo com clareza; "media" se algum número ficou duvidoso; "baixa" se a foto está ruim e há chute.
- "observacao": aviso curto pro humano quando algo merece conferência (número rasurado, linha cortada). null se está tudo certo.

Fornecedor:
- "fornecedorNome" = nome como aparece no papel (cabeçalho, carimbo, assinatura). "fornecedorCnpj" = só dígitos, se houver.
- Você recebe a lista de fornecedores cadastrados (F1, F2...). Em "fornecedor" devolva o código do que for o MESMO fornecedor do papel; null se não tiver certeza.

Insumos:
- Você recebe o catálogo de insumos da casa (P1, P2... com nome e unidade de estoque). Pra cada item devolva o código do insumo correspondente e a certeza:
  "alta" = é o mesmo produto sem dúvida (mesmo item, mesma apresentação);
  "media" = provavelmente é, mas há outro candidato parecido (tomate × tomate cereja, filé × filé mignon);
  "baixa"/null = não achou.
- Nunca force um vínculo: item sem correspondente claro fica com null.

Saída: SOMENTE um objeto JSON, sem cerca de código e sem texto em volta:
{"pedido": true, "fornecedorNome": "JOÃO DO PEIXE", "fornecedorCnpj": null, "fornecedor": "F3", "numero": "1234", "data": "2026-10-12", "vencimentos": [["2026-10-20", 350.00]], "total": 350.00, "desconto": null, "legibilidade": "alta", "observacao": null, "itens": [["Camarão cinza médio", 10, "kg", 35.00, 350.00, "P12", "alta"]]}
Cada item é uma lista nesta ordem: descricao, quantidade, unidade, valorUnitario, valorTotal, insumo, certeza.
Se o arquivo NÃO for um pedido/romaneio/recibo de compra de mercadoria: {"pedido": false, "motivo": "o que é o arquivo"}.`;

type Bloco =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

async function chamarClaude(key: string, modelo: string, blocos: Bloco[]): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 16000,
      system: INSTRUCAO,
      messages: [{ role: 'user', content: blocos }],
    }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(`Claude HTTP ${resp.status}: ${errTxt.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  if (data.stop_reason === 'refusal') throw new Error('a IA recusou ler o arquivo');
  if (data.stop_reason === 'max_tokens') throw new Error('pedido grande demais pra uma leitura só — envie uma página por vez');
  const texto = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
  if (!texto) throw new Error('a IA não devolveu texto');
  return texto;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function ymd(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function idx(v: unknown, prefixo: string, max: number): number | null {
  if (typeof v !== 'string') return null;
  const m = new RegExp(`^${prefixo}(\\d+)$`).exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n - 1 : null;
}

function certeza(v: unknown): 'alta' | 'media' | 'baixa' {
  return v === 'alta' || v === 'media' ? v : 'baixa';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Normaliza o JSON da IA e completa o número que faltar em cada item. */
export function normalizarPedido(bruto: unknown, qtdProdutos: number, qtdFornecedores: number): PedidoLido {
  const o = (bruto ?? {}) as Record<string, unknown>;
  if (o.pedido === false) {
    throw new Error(`o arquivo não parece um pedido de compra${typeof o.motivo === 'string' ? ` (${o.motivo})` : ''}`);
  }
  const itens: ItemLido[] = [];
  for (const linha of Array.isArray(o.itens) ? o.itens : []) {
    if (!Array.isArray(linha)) continue;
    const descricao = typeof linha[0] === 'string' ? linha[0].trim().slice(0, 300) : '';
    if (!descricao) continue;
    let quantidade = num(linha[1]);
    let valorUnitario = num(linha[3]);
    let valorTotal = num(linha[4]);
    if (valorTotal == null && quantidade != null && valorUnitario != null) valorTotal = r2(quantidade * valorUnitario);
    if (valorUnitario == null && quantidade && valorTotal != null) valorUnitario = valorTotal / quantidade;
    if (quantidade == null && valorUnitario && valorTotal != null) quantidade = valorTotal / valorUnitario;
    const produtoIdx = idx(linha[5], 'P', qtdProdutos);
    itens.push({
      descricao,
      quantidade,
      unidade: typeof linha[2] === 'string' && linha[2].trim() ? linha[2].trim().toLowerCase().slice(0, 10) : null,
      valorUnitario,
      valorTotal,
      produtoIdx,
      certeza: produtoIdx == null ? 'baixa' : certeza(linha[6]),
    });
  }
  if (itens.length === 0) throw new Error('a IA não achou nenhum item no pedido — tire a foto mais de perto');

  const vencimentos: PedidoLido['vencimentos'] = [];
  for (const v of Array.isArray(o.vencimentos) ? o.vencimentos : []) {
    if (!Array.isArray(v)) continue;
    const data = ymd(v[0]);
    const valor = num(v[1]);
    if (data && valor != null && valor > 0) vencimentos.push({ data, valor });
  }
  const cnpj = typeof o.fornecedorCnpj === 'string' ? o.fornecedorCnpj.replace(/\D/g, '') : '';
  return {
    fornecedorNome: typeof o.fornecedorNome === 'string' && o.fornecedorNome.trim() ? o.fornecedorNome.trim().slice(0, 200) : null,
    fornecedorCnpj: cnpj.length === 14 || cnpj.length === 11 ? cnpj : null,
    fornecedorIdx: idx(o.fornecedor, 'F', qtdFornecedores),
    numero: o.numero != null && String(o.numero).trim() ? String(o.numero).trim().slice(0, 30) : null,
    data: ymd(o.data),
    vencimentos,
    total: num(o.total),
    desconto: num(o.desconto),
    legibilidade: certeza(o.legibilidade),
    observacao: typeof o.observacao === 'string' && o.observacao.trim() ? o.observacao.trim().slice(0, 500) : null,
    itens,
  };
}

export interface CatalogoPedido {
  produtos: Array<{ id: string; nome: string; unidade: string }>;
  fornecedores: Array<{ id: string; nome: string; cnpj: string | null }>;
}

/** Insumos e fornecedores da casa — o que a IA recebe pra reconhecer. */
export async function catalogoDaFilial(filialId: string): Promise<CatalogoPedido> {
  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      descricaoCompra: schema.produto.descricaoCompra,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filialId),
        eq(schema.produto.controlaEstoque, true),
        isNotNull(schema.produto.nome),
        sql`${schema.produto.descontinuado} IS NOT TRUE`,
        sql`${schema.produto.tipo} <> 'VENDA_COMPOSTO'`,
      ),
    )
    .orderBy(schema.produto.nome);
  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      razao: schema.fornecedor.razaoSocial,
      cnpj: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedor)
    .where(and(eq(schema.fornecedor.filialId, filialId), isNull(schema.fornecedor.dataDelete)))
    .orderBy(schema.fornecedor.nome);
  return {
    produtos: produtos.map((p) => ({
      id: p.id,
      nome: p.descricaoCompra && p.descricaoCompra !== p.nome ? `${p.nome} (${p.descricaoCompra})` : (p.nome ?? ''),
      unidade: p.unidade,
    })),
    fornecedores: fornecedores
      .filter((f) => (f.nome ?? f.razao ?? '').trim())
      .map((f) => ({
        id: f.id,
        nome: f.razao && f.nome && f.razao !== f.nome ? `${f.nome} / ${f.razao}` : (f.nome ?? f.razao ?? ''),
        cnpj: f.cnpj,
      })),
  };
}

/** Lê a foto/PDF do pedido. Lança erro com a razão quando não consegue. */
export async function lerPedido(buf: Buffer, mime: string, nome: string, cat: CatalogoPedido): Promise<PedidoLido> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');
  const data = buf.toString('base64');
  const arquivo: Bloco =
    mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data } };
  const listaForn = cat.fornecedores.map((f, i) => `F${i + 1}|${f.nome}${f.cnpj ? `|${f.cnpj}` : ''}`).join('\n');
  const listaProd = cat.produtos.map((p, i) => `P${i + 1}|${p.nome}|${p.unidade}`).join('\n');
  const blocos: Bloco[] = [
    arquivo,
    {
      type: 'text',
      text: `Arquivo: ${nome}. Hoje é ${hojeBr()}.\n\nFornecedores cadastrados:\n${listaForn || '(nenhum)'}\n\nCatálogo de insumos:\n${listaProd || '(nenhum)'}\n\nDevolva o JSON do pedido.`,
    },
  ];

  const principal = process.env.PEDIDO_FOTO_MODELO || 'claude-opus-5-5';
  let texto: string;
  try {
    texto = await chamarClaude(key, principal, blocos);
  } catch (e) {
    // modelo indisponível na conta → o que o app já usa em produção
    const msg = (e as Error).message;
    if (principal === 'claude-sonnet-5' || !/HTTP (400|404)/.test(msg) || !/model/i.test(msg)) throw e;
    texto = await chamarClaude(key, 'claude-sonnet-5', blocos);
  }
  const ini = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('a IA não devolveu o JSON do pedido');
  let json: unknown;
  try {
    json = JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    throw new Error('a IA devolveu um JSON quebrado — envie a foto de novo');
  }
  return normalizarPedido(json, cat.produtos.length, cat.fornecedores.length);
}

// ───────────────────────── gravação ─────────────────────────

/** Nome do item sem acento, caixa e pontuação — pra reconhecer o mesmo item escrito igual. */
export function chaveDescricao(s: string | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const UNIDADE_IGUAL: Record<string, string> = {
  kg: 'kg', kgs: 'kg', quilo: 'kg', quilos: 'kg', k: 'kg',
  g: 'g', gr: 'g', grs: 'g',
  un: 'un', und: 'un', unid: 'un', uni: 'un', unidade: 'un', pc: 'un', pç: 'un', pca: 'un', peca: 'un',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
  ml: 'ml',
};

/** kg/un/l… normalizado; null pra embalagem (cx, fd, pct, sc) — que precisa de fator. */
export function unidadeBase(u: string | null): string | null {
  if (!u) return null;
  return UNIDADE_IGUAL[u.toLowerCase().replace(/\./g, '').trim()] ?? null;
}

export interface ResultadoPedido {
  id: string;
  duplicada: boolean;
  emitNome: string | null;
  valorTotal: number;
  qtdItens: number;
  itensVinculados: number;
  fornecedorId: string | null;
  categoriaId: string | null;
  /** true = dá pra lançar sem ninguém olhar; false = `pendencias` diz o que falta */
  pronto: boolean;
  pendencias: string[];
}

/**
 * Grava o pedido lido como nota_compra (origem PEDIDO_FOTO) + itens + parcelas.
 * Vincula o insumo quando o fornecedor já vendeu aquele mesmo item (aprendido de
 * pedidos e notas anteriores) ou quando a IA reconheceu com certeza alta.
 * Não lança estoque nem conta a pagar — isso é o lancar-estoque de sempre.
 */
export async function gravarPedido(opts: {
  filialId: string;
  lido: PedidoLido;
  cat: CatalogoPedido;
  hash: string;
  storagePath: string;
}): Promise<ResultadoPedido> {
  const { filialId, lido, cat, hash, storagePath } = opts;
  const pendencias: string[] = [];

  // Fornecedor: CNPJ do papel manda; senão o que a IA reconheceu na lista.
  let fornecedor = lido.fornecedorCnpj ? cat.fornecedores.find((f) => f.cnpj === lido.fornecedorCnpj) : undefined;
  if (!fornecedor && lido.fornecedorIdx != null) fornecedor = cat.fornecedores[lido.fornecedorIdx];
  const fornecedorId = fornecedor?.id ?? null;
  if (!fornecedorId) {
    pendencias.push(
      lido.fornecedorNome
        ? `fornecedor "${lido.fornecedorNome}" não está no cadastro desta casa`
        : 'não deu pra ler o fornecedor no papel',
    );
  }

  // O que esse fornecedor já vendeu: descrição → insumo (o vínculo mais recente ganha).
  const aprendido = new Map<string, string>();
  const comFator = new Set<string>();
  if (fornecedorId) {
    const anteriores = await db
      .select({ descricao: schema.notaCompraItem.descricao, produtoId: schema.notaCompraItem.produtoId })
      .from(schema.notaCompraItem)
      .innerJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.notaCompraItem.notaCompraId))
      .where(
        and(
          eq(schema.notaCompra.filialId, filialId),
          eq(schema.notaCompra.fornecedorId, fornecedorId),
          isNotNull(schema.notaCompraItem.produtoId),
        ),
      )
      .orderBy(desc(schema.notaCompra.dataEmissao))
      .limit(3000);
    for (const a of anteriores) {
      const k = chaveDescricao(a.descricao);
      if (k && a.produtoId && !aprendido.has(k)) aprendido.set(k, a.produtoId);
    }
    const pfs = await db
      .select({ produtoId: schema.produtoFornecedor.produtoId, descricao: schema.produtoFornecedor.descricaoFornecedor })
      .from(schema.produtoFornecedor)
      .where(eq(schema.produtoFornecedor.fornecedorId, fornecedorId));
    for (const pf of pfs) {
      comFator.add(pf.produtoId);
      const k = chaveDescricao(pf.descricao);
      if (k && !aprendido.has(k)) aprendido.set(k, pf.produtoId);
    }
  }

  const porId = new Map(cat.produtos.map((p) => [p.id, p]));
  let semVinculo = 0;
  let semNumero = 0;
  let unidadeDiferente = 0;
  const itens = lido.itens.map((it, i) => {
    let produtoId = aprendido.get(chaveDescricao(it.descricao)) ?? null;
    if (produtoId && !porId.has(produtoId)) produtoId = null; // insumo saiu do catálogo
    if (!produtoId && it.produtoIdx != null && it.certeza === 'alta') produtoId = cat.produtos[it.produtoIdx]?.id ?? null;
    if (!produtoId) semVinculo++;
    if (!(Number(it.quantidade) > 0) || !(Number(it.valorTotal) > 0)) semNumero++;
    if (produtoId && !comFator.has(produtoId)) {
      // sem fator cadastrado pro par, a quantidade entra 1:1 — só serve se a unidade é a do estoque
      const uItem = unidadeBase(it.unidade);
      const uProd = unidadeBase(porId.get(produtoId)?.unidade ?? null);
      if (!uItem || uItem !== uProd) unidadeDiferente++;
    }
    return {
      filialId,
      numeroItem: i + 1,
      descricao: it.descricao,
      unidade: it.unidade,
      quantidade: it.quantidade != null ? it.quantidade.toFixed(4) : null,
      valorUnitario: it.valorUnitario != null ? it.valorUnitario.toFixed(6) : null,
      valorTotal: it.valorTotal != null ? it.valorTotal.toFixed(2) : null,
      produtoId,
    };
  });
  if (semVinculo > 0) pendencias.push(`${semVinculo} item(ns) sem insumo vinculado`);
  if (semNumero > 0) pendencias.push(`${semNumero} item(ns) sem quantidade ou valor legível`);
  if (unidadeDiferente > 0) {
    pendencias.push(`${unidadeDiferente} item(ns) em unidade diferente da do estoque (caixa, fardo…) — confira o fator`);
  }

  const soma = r2(lido.itens.reduce((a, it) => a + (it.valorTotal ?? 0), 0));
  const desconto = lido.desconto && lido.desconto > 0 ? lido.desconto : 0;
  const total = lido.total != null && lido.total > 0 ? r2(lido.total) : r2(soma - desconto);
  if (Math.abs(soma - desconto - total) > 0.05) {
    pendencias.push(`a soma dos itens (${(soma - desconto).toFixed(2)}) não bate com o total do papel (${total.toFixed(2)})`);
  }
  if (lido.legibilidade === 'baixa') pendencias.push('foto difícil de ler — confira os números');

  const dataPedido = lido.data ?? hojeBr();
  const somaVenc = r2(lido.vencimentos.reduce((a, v) => a + v.valor, 0));
  // Papel sem prazo (ou prazo que não fecha com o total): uma parcela na data do pedido.
  const parcelas =
    lido.vencimentos.length > 0 && Math.abs(somaVenc - total) <= 0.05
      ? lido.vencimentos
      : [{ data: lido.vencimentos.length === 1 ? lido.vencimentos[0].data : dataPedido, valor: total }];

  const numero = lido.numero && /^\d{1,9}$/.test(lido.numero) ? Number(lido.numero) : null;
  const obs = [
    lido.numero && numero == null ? `pedido ${lido.numero}` : null,
    lido.observacao,
  ].filter(Boolean).join(' · ');

  const [nova] = await db
    .insert(schema.notaCompra)
    .values({
      filialId,
      chave: chaveDoPedido(hash),
      numero,
      naturezaOperacao: (obs ? `Pedido sem nota — ${obs}` : 'Pedido sem nota').slice(0, 200),
      emitCnpj: lido.fornecedorCnpj ?? fornecedor?.cnpj ?? null,
      emitNome: lido.fornecedorNome ?? fornecedor?.nome ?? null,
      fornecedorId,
      dataEmissao: new Date(`${dataPedido}T12:00:00-03:00`),
      dataEntrada: new Date(),
      valorTotal: total.toFixed(2),
      valorProdutos: soma.toFixed(2),
      valorDesconto: desconto.toFixed(2),
      situacao: 'SEM NOTA',
      xmlStoragePath: storagePath,
      xmlHash: hash,
      origemImportacao: ORIGEM_PEDIDO_FOTO,
    })
    .returning({ id: schema.notaCompra.id });
  const notaCompraId = nova!.id;

  await db.insert(schema.notaCompraItem).values(itens.map((i) => ({ ...i, notaCompraId })));
  await db.insert(schema.notaCompraDuplicata).values(
    parcelas.map((p, i) => ({
      filialId,
      notaCompraId,
      numero: String(i + 1).padStart(3, '0'),
      dataVencimento: p.data,
      valor: p.valor.toFixed(2),
    })),
  );

  // Categoria que esse fornecedor mais usa no contas a pagar.
  let categoriaId: string | null = null;
  if (fornecedorId) {
    const [cat1] = await db
      .select({ categoriaId: schema.contaPagar.categoriaId, n: sql<number>`count(*)::int` })
      .from(schema.contaPagar)
      .where(
        and(
          eq(schema.contaPagar.filialId, filialId),
          eq(schema.contaPagar.fornecedorId, fornecedorId),
          isNotNull(schema.contaPagar.categoriaId),
          isNull(schema.contaPagar.dataDelete),
        ),
      )
      .groupBy(schema.contaPagar.categoriaId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
    categoriaId = cat1?.categoriaId ?? null;
  }

  return {
    id: notaCompraId,
    duplicada: false,
    emitNome: lido.fornecedorNome ?? fornecedor?.nome ?? null,
    valorTotal: total,
    qtdItens: itens.length,
    itensVinculados: itens.length - semVinculo,
    fornecedorId,
    categoriaId,
    pronto: pendencias.length === 0,
    pendencias,
  };
}
