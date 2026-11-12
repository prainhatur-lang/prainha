// "CHEGOU ESTOQUE E NÃO ESTÁ À VENDA" — a pergunta do sistema (dono, 11/11/2026):
// produto autorizado some e volta sozinho pelo estoque (@/lib/estoque-venda);
// na dúvida — entrou estoque de um produto que está DESLIGADO pro garçom, pro
// QR do cliente ou pro delivery — o sistema pergunta se é pra ligar.
//
// "Entrou estoque" = entrada (compra, transferência/pedido da Lelis, produção
// ou ajuste) nos últimos 30 dias, no próprio produto ou no insumo de revenda
// 1:1 dele (o vinho), e saldo acima de zero hoje. Só consulta.
import { and, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { carregarFichaDeVenda, revendaDaVariante } from '@/lib/estoque-venda';

export const DIAS_PERGUNTA = 30;
const ENTRADAS = ['ENTRADA_COMPRA', 'ENTRADA_TRANSFERENCIA', 'ENTRADA_PRODUCAO', 'ENTRADA_AJUSTE'];

export interface PerguntaVenda {
  varianteId: string;
  produtoId: string;
  /** produto que guarda o estoque (ele mesmo ou o insumo de revenda) */
  estoqueProdutoId: string;
  codigo: number | null;
  nome: string;
  tamanho: string | null;
  categoria: string | null;
  preco: number;
  estoque: number;
  /** AAAA-MM-DD (BRT) da última entrada */
  chegouEm: string | null;
  garcom: boolean;
  cliente: boolean;
  /** ativo = já vende · inativo = está no delivery mas desligado · fora = não está no delivery */
  delivery: 'ativo' | 'inativo' | 'fora';
  /** ligação pedida e ainda não aplicada pela loja (~1 min) */
  naFila: { garcom: boolean; cliente: boolean };
  dispensado: boolean;
}

export interface NegativoVenda {
  varianteId: string;
  estoqueProdutoId: string;
  codigo: number | null;
  nome: string;
  estoque: number;
}

export async function perguntasDeAtivacao(filialId: string): Promise<{
  /** a dúvida: chegou estoque e está desligado pro garçom, pro QR ou parado no delivery */
  perguntas: PerguntaVenda[];
  /** vende no salão (garçom + QR) e só não está no delivery — lista à parte, pra não virar barulho */
  soDelivery: PerguntaVenda[];
  dispensados: PerguntaVenda[];
  negativos: NegativoVenda[];
}> {
  const desde = new Date(Date.now() - DIAS_PERGUNTA * 86400_000);
  const [variantes, ficha, entradas, delivery, dispensas, fila] = await Promise.all([
    db
      .select({
        varianteId: schema.produtoVariante.id,
        produtoId: schema.produto.id,
        codigo: schema.produtoVariante.codigoExterno,
        nome: schema.produto.nome,
        tamanho: schema.produtoTamanho.descricao,
        categoria: schema.produtoEtiqueta.nome,
        preco: schema.produtoVariante.precoVenda,
        garcom: schema.produtoVariante.comandaMobile,
        cliente: schema.produtoVariante.cardapioDigital,
        controla: schema.produto.controlaEstoque,
        saldo: schema.produto.estoqueAtual,
      })
      .from(schema.produtoVariante)
      .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
      .leftJoin(schema.produtoTamanho, eq(schema.produtoTamanho.id, schema.produtoVariante.produtoTamanhoId))
      .leftJoin(
        schema.produtoEtiqueta,
        and(
          eq(schema.produtoEtiqueta.filialId, schema.produto.filialId),
          eq(sql`${schema.produtoEtiqueta.codigoExterno}::text`, schema.produto.codigoEtiqueta),
        ),
      )
      // mesmo recorte do cardápio da loja (catalogo-nuvem)
      .where(
        and(
          eq(schema.produtoVariante.filialId, filialId),
          eq(schema.produto.descontinuado, false),
          isNull(schema.produtoVariante.dataDelete),
          isNull(schema.produtoVariante.dataPausado),
          gt(schema.produtoVariante.precoVenda, '0'),
        ),
      ),
    carregarFichaDeVenda(filialId),
    db
      .select({
        produtoId: schema.movimentoEstoque.produtoId,
        ultima: sql<string>`to_char(max(${schema.movimentoEstoque.dataHora}) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
      })
      .from(schema.movimentoEstoque)
      .where(
        and(
          eq(schema.movimentoEstoque.filialId, filialId),
          inArray(schema.movimentoEstoque.tipo, ENTRADAS),
          gte(schema.movimentoEstoque.dataHora, desde),
        ),
      )
      .groupBy(schema.movimentoEstoque.produtoId),
    db
      .select({ varianteId: schema.deliveryItem.varianteId, ativo: schema.deliveryItem.ativo })
      .from(schema.deliveryItem)
      .where(eq(schema.deliveryItem.filialId, filialId)),
    db
      .select({ varianteId: schema.vendaPerguntaDispensa.varianteId })
      .from(schema.vendaPerguntaDispensa)
      .where(eq(schema.vendaPerguntaDispensa.filialId, filialId)),
    db
      .select({
        codigo: schema.produtoAlteracao.varianteCodigoExterno,
        campo: schema.produtoAlteracao.campo,
        valor: schema.produtoAlteracao.valor,
      })
      .from(schema.produtoAlteracao)
      .where(
        and(
          eq(schema.produtoAlteracao.filialId, filialId),
          eq(schema.produtoAlteracao.status, 'pendente'),
          inArray(schema.produtoAlteracao.campo, ['comanda_mobile', 'cardapio_digital']),
        ),
      ),
  ]);

  const chegou = new Map(entradas.map((e) => [e.produtoId, e.ultima]));
  const noDelivery = new Map<string, boolean>();
  for (const d of delivery) {
    if (!d.varianteId) continue;
    noDelivery.set(d.varianteId, noDelivery.get(d.varianteId) === true || d.ativo === true);
  }
  const dispensado = new Set(dispensas.map((d) => d.varianteId));
  const ligando = (campo: string, codigo: number | null) =>
    codigo != null &&
    fila.some((f) => f.codigo === codigo && f.campo === campo && /^(true|1|s|sim)$/i.test(String(f.valor ?? '')));

  const perguntas: PerguntaVenda[] = [];
  const soDelivery: PerguntaVenda[] = [];
  const dispensados: PerguntaVenda[] = [];
  const negativos: NegativoVenda[] = [];
  for (const v of variantes) {
    // quem guarda o estoque: o próprio produto, ou o insumo da revenda 1:1
    let estoqueProdutoId = v.produtoId;
    let estoque: number | null = null;
    if (v.controla) estoque = Number(v.saldo ?? 0);
    else {
      const r = revendaDaVariante(v, ficha);
      if (r) {
        estoqueProdutoId = r.insumoId;
        estoque = r.saldo;
      }
    }
    if (estoque == null) continue;
    const garcom = v.garcom !== false;
    const cliente = v.cliente === true;
    if (estoque < 0) {
      // saldo negativo num produto que está vendendo: ninguém conferiu o estoque
      if (garcom || cliente) {
        negativos.push({ varianteId: v.varianteId, estoqueProdutoId, codigo: v.codigo, nome: v.nome ?? '', estoque });
      }
      continue;
    }
    if (estoque === 0) continue;
    const chegouEm = chegou.get(estoqueProdutoId) ?? null;
    if (!chegouEm) continue;
    const d = noDelivery.get(v.varianteId);
    const deliv: PerguntaVenda['delivery'] = d === true ? 'ativo' : d === false ? 'inativo' : 'fora';
    if (garcom && cliente && deliv === 'ativo') continue;
    const linha: PerguntaVenda = {
      varianteId: v.varianteId,
      produtoId: v.produtoId,
      estoqueProdutoId,
      codigo: v.codigo,
      nome: v.nome ?? '',
      tamanho: v.tamanho,
      categoria: v.categoria,
      preco: Number(v.preco),
      estoque,
      chegouEm,
      garcom,
      cliente,
      delivery: deliv,
      naFila: { garcom: ligando('comanda_mobile', v.codigo), cliente: ligando('cardapio_digital', v.codigo) },
      dispensado: dispensado.has(v.varianteId),
    };
    if (linha.dispensado) dispensados.push(linha);
    else if (garcom && cliente && deliv === 'fora') soDelivery.push(linha);
    else perguntas.push(linha);
  }
  const ordem = (a: PerguntaVenda, b: PerguntaVenda) =>
    (b.chegouEm ?? '').localeCompare(a.chegouEm ?? '') || a.nome.localeCompare(b.nome, 'pt-BR');
  perguntas.sort(ordem);
  soDelivery.sort(ordem);
  dispensados.sort(ordem);
  negativos.sort((a, b) => a.estoque - b.estoque);
  return { perguntas, soDelivery, dispensados, negativos };
}
