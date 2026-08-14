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

// Fatores da regra "média" (mudar aqui recalibra a Nina; futuro: painel).
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
const CAP_TERRACO = 50;
const CAP_TERRACO_COM_VARANDA = 60;
const VALIDADE_DIAS = 7;

const KW_ENTRADAS = ['bolinho', 'caldinho', 'pastel', 'isca', 'ostra', 'catado', 'carpaccio', 'dadinho', 'batata', 'entrada', 'camarao empanado', 'pao de alho'];
const KW_MASSAS = ['massa', 'penne', 'espaguete', 'talharim', 'fettuccine', 'nhoque', 'ravioli'];
const KW_SOBREMESAS = ['petit', 'pudim', 'torta', 'sorvete', 'banana flambada', 'suspiro', 'folhado', 'sobremesa', 'cartola'];
const KW_PRINCIPAIS = ['moqueca', 'peixe', 'robalo', 'salmao', 'picanha', 'parrilla', 'risoto', 'file', 'maminha', 'ancho', 'grelhado', 'camarao', 'polvo', 'lagosta', 'frango'];

function dobrar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function classifica(nome: string, descr: string): 'entrada' | 'massa' | 'sobremesa' | 'principal' | null {
  const alvo = dobrar(`${nome} ${descr}`);
  if (KW_ENTRADAS.some((k) => alvo.includes(k))) return 'entrada';
  if (KW_MASSAS.some((k) => alvo.includes(k))) return 'massa';
  if (KW_SOBREMESAS.some((k) => alvo.includes(k))) return 'sobremesa';
  if (KW_PRINCIPAIS.some((k) => alvo.includes(k))) return 'principal';
  return null;
}

/** Custo POR PESSOA de um prato principal: porção "2 pessoas" → preço/2. */
function precoPorPessoa(item: ItemCardapio): number {
  const m = /(\d+)\s*pessoa/i.exec(item.tamanho ?? '');
  const divisor = m ? Math.max(parseInt(m[1], 10), 1) : 1;
  return item.preco / divisor;
}

/** Lista candidatos do cardápio ativo pro modelo apresentar. */
export async function listarOpcoesOrcamento(filialId: string): Promise<string> {
  const todos = await buscarItensCardapio(filialId, '', 400); // sem filtro = tudo ativo
  const grupos: Record<string, ItemCardapio[]> = { entrada: [], principal: [], massa: [], sobremesa: [] };
  const vistos = new Set<string>();
  for (const it of todos) {
    const chave = dobrar(it.nome);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const g = classifica(it.nome, it.descr ?? '');
    if (g) grupos[g].push(it);
  }
  const rs = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
  const fmt = (arr: ItemCardapio[], n: number) =>
    arr.slice(0, n).map((i) => `- ${i.nome}${i.tamanho ? ` (${i.tamanho})` : ''}: ${rs(i.preco)}`).join('\n') || '- (nenhum encontrado)';
  return [
    `ENTRADAS sugeridas (cliente escolhe 3 ou 4, viram "à vontade"):\n${fmt(grupos.entrada, 8)}`,
    `PRINCIPAIS sugeridos (cliente escolhe 3):\n${fmt(grupos.principal, 10)}`,
    `MASSAS (escolher 1, opção vegetariana/quem não come frutos do mar):\n${fmt(grupos.massa, 4)}`,
    `SOBREMESAS (opcional — padrão é SEM):\n${fmt(grupos.sobremesa, 5)}`,
    `Apresente poucas por vez, conversando. O cliente pode pedir prato fora da lista — a geração valida pelo cardápio.`,
  ].join('\n\n');
}

async function resolver(filialId: string, nome: string): Promise<ItemCardapio | null> {
  const achados = await buscarItensCardapio(filialId, nome, 6);
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
  if (!p.nomeCliente.trim()) return 'Falta o nome do cliente.';
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
    observacoes: `Orçamento montado pela Nina no WhatsApp.${p.observacoes ? ` ${p.observacoes.slice(0, 500)}` : ''}`,
    // Incluído/Não incluído: espelha o texto dos orçamentos reais da casa.
    condicoes:
      'Entradas e pratos servidos à vontade durante o evento. ' +
      'Incluído: mesas e cadeiras, material de serviço (pratos, talheres, taças, guardanapos), pessoal de serviço e de limpeza, estacionamento fechado e gerador em caso de falta de energia. ' +
      'Não incluído: decoração, doces, bolo e bebidas — bebidas servidas por consumo, ou em pacote a combinar com a equipe. ' +
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
    `Válido por ${VALIDADE_DIAS} dias.${bebidaNota} Mande pro cliente o resumo com o link do orçamento pra ver e aceitar: https://app.prainhabar.com/orcamento/${aceiteToken}`
  );
}
