// Orçamento de evento AUTOMÁTICO montado pela Nina na conversa.
//
// Regras aprovadas pelo Elison (14/08):
//  - Cliente escolhe 3-4 entradas (viram "à vontade"), 3 principais + 1 massa
//    (opção vegetariana), sobremesa opcional (padrão sem).
//  - Cálculo (regra "média", fatores abaixo): entradas = 1 porção de CADA
//    escolhida a cada 3 pessoas; principais = 1 porção individual por pessoa
//    (porção "2 pessoas" conta pra 2); sobremesa = 1 por pessoa.
//  - Terraço: taxa fixa R$ 1.000; até 50 pessoas (com varandinha junto, 60).
//    Gramado/varandinha sozinha: sem taxa fixa → equipe fecha (não gera).
//  - TRAVA: valor final por pessoa (comida + espaço rateado) fora de
//    R$ 80–250 → NÃO envia; Nina transfere pra equipe.
//  - Documento: valorPessoa = comida/pessoa; taxaEspaco separada (o doc soma
//    valorPessoa×pessoas + taxa — mesma conta, mais transparente).

import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { buscarItensCardapio, type ItemCardapio } from './cardapio';
import { eventoQueSeguraData, datasFechadasPorEntrada } from '@/lib/orcamentos-server';
import { descontoEspacoMembro } from '@/lib/fidelidade/membro';

// Fatores da regra "média" (mudar aqui recalibra a Nina; futuro: painel).
const PRECO_MINIMO_OPCAO = 5; // abaixo disso é placeholder de PDV, não prato
const ENTRADA_PORCAO_A_CADA = 3; // 1 porção de cada entrada a cada 3 pessoas
const PRINCIPAL_PORCOES_POR_PESSOA = 1; // equivalente individual por pessoa
// Piso comercial (Elison, 14/08): evento no Terraço não sai por menos de
// R$ 120/pessoa — conta abaixo disso é elevada ao piso, não bloqueada.
const PISO_POR_PESSOA = 120;
// Teto da trava: orçamentos reais da casa (casamento 50p R$350/p, SEBRAE
// 70p R$335/p — com bebidas/serviço) balizam o teto em 400.
const FAIXA_MAX_PESSOA = 400;
// Pacotes de bebida POR PESSOA — valores aprovados pelo Elison em 14/08
// ("pode gravar" nas faixas 30-40 / 60-80; gravados os pontos médios).
// Uísque/vinho/open bar completo continua sob medida com a equipe.
const PACOTE_BEBIDA_SEM_ALCOOL: number | null = 35; // refri, água, água de coco, sucos
const PACOTE_BEBIDA_COM_ALCOOL: number | null = 70; // + cerveja
const TAXA_TERRACO = 1000;
// TAXA DE ROLHA por faixa de valor do evento (Elison, 16/08): evento grande
// não paga; quanto menor a conta, maior a rolha. Cobrada POR GARRAFA de vinho
// que o cliente traz.
const ROLHA_FAIXAS: Array<{ ateTotal: number; valor: number }> = [
  { ateTotal: 5000, valor: 50 },
  { ateTotal: 10000, valor: 30 },
  { ateTotal: Infinity, valor: 0 },
];

function rolhaDoEvento(total: number): number {
  return ROLHA_FAIXAS.find((f) => total <= f.ateTotal)!.valor;
}
const CAP_TERRACO = 50;
const CAP_TERRACO_COM_VARANDA = 60;
const VALIDADE_DIAS = 7;

const KW_ENTRADAS = ['bolinho', 'caldinho', 'pastel', 'pasteis', 'isca', 'ostra', 'catado', 'carpaccio', 'dadinho', 'batata', 'entrada', 'petisco', 'tabua', 'camarao empanado', 'pao de alho'];
const KW_MASSAS = ['massa', 'penne', 'espaguete', 'talharim', 'fettuccine', 'nhoque', 'ravioli'];
const KW_SOBREMESAS = ['petit', 'pudim', 'torta', 'sorvete', 'banana flambada', 'suspiro', 'folhado', 'sobremesa', 'cartola'];
const KW_PRINCIPAIS = ['moqueca', 'peixe', 'robalo', 'salmao', 'picanha', 'parrilla', 'risoto', 'file', 'maminha', 'ancho', 'grelhado', 'camarao', 'polvo', 'lagosta', 'frango'];

function dobrar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function porPalavras(alvo: string): 'entrada' | 'massa' | 'sobremesa' | 'principal' | null {
  if (KW_ENTRADAS.some((k) => alvo.includes(k))) return 'entrada';
  if (KW_MASSAS.some((k) => alvo.includes(k))) return 'massa';
  if (KW_SOBREMESAS.some((k) => alvo.includes(k))) return 'sobremesa';
  if (KW_PRINCIPAIS.some((k) => alvo.includes(k))) return 'principal';
  return null;
}

// O NOME manda; a descrição é só desempate. Misturar os dois jogava prato
// principal pra entrada por causa do acompanhamento: "Filé com fritas" e
// "Coxa de frango recheada" viravam entrada por dizerem "batata" na
// descrição, e o "Mix de mini pastéis" virava principal por dizer "filé".
function classifica(nome: string, descr: string): 'entrada' | 'massa' | 'sobremesa' | 'principal' | null {
  return porPalavras(dobrar(nome)) ?? porPalavras(dobrar(`${nome} ${descr}`));
}

/** Custo POR PESSOA de um prato principal: porção "2 pessoas" → preço/2. */
function precoPorPessoa(item: ItemCardapio): number {
  const m = /(\d+)\s*pessoa/i.exec(item.tamanho ?? '');
  const divisor = m ? Math.max(parseInt(m[1], 10), 1) : 1;
  return item.preco / divisor;
}

/** Lista candidatos do cardápio ativo pro modelo apresentar. */
export async function listarOpcoesOrcamento(filialId: string): Promise<string> {
  // Sem pausados e sem preço-placeholder: o cardápio tem itens de centavos
  // ("Entrada dia dos namorados", R$ 0,01) que sujariam a escolha e o cálculo.
  const todos = (await buscarItensCardapio(filialId, '', 400)).filter(
    (i) => !i.pausado && i.preco >= PRECO_MINIMO_OPCAO,
  );
  const grupos: Record<string, ItemCardapio[]> = { entrada: [], principal: [], massa: [], sobremesa: [] };
  const vistos = new Set<string>();
  for (const it of todos) {
    const chave = dobrar(it.nome);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const g = classifica(it.nome, it.descr ?? '');
    if (g) grupos[g].push(it);
  }
  const fechadas = await datasFechadasPorEntrada(filialId);
  const avisoDatas = fechadas.length
    ? `DATAS JÁ FECHADAS (outro evento pagou a entrada — NÃO ofereça nem orce nesses dias): ${fechadas.map((d) => d.split('-').reverse().join('/')).join(', ')}.\n\n`
    : '';
  const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
  const fmt = (arr: ItemCardapio[], n: number) =>
    arr.slice(0, n).map((i) => `- ${i.nome}${i.tamanho ? ` (${i.tamanho})` : ''}: ${rs(i.preco)}`).join('\n') || '- (nenhum encontrado)';
  return [
    avisoDatas.trim() || 'Agenda livre nas próximas datas.',
    `ENTRADAS sugeridas (cliente escolhe 3 ou 4, viram "à vontade"):\n${fmt(grupos.entrada, 20)}`,
    `PRINCIPAIS sugeridos (cliente escolhe 3):\n${fmt(grupos.principal, 24)}`,
    `MASSAS (escolher 1, opção vegetariana/quem não come frutos do mar):\n${fmt(grupos.massa, 8)}`,
    `SOBREMESAS (opcional — padrão é SEM):\n${fmt(grupos.sobremesa, 8)}`,
    `Apresente poucas por vez, conversando — mas MOSTRE VARIEDADE: nas entradas não fique só nos bolinhos e caldinhos (as iscas, os catados, a ostra empanada e a tábua são dos melhores pedidos da casa), e nos principais alterne peixe, camarão, carne e frango em vez de repetir a mesma família. Se o cliente não gostar da primeira leva, ofereça outra — a lista acima é a casa inteira. O cliente também pode pedir prato fora da lista: a geração valida pelo cardápio.`,
  ].join('\n\n');
}

async function resolver(filialId: string, nome: string): Promise<ItemCardapio | null> {
  // Pausado no PDV = em falta: nunca entra em orçamento de evento.
  const achados = (await buscarItensCardapio(filialId, nome, 6)).filter((i) => !i.pausado);
  if (achados.length === 0) return null;
  // entre variantes do mesmo prato, fica a de menor custo por pessoa
  return achados.reduce((a, b) => (precoPorPessoa(b) < precoPorPessoa(a) ? b : a));
}

export interface PedidoOrcamento {
  filialId: string;
  filialNome: string;
  telefone: string;
  nomeCliente: string;
  espaco: string;
  data: string; // YYYY-MM-DD
  hora: string | null;
  pessoas: number;
  entradas: string[];
  principais: string[];
  massa: string | null;
  sobremesa: string | null; // nome da sobremesa ou null = sem
  bebidas: 'nenhuma' | 'sem_alcool' | 'com_alcool';
  observacoes: string | null;
}

export async function gerarOrcamentoEvento(p: PedidoOrcamento): Promise<string> {
  const espaco = dobrar(p.espaco ?? '');
  if (!espaco.includes('terraco')) {
    return `Orçamento automático só existe pro Terraço (taxa fixa de R$ ${TAXA_TERRACO}). Pra ${p.espaco || 'esse espaço'}, registre o lead e transfira pra equipe fechar o valor — NÃO cite preço.`;
  }
  const pessoas = Math.round(p.pessoas);
  if (!pessoas || pessoas < 1) return 'Preciso do número de pessoas pra calcular.';
  if (pessoas > CAP_TERRACO_COM_VARANDA) {
    return `O Terraço comporta até ${CAP_TERRACO} pessoas (até ${CAP_TERRACO_COM_VARANDA} juntando a varandinha). Pra ${pessoas} pessoas, registre o lead e transfira pra equipe pensar num formato — não gere orçamento.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) return 'Data inválida (YYYY-MM-DD).';
  if (p.data < hojeBr()) return 'A data do evento já passou — peça uma data futura.';
  // Entrada paga fecha o espaço naquele dia: não existe segundo evento.
  const jaFechada = await eventoQueSeguraData({ filialId: p.filialId, local: p.espaco, data: p.data });
  if (jaFechada) {
    return `DATA INDISPONÍVEL: o ${p.espaco} já está fechado em ${p.data.split('-').reverse().join('/')} — outro evento pagou a entrada e segurou o espaço. NÃO gere orçamento pra esse dia: conte pro cliente com jeito que essa data já foi reservada e pergunte qual outra data serve.`;
  }
  if (!p.nomeCliente.trim()) {
    return 'Falta o nome do cliente — PERGUNTE agora, numa frase curta e natural ("pra deixar o orçamento no seu nome, como você se chama?"), e chame gerar_orcamento_evento de novo com a resposta. NÃO registre lead nem transfira por causa disso, e NÃO use o nome do perfil do WhatsApp: o nome vai impresso no documento.';
  }
  if (p.entradas.length < 3 || p.entradas.length > 4) return 'O cliente escolhe 3 ou 4 entradas.';
  if (p.principais.length !== 3) return 'O cliente escolhe exatamente 3 pratos principais (a massa é à parte).';

  // Resolve tudo no cardápio (preço oficial)
  const naoAchou: string[] = [];
  const res = async (nomes: string[]) => {
    const out: ItemCardapio[] = [];
    for (const n of nomes) {
      const it = await resolver(p.filialId, n);
      if (it) out.push(it);
      else naoAchou.push(n);
    }
    return out;
  };
  const entradas = await res(p.entradas);
  const principais = await res(p.principais);
  const massa = p.massa ? await resolver(p.filialId, p.massa) : null;
  if (p.massa && !massa) naoAchou.push(p.massa);
  const sobremesa = p.sobremesa ? await resolver(p.filialId, p.sobremesa) : null;
  if (p.sobremesa && !sobremesa) naoAchou.push(p.sobremesa);
  if (naoAchou.length > 0) {
    return `Não achei no cardápio: ${naoAchou.join('; ')}. Confirme o nome com o cliente (ou use consultar_cardapio) e gere de novo.`;
  }

  // Bebidas: só entram com valor de pacote definido
  let custoBebidas = 0;
  let bebidaNota = '';
  let bebidaSecao: 'bebida_sem_alcool' | 'bebida_com_alcool' | null = null;
  if (p.bebidas === 'sem_alcool') {
    if (PACOTE_BEBIDA_SEM_ALCOOL == null) {
      bebidaNota = ' OBS: pacote de bebidas ainda SEM VALOR definido — o orçamento saiu SEM bebidas (por consumo, ou pacote a combinar com a equipe); avise o cliente assim.';
    } else {
      custoBebidas = PACOTE_BEBIDA_SEM_ALCOOL;
      bebidaSecao = 'bebida_sem_alcool';
    }
  } else if (p.bebidas === 'com_alcool') {
    if (PACOTE_BEBIDA_COM_ALCOOL == null) {
      bebidaNota = ' OBS: pacote de bebidas ainda SEM VALOR definido — o orçamento saiu SEM bebidas (por consumo, ou pacote a combinar com a equipe); avise o cliente assim.';
    } else {
      custoBebidas = PACOTE_BEBIDA_COM_ALCOOL;
      bebidaSecao = 'bebida_com_alcool';
    }
  }

  // Cálculo da comida POR PESSOA (regra média)
  const custoEntradas = entradas.reduce((s, e) => s + e.preco, 0) / ENTRADA_PORCAO_A_CADA;
  const principaisTodos = massa ? [...principais, massa] : principais;
  const mediaPrincipal =
    principaisTodos.reduce((s, i) => s + precoPorPessoa(i), 0) / principaisTodos.length;
  const custoPrincipais = mediaPrincipal * PRINCIPAL_PORCOES_POR_PESSOA;
  const custoSobremesa = sobremesa ? sobremesa.preco : 0;
  const comidaPorPessoa = custoEntradas + custoPrincipais + custoSobremesa + custoBebidas;

  // Valor por pessoa "cheio" (com espaço rateado): arredonda pra cima em R$5
  // e aplica o PISO de R$ 120/pessoa.
  const totalSemArredondar = comidaPorPessoa * pessoas + TAXA_TERRACO;
  const calculado = Math.ceil(totalSemArredondar / pessoas / 5) * 5;
  const porPessoaCheio = Math.max(calculado, PISO_POR_PESSOA);
  const pisoAplicado = porPessoaCheio > calculado;
  const valorPessoaDoc = Math.max(porPessoaCheio - TAXA_TERRACO / pessoas, 0);
  const totalFinal = valorPessoaDoc * pessoas + TAXA_TERRACO;

  if (porPessoaCheio > FAIXA_MAX_PESSOA) {
    return `TRAVA: o cálculo deu R$ ${porPessoaCheio.toFixed(0)} por pessoa (acima do teto de ${FAIXA_MAX_PESSOA}). NÃO cite esse valor — registre o lead e transfira pra equipe montar o orçamento.`;
  }

  // Entradas à vontade; principais e massa servidos 1 por pessoa (regra da
  // casa — "à vontade" no doc é só pras entradas).
  const pratos = [
    ...entradas.map((e) => ({ nome: e.nome, descricao: e.descr || undefined, regime: 'livre' as const, secao: 'entrada' as const })),
    ...principais.map((i) => ({ nome: i.nome, descricao: i.descr || undefined, regime: 'limitado' as const, qtd: '1 por pessoa', secao: 'principal' as const })),
    ...(massa
      ? [{ nome: massa.nome, descricao: (massa.descr || '') + (massa.descr ? ' — ' : '') + 'opção vegetariana', regime: 'limitado' as const, qtd: '1 por pessoa', secao: 'principal' as const }]
      : []),
    ...(sobremesa
      ? [{ nome: sobremesa.nome, descricao: sobremesa.descr || undefined, regime: 'limitado' as const, qtd: '1 por pessoa', secao: 'sobremesa' as const }]
      : []),
    ...(bebidaSecao === 'bebida_sem_alcool'
      ? [{ nome: 'Refrigerante, água, água de coco e sucos', regime: 'livre' as const, secao: 'bebida_sem_alcool' as const }]
      : []),
    ...(bebidaSecao === 'bebida_com_alcool'
      ? [
          { nome: 'Refrigerante, água, água de coco e sucos', regime: 'livre' as const, secao: 'bebida_sem_alcool' as const },
          { nome: 'Cerveja', regime: 'livre' as const, secao: 'bebida_com_alcool' as const },
        ]
      : []),
  ];

  const rolha = rolhaDoEvento(totalFinal);
  // Cliente VIP ganha desconto na taxa do espaço (a entrada
  // continua a taxa cheia — é o que segura a data; o desconto sai do restante).
  const descEspaco = await descontoEspacoMembro(p.filialId, p.telefone, TAXA_TERRACO, null).catch(() => null);
  const aceiteToken = randomBytes(32).toString('hex');
  await db.insert(schema.orcamentoEvento).values({
    filialId: p.filialId,
    local: `Terraço (${p.filialNome})${pessoas > CAP_TERRACO ? ' + Varandinha' : ''}`,
    clienteNome: p.nomeCliente.trim().slice(0, 200),
    clienteTelefone: p.telefone,
    dataEvento: p.data,
    hora: p.hora,
    pessoas,
    valorPessoa: valorPessoaDoc.toFixed(2),
    pratos,
    sobremesaIncluida: !!sobremesa,
    sobremesaDescricao: sobremesa ? sobremesa.nome : null,
    taxaEspaco: TAXA_TERRACO.toFixed(2),
    descontoEspaco: descEspaco ? descEspaco.desconto.toFixed(2) : null,
    descontoEspacoMotivo: descEspaco?.motivo ?? null,
    // ENTRADA = a taxa do espaço (Elison, 16/08): é o que segura a data, é
    // valor redondo e não cresce com o tamanho do evento. Pagou = data
    // fechada (eventoQueSeguraData barra qualquer outro no mesmo dia).
    entradaValor: TAXA_TERRACO.toFixed(2),
    observacoes: `Orçamento montado pela Nina no WhatsApp.${p.observacoes ? ` ${p.observacoes.slice(0, 500)}` : ''}`,
    // Incluído/Não incluído: espelha o texto dos orçamentos reais da casa.
    condicoes:
      'Entradas e pratos servidos à vontade durante o evento. ' +
      'Incluído: mesas e cadeiras, material de serviço (pratos, talheres, taças, guardanapos), pessoal de serviço e de limpeza, estacionamento fechado e gerador em caso de falta de energia. ' +
      'Não incluído: decoração, doces, bolo e bebidas — bebidas servidas por consumo, ou em pacote a combinar com a equipe. ' +
      `Entrada de R$ ${TAXA_TERRACO},00 (a taxa do espaço) para reservar a data — a data só fica bloqueada após o pagamento. O restante é acertado com a equipe. ` +
      `Entrada de R$ ${TAXA_TERRACO},00 (a taxa do espaço) para reservar a data — a data só fica bloqueada após a confirmação do pagamento; o restante é acertado com a equipe. ` +
      (rolha > 0
        ? `Vinho trazido pelo cliente: taxa de rolha de R$ ${rolha},00 por garrafa. `
        : 'Vinho trazido pelo cliente: taxa de rolha por cortesia da casa. ') +
      'Valores sujeitos a confirmação da equipe para ajustes finais.',
    validoAte: diasAtrasBr(-VALIDADE_DIAS),
    aceiteToken,
    criadoPor: 'nina-whatsapp',
  });

  const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
  const sob = sobremesa ? `com sobremesa (${sobremesa.nome})` : 'sem sobremesa';
  const composicao =
    `Composição por pessoa: entradas ${rs(custoEntradas)} · principais ${rs(custoPrincipais)}` +
    (custoSobremesa > 0 ? ` · sobremesa ${rs(custoSobremesa)}` : '') +
    (custoBebidas > 0 ? ` · bebidas ${rs(custoBebidas)}` : '') +
    ` · espaço rateado ${rs(TAXA_TERRACO / pessoas)}`;
  return (
    `ORÇAMENTO CRIADO: Terraço, ${p.data.split('-').reverse().join('/')}${p.hora ? ` às ${p.hora}` : ''}, ${pessoas} pessoas, ${sob}. ` +
    `${composicao}. ` +
    `Menu ${rs(valorPessoaDoc)}/pessoa + taxa do espaço ${rs(TAXA_TERRACO)} = total ${rs(totalFinal)} (${rs(porPessoaCheio)} por pessoa com tudo${pisoAplicado ? ` — a conta deu ${rs(calculado)} e foi elevada ao mínimo de ${rs(PISO_POR_PESSOA)}/pessoa` : ''}). ` +
    `Entrada de R$ ${TAXA_TERRACO},00 (taxa do espaço) reserva a data — enquanto não pagar, a data segue livre pra outro cliente; diga isso ao cliente com naturalidade, sem pressão. ` +
    (rolha > 0
      ? `Taxa de rolha: R$ ${rolha},00 por garrafa de vinho que o cliente trouxer — diga SÓ esse valor, nunca as faixas. `
      : `Rolha por CORTESIA nesse evento: ofereça como gentileza da casa ("a rolha fica por nossa conta"), sem dizer por que nem citar valor de corte. `) +
    `Entrada de R$ ${TAXA_TERRACO},00 (a taxa do espaço) reserva a data: enquanto não pagar, o dia segue livre pra outro cliente — diga isso com naturalidade, sem pressão, e o Pix sai na própria página do link. ` +
    (descEspaco
      ? `O cliente é ${descEspaco.motivo}: ganhou ${rs(descEspaco.desconto)} de desconto no aluguel do espaço, já abatido no total do documento (total com desconto ${rs(totalFinal - descEspaco.desconto)}) — conte isso a ele como benefício do cartão. `
      : '') +
    `Válido por ${VALIDADE_DIAS} dias.${bebidaNota} Mande pro cliente o resumo com o link do orçamento pra ver e aceitar: https://app.prainhabar.com/orcamento/${aceiteToken}`
  );
}

// ---------------------------------------------------------------------------
// ESPAÇO FECHADO + CONSUMO DO CARDÁPIO POR COMANDA (20/10/2026, caso
// Gabriella — chá revelação no Terraço, 30-40 pessoas, decoração própria).
// O cliente não quer menu: quer o Terraço só pro grupo e cada um consome do
// cardápio na própria comanda. Preço e condição vêm do CADASTRO dos espaços
// (Atendimento → config → espaços de evento), não de constante aqui: o dono
// muda o valor lá e a Nina acompanha. Gera o mesmo orçamento com link de
// aceite e Pix da entrada (pratos vazios = "Cardápio a definir").
// ---------------------------------------------------------------------------

export interface PedidoOrcamentoEspaco {
  filialId: string;
  filialNome: string;
  telefone: string;
  espacos: Array<{ nome: string; preco: string; condicoes: string; ativo?: boolean }>;
  nomeCliente: string;
  espaco: string;
  data: string; // YYYY-MM-DD
  hora: string | null; // HH:MM
  pessoas: number;
  tipoEvento: string | null;
  observacoes: string | null;
}

/** "1.500", "R$ 800,00", "800" → número. */
export function valorDoCadastro(txt: string): number | null {
  const m = (txt || '').replace(/\s/g, '').match(/\d[\d.]*(,\d{1,2})?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "50% saldo até o dia do evento" → 50. Sem percentual → 50 (padrão da casa). */
export function percentualEntrada(condicoes: string): number {
  const m = (condicoes || '').match(/(\d{1,3})\s*%/);
  const n = m ? Number(m[1]) : 50;
  return n > 0 && n <= 100 ? n : 50;
}

export async function gerarOrcamentoEspaco(p: PedidoOrcamentoEspaco): Promise<string> {
  const alvo = dobrar(p.espaco ?? '');
  if (!alvo.includes('terraco')) {
    return `Orçamento de espaço fechado com consumo por comanda, por enquanto, só sai pro Terraço. Pra ${p.espaco || 'esse espaço'}, registre o lead com tudo que o cliente contou e transfira pra equipe — NÃO cite preço.`;
  }
  const cad = p.espacos.find((e) => e.ativo !== false && dobrar(e.nome).includes('terraco'));
  const taxa = cad ? valorDoCadastro(cad.preco) : null;
  if (!cad || !taxa) {
    return 'O Terraço está sem preço no cadastro de espaços. Registre o lead e transfira pra equipe confirmar o valor — NÃO cite preço.';
  }
  const pessoas = Math.round(p.pessoas);
  if (!pessoas || pessoas < 1) return 'Preciso do número de pessoas (pode ser uma estimativa, ex.: 40).';
  if (pessoas > CAP_TERRACO_COM_VARANDA) {
    return `O Terraço comporta até ${CAP_TERRACO} pessoas (até ${CAP_TERRACO_COM_VARANDA} juntando a varandinha). Pra ${pessoas} pessoas, registre o lead e transfira pra equipe pensar num formato — não gere orçamento.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) return 'Data inválida (YYYY-MM-DD).';
  if (p.data < hojeBr()) return 'A data do evento já passou — peça uma data futura.';
  // Noite (19h em diante) = evento fechado com orçamento da equipe (regra do dono 14/10).
  if (p.hora && /^\d{2}:\d{2}$/.test(p.hora) && p.hora >= '19:00') {
    return 'À NOITE (a partir das 19h) a casa só abre pra evento fechado, com mínimo de 30 pessoas e orçamento feito pela equipe. NÃO gere orçamento: confirme o horário com o cliente — se for mesmo à noite, registre o lead com tudo e transfira; se puder ser de dia (até as 19h), chame esta ferramenta de novo com o horário certo.';
  }
  const jaFechada = await eventoQueSeguraData({ filialId: p.filialId, local: 'Terraço', data: p.data });
  if (jaFechada) {
    return `DATA INDISPONÍVEL: o Terraço já está fechado em ${p.data.split('-').reverse().join('/')} — outro evento pagou a entrada. NÃO gere orçamento pra esse dia: conte com jeito e pergunte qual outra data serve.`;
  }
  if (!p.nomeCliente.trim()) {
    return 'Falta o nome do cliente — PERGUNTE agora, numa frase curta ("pra deixar o orçamento no seu nome, como você se chama?"), e chame gerar_orcamento_espaco de novo. NÃO registre lead nem transfira por isso, e NÃO use o nome do perfil do WhatsApp.';
  }

  const pct = percentualEntrada(cad.condicoes);
  const entrada = Math.round((taxa * pct) / 100);
  const comVaranda = pessoas > CAP_TERRACO;
  const descEspaco = await descontoEspacoMembro(p.filialId, p.telefone, taxa, null).catch(() => null);
  const aceiteToken = randomBytes(32).toString('hex');
  const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
  const tipo = p.tipoEvento?.trim() ? p.tipoEvento.trim().slice(0, 120) : null;

  await db.insert(schema.orcamentoEvento).values({
    filialId: p.filialId,
    local: `Terraço (${p.filialNome})${comVaranda ? ' + Varandinha' : ''}`,
    clienteNome: p.nomeCliente.trim().slice(0, 200),
    clienteTelefone: p.telefone,
    dataEvento: p.data,
    hora: p.hora,
    pessoas,
    valorPessoa: null,
    pratos: [],
    sobremesaIncluida: false,
    sobremesaDescricao: null,
    taxaEspaco: taxa.toFixed(2),
    descontoEspaco: descEspaco ? descEspaco.desconto.toFixed(2) : null,
    descontoEspacoMotivo: descEspaco?.motivo ?? null,
    entradaValor: entrada.toFixed(2),
    observacoes:
      `Orçamento de espaço montado pela Nina no WhatsApp: Terraço fechado pro grupo, consumo do cardápio por comanda individual.` +
      (tipo ? ` Evento: ${tipo}.` : '') +
      (p.observacoes ? ` ${p.observacoes.slice(0, 500)}` : ''),
    condicoes:
      `Aluguel do Terraço só para o grupo${comVaranda ? ' (com a varandinha)' : ''}: ${rs(taxa)}. ` +
      'Comida e bebida por consumo do cardápio da casa, em comandas individuais (cada convidado paga o que consumir). ' +
      'Incluído: mesas e cadeiras, material de serviço, pessoal de serviço e de limpeza. ' +
      'O cliente pode trazer decoração, bolo e doces. ' +
      `Entrada de ${pct}% (${rs(entrada)}) por Pix para reservar a data — a data só fica bloqueada após a confirmação do pagamento. ` +
      `Saldo do aluguel até o dia do evento. ${cad.condicoes ? `Condição cadastrada: ${cad.condicoes}.` : ''}`.trim(),
    validoAte: diasAtrasBr(-VALIDADE_DIAS),
    aceiteToken,
    criadoPor: 'nina-whatsapp',
  });

  return (
    `ORÇAMENTO DE ESPAÇO CRIADO: Terraço${comVaranda ? ' + varandinha' : ''} fechado pro grupo, ${p.data.split('-').reverse().join('/')}${p.hora ? ` a partir das ${p.hora}` : ''}, ${pessoas} pessoas${tipo ? ` (${tipo})` : ''}. ` +
    `Aluguel do espaço ${rs(taxa)}; comida e bebida por consumo do cardápio, em comanda individual. Pode trazer decoração, bolo e doces. ` +
    `Entrada de ${pct}% = ${rs(entrada)} por Pix na própria página do link: é ela que reserva a data (enquanto não pagar, o dia segue livre pra outro cliente — diga com naturalidade, sem pressão). Saldo do aluguel até o dia do evento. ` +
    (descEspaco
      ? `O cliente é ${descEspaco.motivo}: ganhou ${rs(descEspaco.desconto)} de desconto no aluguel, já abatido no documento — conte como benefício do cartão. `
      : '') +
    `Válido por ${VALIDADE_DIAS} dias. Mande pro cliente o resumo com o link pra ver e aceitar: https://app.prainhabar.com/orcamento/${aceiteToken}`
  );
}
