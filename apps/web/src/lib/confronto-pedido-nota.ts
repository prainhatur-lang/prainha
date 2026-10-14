// Confronto pedido de compra × nota de entrada, item a item.
//
// Pedido do dono (13/10/2026): ao abrir a nota na Entrada de Notas, ver o que
// foi PEDIDO contra o que foi FATURADO e a diferença — se a nota veio diferente
// do pedido, é pra questionar o fornecedor.
//
// Só LEITURA: não grava vínculo, não mexe em pedido nem em nota. Por isso
// funciona mesmo quando o vínculo automático (match-pedido-nf) não ligou nada.
//
// Como acha o pedido de cada item da nota:
//  - mesmo fornecedor (mesma linha, mesmo grupo, mesma raiz de CNPJ ou mesmo
//    nome — o pedido costuma sair num cadastro sem CNPJ e a nota chegar noutro);
//  - mesmo insumo (produto_id do item da nota = produto_id do item do pedido)
//    ou, sobrando item dos dois lados, mesmo valor no centavo;
//  - pedido feito até JANELA_DIAS antes da emissão; havendo mais de um, ganha o
//    mais recente (o fornecedor junta pedidos numa nota e parte um pedido em
//    várias).
// Unidade do pedido e da nota quase nunca é a mesma (kg × UND, ml × UND), então
// a comparação é pelo TOTAL da linha; quantidade e preço só explicam o motivo.

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { dateToBrYmd } from '@/lib/datas';
import { foneParaWhatsapp } from '@/lib/vendedor-fone';

const JANELA_DIAS = 15;
const TOLERANCIA = 0.05;

const GENERICAS = new Set([
  'DISTRIBUIDORA', 'DISTRIBUIDOR', 'ALIMENTOS', 'COMERCIO', 'COMERCIAL', 'COM', 'LTDA', 'ME', 'EPP',
  'EIRELI', 'SA', 'INDUSTRIA', 'INDUSTRIAL', 'IMPORTADORA', 'BEBIDAS', 'EMBALAGENS', 'MATERIAIS',
  'DE', 'DA', 'DO', 'DOS', 'DAS',
]);

function tokensNome(nome: string | null | undefined): string[] {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !GENERICAS.has(t))
    // MEGA × MEGGA
    .map((t) => t.replace(/(.)\1+/g, '$1'));
}

function raizCnpj(doc: string | null | undefined): string | null {
  const d = (doc ?? '').replace(/\D/g, '');
  return d.length === 14 ? d.slice(0, 8) : null;
}

interface Identidade {
  id?: string | null;
  nome?: string | null;
  cnpj?: string | null;
  grupo?: string | null;
}

function mesmoFornecedor(a: Identidade, b: Identidade): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  if (a.grupo && b.grupo && a.grupo === b.grupo) return true;
  const ra = raizCnpj(a.cnpj);
  const rb = raizCnpj(b.cnpj);
  if (ra && rb) return ra === rb;
  const ta = new Set(tokensNome(a.nome));
  const tb = new Set(tokensNome(b.nome));
  if (ta.size === 0 || tb.size === 0) return false;
  const comuns = [...ta].filter((t) => tb.has(t)).length;
  return comuns >= 2 || (comuns === ta.size && comuns === tb.size);
}

const diaNum = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

export type SituacaoConfronto = 'OK' | 'PRECO' | 'QUANTIDADE' | 'VALOR';

export interface LinhaConfronto {
  pedidoId: string;
  pedidoNumero: number;
  produtoNome: string;
  pedQtd: number;
  pedUnidade: string;
  pedPreco: number;
  pedTotal: number;
  /** O que ESTA nota faturou desse item */
  notaQtd: number;
  notaUnidade: string | null;
  /** Como o item está escrito na nota */
  notaDescricao: string;
  /** Casado pelo valor (insumo da nota é outro cadastro ou está sem vínculo) */
  porValor: boolean;
  notaPreco: number;
  notaTotal: number;
  /** Mesmo item do pedido faturado também em outras notas */
  outrasNotas: number[];
  outrasTotal: number;
  /** (esta nota + outras) − pedido. Positivo = cobraram a mais. */
  diferenca: number;
  situacao: SituacaoConfronto;
}

export interface ItemSolto {
  descricao: string;
  quantidade: number;
  unidade: string | null;
  total: number;
}

export interface PedidoEnvolvido {
  id: string;
  numero: number;
  data: string; // YYYY-MM-DD (BRT)
  valorTotal: number;
  status: string;
  fornecedorNome: string | null;
  fornecedorFone: string | null;
}

export interface ConfrontoNota {
  /** Pedidos que têm item nesta nota */
  pedidos: PedidoEnvolvido[];
  linhas: LinhaConfronto[];
  /** Na nota, com insumo vinculado, e em pedido nenhum do período */
  foraDoPedido: ItemSolto[];
  /** Na nota, sem insumo vinculado e sem item de pedido com o mesmo valor */
  semVinculo: ItemSolto[];
  /** Nos pedidos envolvidos e em nota nenhuma do fornecedor */
  naoVieram: { pedidoNumero: number; produtoNome: string; quantidade: number; unidade: string; total: number }[];
  /** Pedidos do fornecedor no período que não bateram com nenhum item desta nota */
  pedidosSemItem: PedidoEnvolvido[];
  totalPedido: number;
  totalNota: number;
  diferenca: number;
}

export async function confrontoDaNota(notaId: string): Promise<ConfrontoNota | null> {
  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      emitCnpj: schema.notaCompra.emitCnpj,
      emitNome: schema.notaCompra.emitNome,
      dataEmissao: schema.notaCompra.dataEmissao,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, notaId))
    .limit(1);
  if (!nota?.dataEmissao) return null;

  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      cnpj: schema.fornecedor.cnpjOuCpf,
      grupo: schema.fornecedor.grupoEconomicoId,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.filialId, nota.filialId));

  const daNota = fornecedores.find((f) => f.id === nota.fornecedorId);
  const identidades: Identidade[] = [{ nome: nota.emitNome, cnpj: nota.emitCnpj }];
  if (daNota) identidades.push(daNota);
  const equivalentes = fornecedores.filter((f) => identidades.some((i) => mesmoFornecedor(f, i)));
  if (equivalentes.length === 0) return null;
  const idsForn = equivalentes.map((f) => f.id);
  const raizes = [...new Set([nota.emitCnpj, ...equivalentes.map((f) => f.cnpj)].map(raizCnpj).filter((r): r is string => !!r))];

  const emissao = nota.dataEmissao;
  const DIA = 86_400_000;
  const pedidosRows = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      status: schema.pedidoCompra.status,
      valorTotal: schema.pedidoCompra.valorTotal,
      criadoEm: schema.pedidoCompra.criadoEm,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorFone: foneParaWhatsapp(),
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(
      and(
        eq(schema.pedidoCompra.filialId, nota.filialId),
        inArray(schema.pedidoCompra.fornecedorId, idsForn),
        notInArray(schema.pedidoCompra.status, ['CANCELADO', 'RECUSADO']),
        gte(schema.pedidoCompra.criadoEm, new Date(emissao.getTime() - (JANELA_DIAS + 1) * DIA)),
        lte(schema.pedidoCompra.criadoEm, new Date(emissao.getTime() + DIA)),
      ),
    );
  const diaNota = diaNum(dateToBrYmd(emissao));
  const pedidos = pedidosRows
    .map((p) => ({ ...p, data: dateToBrYmd(p.criadoEm), dia: diaNum(dateToBrYmd(p.criadoEm)) }))
    .filter((p) => p.dia <= diaNota && diaNota - p.dia <= JANELA_DIAS);
  if (pedidos.length === 0) return null;

  const itensPedido = await db
    .select({
      id: schema.pedidoCompraItem.id,
      pedidoId: schema.pedidoCompraItem.pedidoCompraId,
      produtoId: schema.pedidoCompraItem.produtoId,
      produtoNome: schema.produto.nome,
      quantidade: schema.pedidoCompraItem.quantidade,
      unidade: schema.pedidoCompraItem.unidade,
      precoUnitario: schema.pedidoCompraItem.precoUnitario,
      valorTotal: schema.pedidoCompraItem.valorTotal,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .where(inArray(schema.pedidoCompraItem.pedidoCompraId, pedidos.map((p) => p.id)));

  // Todas as notas do fornecedor que podem ter faturado esses pedidos — pra
  // saber o que veio em OUTRA nota e o que não veio em nenhuma.
  const menorDia = Math.min(...pedidos.map((p) => p.dia));
  const maiorDia = Math.max(...pedidos.map((p) => p.dia));
  const mesmoEmitente = raizes.length
    ? sql`(${inArray(schema.notaCompra.fornecedorId, idsForn)} OR left(${schema.notaCompra.emitCnpj}, 8) IN ${raizes})`
    : inArray(schema.notaCompra.fornecedorId, idsForn);
  const notasRows = await db
    .select({
      id: schema.notaCompra.id,
      numero: schema.notaCompra.numero,
      situacao: schema.notaCompra.situacao,
      dataEmissao: schema.notaCompra.dataEmissao,
    })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, nota.filialId),
        mesmoEmitente,
        sql`coalesce(${schema.notaCompra.situacao}, '') <> 'CANCELADA'`,
        gte(schema.notaCompra.dataEmissao, new Date((menorDia - 1) * DIA)),
        lte(schema.notaCompra.dataEmissao, new Date((maiorDia + JANELA_DIAS + 2) * DIA)),
      ),
    );
  // Pedido escaneado (SEM NOTA) cuja nota de verdade já chegou: conta uma vez só.
  const numerosComNota = new Set(
    notasRows.filter((n) => n.situacao !== 'SEM NOTA' && n.numero != null).map((n) => n.numero),
  );
  const notas = notasRows
    .filter((n) => n.id === nota.id || !(n.situacao === 'SEM NOTA' && numerosComNota.has(n.numero)))
    .filter((n) => n.dataEmissao)
    .map((n) => ({ ...n, dia: diaNum(dateToBrYmd(n.dataEmissao!)) }));
  if (!notas.some((n) => n.id === nota.id)) return null;
  const notaPorId = new Map(notas.map((n) => [n.id, n]));

  const itensNota = await db
    .select({
      id: schema.notaCompraItem.id,
      notaId: schema.notaCompraItem.notaCompraId,
      produtoId: schema.notaCompraItem.produtoId,
      descricao: schema.notaCompraItem.descricao,
      quantidade: schema.notaCompraItem.quantidade,
      unidade: schema.notaCompraItem.unidade,
      valorTotal: schema.notaCompraItem.valorTotal,
      valorDesconto: schema.notaCompraItem.valorDesconto,
    })
    .from(schema.notaCompraItem)
    .where(inArray(schema.notaCompraItem.notaCompraId, notas.map((n) => n.id)));

  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));

  // item do pedido → linhas de nota que caíram nele
  type Parte = { notaId: string; descricao: string; qtd: number; unidade: string | null; total: number; porValor: boolean };
  const caiu = new Map<string, Parte[]>();
  const fechado = new Set<string>(); // item de pedido que já bateu no centavo
  const foraDoPedido: ItemSolto[] = [];
  const semVinculo: ItemSolto[] = [];

  const soltos = itensNota
    .map((inf) => {
      const n = notaPorId.get(inf.notaId)!;
      return {
        notaId: inf.notaId,
        dia: n.dia,
        produtoId: inf.produtoId,
        descricao: inf.descricao ?? '(sem descrição)',
        qtd: Number(inf.quantidade ?? 0),
        unidade: inf.unidade,
        total: Math.round((Number(inf.valorTotal ?? 0) - Number(inf.valorDesconto ?? 0)) * 100) / 100,
        alocado: false,
      };
    })
    .sort((a, b) => a.dia - b.dia);
  type Solto = (typeof soltos)[number];

  const naJanela = (s: Solto) =>
    itensPedido
      .map((ip) => ({ ip, ped: pedidoPorId.get(ip.pedidoId)! }))
      .filter(({ ped }) => ped.dia <= s.dia && s.dia - ped.dia <= JANELA_DIAS)
      .sort((a, b) => b.ped.dia - a.ped.dia || a.ped.numero - b.ped.numero);
  const aloca = (s: Solto, ipId: string, porValor: boolean) => {
    const l = caiu.get(ipId) ?? [];
    l.push({ notaId: s.notaId, descricao: s.descricao, qtd: s.qtd, unidade: s.unidade, total: s.total, porValor });
    caiu.set(ipId, l);
    s.alocado = true;
  };
  const bate = (s: Solto, ip: (typeof itensPedido)[number]) =>
    Math.abs(s.total - Number(ip.valorTotal)) <= TOLERANCIA;

  // 1ª passada — mesmo insumo E mesmo valor: bateu, fecha.
  for (const s of soltos) {
    if (!s.produtoId) continue;
    const c = naJanela(s).find(({ ip }) => ip.produtoId === s.produtoId && !fechado.has(ip.id) && bate(s, ip));
    if (c) { aloca(s, c.ip.id, false); fechado.add(c.ip.id); }
  }
  // 2ª passada — mesmo valor no centavo, insumo diferente ou sem vínculo. O
  // item da nota costuma estar ligado a outro cadastro do mesmo produto (ou a
  // nenhum); sem isso o confronto acusa "não veio" + "fora do pedido" pro mesmo
  // item. Caso real: NF 8882 da LJQO, "GAS PARA MACARICO" × pedido "MAÇARICO".
  for (const s of soltos) {
    if (s.alocado || s.total <= 0) continue;
    const cands = naJanela(s).filter(({ ip }) => !fechado.has(ip.id) && !caiu.has(ip.id) && bate(s, ip));
    const c = cands.find(({ ip }) => Math.abs(Number(ip.quantidade) - s.qtd) < 0.0001) ?? cands[0];
    if (c) { aloca(s, c.ip.id, true); fechado.add(c.ip.id); }
  }
  // 2ª passada (b) — o pedido tinha uma linha e a nota abriu em duas (luva G e
  // luva M, 47 + 47 = os 94 do pedido): duas linhas da mesma nota que somam.
  for (const ip of itensPedido) {
    if (fechado.has(ip.id) || caiu.has(ip.id)) continue;
    const ped = pedidoPorId.get(ip.pedidoId)!;
    const livres = soltos.filter((s) => !s.alocado && s.total > 0 && ped.dia <= s.dia && s.dia - ped.dia <= JANELA_DIAS);
    let par: [Solto, Solto] | null = null;
    for (let i = 0; i < livres.length && !par; i++) {
      for (let j = i + 1; j < livres.length; j++) {
        if (livres[i].notaId !== livres[j].notaId) continue;
        if (Math.abs(livres[i].total + livres[j].total - Number(ip.valorTotal)) <= TOLERANCIA) {
          par = [livres[i], livres[j]];
          break;
        }
      }
    }
    if (par) {
      aloca(par[0], ip.id, true);
      aloca(par[1], ip.id, true);
      fechado.add(ip.id);
    }
  }
  // 3ª passada — mesmo insumo com valor diferente: é a divergência.
  for (const s of soltos) {
    if (s.alocado) continue;
    const solto: ItemSolto = { descricao: s.descricao, quantidade: s.qtd, unidade: s.unidade, total: s.total };
    const c = s.produtoId
      ? naJanela(s).find(({ ip }) => ip.produtoId === s.produtoId && !fechado.has(ip.id))
      : undefined;
    if (c) aloca(s, c.ip.id, false);
    else if (s.notaId === nota.id) (s.produtoId ? foraDoPedido : semVinculo).push(solto);
  }

  const linhas: LinhaConfronto[] = [];
  const envolvidos = new Set<string>();
  for (const ip of itensPedido) {
    const partes = caiu.get(ip.id) ?? [];
    const desta = partes.filter((p) => p.notaId === nota.id);
    if (desta.length === 0) continue;
    const outras = partes.filter((p) => p.notaId !== nota.id);
    const ped = pedidoPorId.get(ip.pedidoId)!;
    envolvidos.add(ped.id);
    const pedQtd = Number(ip.quantidade);
    const pedPreco = Number(ip.precoUnitario);
    const pedTotal = Number(ip.valorTotal);
    const notaQtd = desta.reduce((a, p) => a + p.qtd, 0);
    const notaTotal = desta.reduce((a, p) => a + p.total, 0);
    const outrasTotal = outras.reduce((a, p) => a + p.total, 0);
    const qtdTudo = notaQtd + outras.reduce((a, p) => a + p.qtd, 0);
    const totalTudo = notaTotal + outrasTotal;
    const diferenca = Math.round((totalTudo - pedTotal) * 100) / 100;
    let situacao: SituacaoConfronto = 'OK';
    if (Math.abs(diferenca) > TOLERANCIA) {
      if (Math.abs(qtdTudo - pedQtd) < 0.0001) situacao = 'PRECO';
      else if (qtdTudo > 0 && Math.abs(totalTudo / qtdTudo - pedPreco) <= 0.01) situacao = 'QUANTIDADE';
      else situacao = 'VALOR';
    }
    linhas.push({
      pedidoId: ped.id,
      pedidoNumero: ped.numero,
      produtoNome: ip.produtoNome ?? '(sem nome)',
      pedQtd,
      pedUnidade: ip.unidade,
      pedPreco,
      pedTotal,
      notaQtd,
      notaUnidade: desta[0].unidade,
      notaDescricao: desta.map((p) => p.descricao).join(' + '),
      porValor: desta.some((p) => p.porValor),
      notaPreco: notaQtd > 0 ? notaTotal / notaQtd : 0,
      notaTotal,
      outrasNotas: [...new Set(outras.map((p) => notaPorId.get(p.notaId)?.numero).filter((x): x is number => x != null))],
      outrasTotal,
      diferenca,
      situacao,
    });
  }
  linhas.sort((a, b) => a.pedidoNumero - b.pedidoNumero || Math.abs(b.diferenca) - Math.abs(a.diferenca));

  const paraTela = (p: (typeof pedidos)[number]): PedidoEnvolvido => ({
    id: p.id,
    numero: p.numero,
    data: p.data,
    valorTotal: Number(p.valorTotal ?? 0),
    status: p.status,
    fornecedorNome: p.fornecedorNome,
    fornecedorFone: p.fornecedorFone,
  });

  const naoVieram = itensPedido
    .filter((ip) => envolvidos.has(ip.pedidoId) && !(caiu.get(ip.id)?.length))
    .map((ip) => ({
      pedidoNumero: pedidoPorId.get(ip.pedidoId)!.numero,
      produtoNome: ip.produtoNome ?? '(sem nome)',
      quantidade: Number(ip.quantidade),
      unidade: ip.unidade,
      total: Number(ip.valorTotal),
    }));

  const totalPedido = linhas.reduce((a, l) => a + l.pedTotal, 0);
  const totalNota = linhas.reduce((a, l) => a + l.notaTotal + l.outrasTotal, 0);
  return {
    pedidos: pedidos.filter((p) => envolvidos.has(p.id)).sort((a, b) => a.numero - b.numero).map(paraTela),
    linhas,
    foraDoPedido,
    semVinculo,
    naoVieram,
    pedidosSemItem: pedidos.filter((p) => !envolvidos.has(p.id)).sort((a, b) => a.numero - b.numero).map(paraTela),
    totalPedido,
    totalNota,
    diferenca: Math.round((totalNota - totalPedido) * 100) / 100,
  };
}
