// Orçamento de evento AUTOMÁTICO da Tabuará, montado pelo atendente virtual.
//
// Regras do dono (03/11/2026):
//  - Espaços: salão interno (59 lugares, conta 60) + área externa (10 mesas
//    de 4 = 40). Casa toda ≈ 100.
//  - Taxa de fechamento: R$ 35 por LUGAR VAZIO do espaço fechado. Ex.: fechar
//    o interno com 20 pessoas → (60 − 20) × 35. Fechar os dois → o vazio de
//    fora também paga R$ 35 por lugar. Sem fechar nada → sem taxa (mesas
//    reservadas com a casa aberta).
//  - Isenção (dono, 03/11): a partir de 40 pessoas no salão interno não cobra
//    a diferença; a partir de 25 na área externa (varanda), idem. Casa toda:
//    isenta a partir de 65 (40 + 25).
//  - Pacotes por pessoa:
//      econômico R$ 200 — menu convidativo da casa + bebidas sem álcool;
//      premium R$ 275 — melhores pratos à escolha do cliente, entradas livres,
//                       bebidas sem álcool;
//      premium com álcool R$ 360 — o premium + bebidas alcoólicas.
//  - Entrada (Pix pelo link) = a taxa de fechamento. Sem fechar → a equipe
//    combina a entrada. Espaço fechado ISENTO da taxa (grupo grande) → entrada
//    de 30% do total (dono, 03/11).
//  - Esta regra substitui o piso interno de R$ 12.000 pra exclusividade.

import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { buscarItensCardapio } from './cardapio';
import { descontoEspacoMembro } from '@/lib/fidelidade/membro';
import type { PratoOrcamento } from '@concilia/db/schema';

export const TABUARA_LUGARES_INTERNO = 60;
export const TABUARA_LUGARES_EXTERNO = 40;
export const TABUARA_TAXA_LUGAR_VAZIO = 35;
export const TABUARA_ISENTA_INTERNO = 40;
export const TABUARA_ISENTA_EXTERNO = 25;
const MINIMO_PESSOAS = 3;
const VALIDADE_DIAS = 7;
export const TABUARA_ENTRADA_ISENTO_PCT = 0.3;

export type EspacoTabuara = 'sem_fechar' | 'interno' | 'externo' | 'casa_toda';
export type PacoteTabuara = 'economico' | 'premium' | 'premium_alcool';

export const PACOTES_TABUARA: Record<PacoteTabuara, { nome: string; valor: number; descricao: string }> = {
  economico: {
    nome: 'Pacote econômico',
    valor: 200,
    descricao: 'menu convidativo da casa, com bebidas sem álcool',
  },
  premium: {
    nome: 'Menu premium',
    valor: 275,
    descricao: 'os melhores pratos da casa à escolha do cliente, entradas livres, bebidas sem álcool',
  },
  premium_alcool: {
    nome: 'Menu premium com bebidas alcoólicas',
    valor: 360,
    descricao: 'os melhores pratos da casa à escolha do cliente, entradas livres, bebidas com e sem álcool',
  },
};

// O primeiro termo do local é a chave que a rota do Pix usa pra barrar duas
// entradas no mesmo dia (eventoQueSeguraData) — por isso nomes distintos.
const ESPACOS: Record<EspacoTabuara, { local: string; rotulo: string; lugares: number; isentaAPartir: number }> = {
  sem_fechar: { local: 'Mesas reservadas sem fechar', rotulo: 'mesas reservadas, sem fechar a casa', lugares: TABUARA_LUGARES_INTERNO + TABUARA_LUGARES_EXTERNO, isentaAPartir: 0 },
  interno: { local: 'Salão interno fechado', rotulo: 'salão interno fechado só pro grupo', lugares: TABUARA_LUGARES_INTERNO, isentaAPartir: TABUARA_ISENTA_INTERNO },
  externo: { local: 'Área externa fechada', rotulo: 'área externa fechada só pro grupo', lugares: TABUARA_LUGARES_EXTERNO, isentaAPartir: TABUARA_ISENTA_EXTERNO },
  casa_toda: { local: 'Salão interno + área externa (casa toda)', rotulo: 'casa toda fechada só pro grupo (salão interno + área externa)', lugares: TABUARA_LUGARES_INTERNO + TABUARA_LUGARES_EXTERNO, isentaAPartir: TABUARA_ISENTA_INTERNO + TABUARA_ISENTA_EXTERNO },
};

/** Taxa de fechamento: R$ 35 por lugar vazio do espaço fechado (isento a partir do mínimo do espaço). */
export function taxaFechamentoTabuara(espaco: EspacoTabuara, pessoas: number): number {
  if (espaco === 'sem_fechar') return 0;
  if (pessoas >= ESPACOS[espaco].isentaAPartir) return 0;
  return Math.max(ESPACOS[espaco].lugares - pessoas, 0) * TABUARA_TAXA_LUGAR_VAZIO;
}

function dobrar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Já tem evento PAGO que ocupa esse espaço nesse dia? */
async function espacoOcupado(filialId: string, espaco: EspacoTabuara, data: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT local FROM orcamento_evento
    WHERE filial_id = ${filialId}
      AND data_evento = ${data}::date
      AND pagamento_status = 'pago'
  `)) as unknown as Array<{ local: string | null }>;
  for (const r of rows) {
    const l = dobrar(r.local ?? '');
    const casaToda = l.includes('casa toda') || l.includes('casa inteira');
    const interno = casaToda || l.includes('interno') || l.includes('salao');
    const externo = casaToda || l.includes('externa') || l.includes('externo');
    if (casaToda) return r.local;
    if (espaco === 'casa_toda' && (interno || externo)) return r.local;
    if (espaco === 'interno' && interno) return r.local;
    if (espaco === 'externo' && externo) return r.local;
  }
  return null;
}

/** Nome do cardápio pro prato pedido (ignora pausado). Sem achar → o texto do cliente. */
async function nomeDoCardapio(filialId: string, pedido: string): Promise<{ nome: string; achou: boolean }> {
  const t = pedido.trim().slice(0, 120);
  const achados = (await buscarItensCardapio(filialId, t, 4).catch(() => [])).filter((i) => !i.pausado);
  return achados.length > 0 ? { nome: achados[0].nome, achou: true } : { nome: t, achou: false };
}

export interface PedidoOrcamentoTabuara {
  filialId: string;
  filialNome: string;
  telefone: string;
  nomeCliente: string;
  espaco: EspacoTabuara;
  pacote: PacoteTabuara;
  data: string; // YYYY-MM-DD
  hora: string | null;
  pessoas: number;
  entradas?: string[];
  principais?: string[];
  sobremesa?: string | null;
  tipoEvento?: string | null;
  observacoes?: string | null;
}

export async function gerarOrcamentoTabuara(p: PedidoOrcamentoTabuara): Promise<string> {
  const esp = ESPACOS[p.espaco];
  const pac = PACOTES_TABUARA[p.pacote];
  if (!esp) return 'Espaço inválido: use sem_fechar, interno, externo ou casa_toda.';
  if (!pac) return 'Pacote inválido: use economico, premium ou premium_alcool.';
  const pessoas = Math.round(p.pessoas);
  if (!pessoas || pessoas < 1) return 'Preciso do número de pessoas (pode ser uma estimativa, ex.: 40).';
  if (pessoas < MINIMO_PESSOAS) {
    return `Pra ${pessoas} pessoa(s) não precisa de orçamento de evento: ofereça uma reserva normal de mesa.`;
  }
  const total = TABUARA_LUGARES_INTERNO + TABUARA_LUGARES_EXTERNO;
  if (pessoas > total) {
    return `A Tabuará comporta cerca de ${total} pessoas (casa toda). Pra ${pessoas} pessoas, registre o lead com tudo que o cliente contou e transfira pra equipe pensar num formato — não gere orçamento.`;
  }
  if (p.espaco !== 'sem_fechar' && pessoas > esp.lugares) {
    const sugestao = p.espaco === 'externo' && pessoas <= TABUARA_LUGARES_INTERNO ? 'o salão interno (60 lugares) ou a casa toda (100)' : 'a casa toda (100 lugares)';
    return `${p.espaco === 'externo' ? 'A área externa' : 'O salão interno'} tem ${esp.lugares} lugares e o grupo é de ${pessoas}. Explique e ofereça ${sugestao}; com a escolha do cliente, chame gerar_orcamento_tabuara de novo.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) return 'Data inválida (YYYY-MM-DD).';
  if (p.data < hojeBr()) return 'A data do evento já passou — peça uma data futura.';
  const ocupado = await espacoOcupado(p.filialId, p.espaco, p.data);
  if (ocupado) {
    return `DATA INDISPONÍVEL: em ${p.data.split('-').reverse().join('/')} já tem evento com entrada paga ocupando "${ocupado}". NÃO gere orçamento desse espaço pra esse dia: conte com jeito e ofereça outra data${p.espaco === 'casa_toda' ? '' : ' ou outro espaço'}.`;
  }
  if (!p.nomeCliente.trim()) {
    return 'Falta o nome do cliente — PERGUNTE agora, numa frase curta ("pra deixar o orçamento no seu nome, como você se chama?"), e chame gerar_orcamento_tabuara de novo. NÃO registre lead nem transfira por isso, e NÃO use o nome do perfil do WhatsApp.';
  }

  // Pratos escolhidos (só no premium). Sem escolha → a equipe fecha o menu.
  const pratos: PratoOrcamento[] = [];
  const naoAchados: string[] = [];
  const premium = p.pacote !== 'economico';
  if (premium) {
    for (const e of (p.entradas ?? []).filter((x) => x?.trim()).slice(0, 8)) {
      const r = await nomeDoCardapio(p.filialId, e);
      if (!r.achou) naoAchados.push(r.nome);
      pratos.push({ nome: r.nome, regime: 'livre', secao: 'entrada' });
    }
    for (const e of (p.principais ?? []).filter((x) => x?.trim()).slice(0, 8)) {
      const r = await nomeDoCardapio(p.filialId, e);
      if (!r.achou) naoAchados.push(r.nome);
      pratos.push({ nome: r.nome, regime: 'limitado', qtd: '1 por pessoa', secao: 'principal' });
    }
    if (p.sobremesa?.trim()) {
      const r = await nomeDoCardapio(p.filialId, p.sobremesa);
      if (!r.achou) naoAchados.push(r.nome);
      pratos.push({ nome: r.nome, regime: 'limitado', qtd: '1 por pessoa', secao: 'sobremesa' });
    }
  }
  if (pratos.length > 0 || p.pacote === 'economico') {
    if (p.pacote === 'economico') {
      pratos.push({ nome: 'Menu convidativo da casa', descricao: 'entradas e pratos definidos pela casa', regime: 'livre', secao: 'principal' });
    }
    pratos.push({ nome: 'Refrigerante, água, suco e água de coco', regime: 'livre', secao: 'bebida_sem_alcool' });
    if (p.pacote === 'premium_alcool') {
      pratos.push({ nome: 'Bebidas alcoólicas do pacote', descricao: 'cerveja e drinks da casa; rótulos fechados com a equipe', regime: 'livre', secao: 'bebida_com_alcool' });
    }
  }

  const taxa = taxaFechamentoTabuara(p.espaco, pessoas);
  const vazios = p.espaco === 'sem_fechar' ? 0 : esp.lugares - pessoas;
  const isento = p.espaco !== 'sem_fechar' && taxa === 0;
  const descEspaco = taxa > 0 ? await descontoEspacoMembro(p.filialId, p.telefone, null, taxa).catch(() => null) : null;
  const taxaLiquida = Math.max(taxa - (descEspaco?.desconto ?? 0), 0);
  const subtotal = pac.valor * pessoas;
  const totalGeral = subtotal + taxaLiquida;
  const entrada = isento
    ? Math.round(totalGeral * TABUARA_ENTRADA_ISENTO_PCT * 100) / 100
    : taxaLiquida >= 1 ? Math.round(taxaLiquida * 100) / 100 : null;
  const origemEntrada = isento ? `${Math.round(TABUARA_ENTRADA_ISENTO_PCT * 100)}% do total` : 'a taxa de fechamento';
  const aceiteToken = randomBytes(32).toString('hex');
  const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
  const tipo = p.tipoEvento?.trim() ? p.tipoEvento.trim().slice(0, 120) : null;
  const dataBr = p.data.split('-').reverse().join('/');

  const condTaxa =
    p.espaco === 'sem_fechar'
      ? 'Mesas reservadas pro grupo com a casa aberta ao público (sem taxa de fechamento). '
      : isento
        ? `Sem taxa de fechamento: grupo a partir de ${esp.isentaAPartir} pessoas não paga os lugares vazios deste espaço. `
        : `Taxa de fechamento: R$ ${TABUARA_TAXA_LUGAR_VAZIO} por lugar vazio do espaço fechado (${esp.lugares} lugares − ${pessoas} pessoas = ${vazios} lugares vazios = ${rs(taxa)}). `;

  await db.insert(schema.orcamentoEvento).values({
    filialId: p.filialId,
    local: `${esp.local} (${p.filialNome})`,
    clienteNome: p.nomeCliente.trim().slice(0, 200),
    clienteTelefone: p.telefone,
    dataEvento: p.data,
    hora: p.hora,
    pessoas,
    valorPessoa: pac.valor.toFixed(2),
    pratos,
    sobremesaIncluida: pratos.some((x) => x.secao === 'sobremesa'),
    sobremesaDescricao: null,
    taxaEspaco: null,
    taxaExclusividade: taxa > 0 ? taxa.toFixed(2) : null,
    descontoEspaco: descEspaco ? descEspaco.desconto.toFixed(2) : null,
    descontoEspacoMotivo: descEspaco?.motivo ?? null,
    entradaValor: entrada != null ? entrada.toFixed(2) : null,
    observacoes:
      `Orçamento montado pelo atendente virtual no WhatsApp: ${pac.nome} (${rs(pac.valor)}/pessoa) + ${esp.rotulo}.` +
      (tipo ? ` Evento: ${tipo}.` : '') +
      (naoAchados.length ? ` Pratos pedidos que não achei no cardápio (conferir): ${naoAchados.join(', ')}.` : '') +
      (p.observacoes ? ` ${p.observacoes.slice(0, 500)}` : ''),
    condicoes:
      `${pac.nome}: ${rs(pac.valor)} por pessoa — ${pac.descricao}. ` +
      (premium && pratos.filter((x) => x.secao === 'principal').length === 0
        ? 'Pratos a escolher com a equipe entre os melhores da casa. '
        : '') +
      condTaxa +
      'Incluído: mesas e cadeiras, material de serviço, pessoal de serviço e de limpeza. ' +
      (entrada != null
        ? `Entrada de ${rs(entrada)} (${origemEntrada}) por Pix para reservar a data — a data só fica bloqueada após a confirmação do pagamento. Saldo até o dia do evento.`
        : 'Entrada e forma de pagamento combinadas com a equipe; o saldo é acertado até o dia do evento.'),
    validoAte: diasAtrasBr(-VALIDADE_DIAS),
    aceiteToken,
    criadoPor: 'nina-whatsapp',
  });

  return (
    `ORÇAMENTO CRIADO (Tabuará): ${esp.rotulo}, ${dataBr}${p.hora ? ` a partir das ${p.hora}` : ''}, ${pessoas} pessoas${tipo ? ` (${tipo})` : ''}. ` +
    `${pac.nome}: ${rs(pac.valor)} por pessoa (${pac.descricao}) = ${rs(subtotal)}. ` +
    (p.espaco === 'sem_fechar'
      ? 'Sem taxa de fechamento: as mesas ficam reservadas pro grupo com a casa aberta. '
      : isento
        ? `Sem taxa de fechamento: com ${pessoas} pessoas (a partir de ${esp.isentaAPartir} neste espaço) não se cobra lugar vazio. `
        : `Taxa de fechamento do espaço: ${vazios} lugares vazios × R$ ${TABUARA_TAXA_LUGAR_VAZIO} = ${rs(taxa)}. `) +
    (descEspaco
      ? `O cliente é ${descEspaco.motivo}: ganhou ${rs(descEspaco.desconto)} de desconto na taxa, já abatido no documento — conte como benefício do cartão. `
      : '') +
    `Total do evento: ${rs(totalGeral)}. ` +
    (entrada != null
      ? `Entrada de ${rs(entrada)} (${origemEntrada}) por Pix na própria página do link: é ela que reserva a data (enquanto não pagar, o dia segue livre — diga com naturalidade, sem pressão). Saldo até o dia do evento. `
      : 'Sem entrada automática: diga que a equipe confirma a reserva e a forma de pagamento. ') +
    (premium && pratos.filter((x) => x.secao === 'principal').length === 0
      ? 'Os pratos do premium ficam a escolher: ofereça mandar as opções ou deixar pra equipe. '
      : '') +
    (naoAchados.length ? `Não achei no cardápio: ${naoAchados.join(', ')} — a equipe confere esses itens. ` : '') +
    `Válido por ${VALIDADE_DIAS} dias. Mande pro cliente o resumo com o link pra ver e aceitar: https://app.prainhabar.com/orcamento/${aceiteToken}`
  );
}
