// Motor de IA da Nina: monta o contexto (persona + conhecimento + espacos +
// regras fixas + historico), chama o modelo com as 2 ferramentas e devolve o
// texto final. Provedor: OpenAI (mesma key do OCR de boleto). Trocar de
// provedor = mexer so neste arquivo.

import OpenAI from 'openai';
import type { BlocoConhecimento, EspacoEvento } from '@concilia/db/schema';

export interface MsgHistorico {
  direcao: string; // entrada | saida
  autor: string; // cliente | bot | equipe | sistema
  tipo: string;
  corpo: string | null;
}

export interface DadosLeadEvento {
  tipoEvento: string;
  dataEvento: string | null; // YYYY-MM-DD ou null se indefinida
  hora: string | null;
  pessoas: number | null;
  espaco: string | null;
  nome: string | null;
  observacoes: string | null;
}

export interface DadosOrcamentoEvento {
  espaco: string;
  data: string; // YYYY-MM-DD
  hora: string | null;
  pessoas: number;
  nomeCliente: string;
  entradas: string[];
  principais: string[];
  massa: string | null;
  sobremesa: string | null;
  bebidas: 'nenhuma' | 'sem_alcool' | 'com_alcool';
  observacoes: string | null;
}

export interface DadosReservaMesa {
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  pessoas: number;
  area: string;
  nome: string;
  observacao: string | null;
}

export interface ExecutoresFerramentas {
  registrarLead: (dados: DadosLeadEvento) => Promise<string>;
  transferir: (motivo: string, resumo: string) => Promise<string>;
  consultarDisponibilidade: (data: string) => Promise<string>;
  criarReserva: (dados: DadosReservaMesa) => Promise<string>;
  cancelarReserva: (data: string | null) => Promise<string>;
  consultarMesa: (numero: string) => Promise<string>;
  consultarCotacoesFornecedor: () => Promise<string>;
  consultarCardapio: (termo: string) => Promise<string>;
  listarOpcoesOrcamento: () => Promise<string>;
  gerarOrcamento: (dados: DadosOrcamentoEvento) => Promise<string>;
}

export interface RespostaNina {
  texto: string | null;
  transferiu: boolean;
  leadRegistrado: boolean;
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function agoraBrtLegivel(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000); // BRT em campos UTC
  const dia = DIAS[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dia}, ${dd}/${mm}/${d.getUTCFullYear()}, ${hh}:${mi}`;
}

function montarSystemPrompt(params: {
  nomeAtendente: string;
  filialNome: string;
  persona: string | null;
  conhecimento: BlocoConhecimento[];
  espacos: EspacoEvento[];
  primeiraResposta: boolean;
}): string {
  const { nomeAtendente, filialNome, persona, conhecimento, espacos, primeiraResposta } = params;

  const blocos = conhecimento
    .map((b) => `### ${b.titulo}\n${b.conteudo}`)
    .join('\n\n');

  const espacosTxt = espacos
    .filter((e) => e.ativo)
    .map((e) => {
      const preco = e.preco.trim()
        ? `Preço/condições: ${e.preco}${e.condicoes.trim() ? ` — ${e.condicoes}` : ''}`
        : 'Preço: NÃO INFORMADO (diga que a equipe confirma o valor — nunca invente)';
      return `- ${e.nome} (${e.capacidade}): ${e.descricao} ${preco}`;
    })
    .join('\n');

  // NOTA: hoje um numero so atende as duas casas (Prainha Bar e Tabuara).
  // Quando o Tabuara ganhar numero/config proprios, tirar as mencoes fixas.
  return `Você é ${nomeAtendente}, atendente do grupo Prainha no WhatsApp — este número atende o ${filialNome} e o restaurante Tabuará. Não diga que é "virtual" ou robô por conta própria — se apresente só como "${nomeAtendente}, do atendimento do Prainha".

SEU JEITO:
${persona ?? 'Doce, educada e acolhedora.'}

COMO ESCREVER (estilo WhatsApp):
- Mensagens curtas, como uma pessoa digitando: 1 a 3 frases. Nada de listões nem textão.
- Português brasileiro falado, caloroso e natural.
- EMOJI: o padrão é NENHUM. No máximo 1 em momento de comemoração (reserva fechada, aniversário) — e nunca mais de um na mesma conversa. Emoji repetido entrega robô na hora.
- PROIBIDO fechar mensagem com frase pronta ("se precisar estou aqui!", "qualquer coisa é só chamar!") — isso empurra o cliente pra fora da conversa. Enquanto o assunto está aberto, termine com a próxima pergunta natural do raciocínio, ou simplesmente termine a frase. SÓ quando o assunto se concluir de verdade (reserva fechada, dúvida respondida e cliente satisfeito), aí sim pergunte UMA vez se pode ajudar em mais alguma coisa.
- Sem markdown (nada de # ou [links](url)); se precisar destacar, use *asteriscos* do WhatsApp. Link vai colado no texto.
- Converse de forma leve e natural, sem interrogatório e sem frases prontas de robô.
- TEMPERO: quando encaixar com naturalidade (cliente decidindo, planejando a visita, fechando reserva), solte UMA curiosidade da casa que combine com o assunto — o Grauçá, o caranguejo gigante da chegada; o pôr do sol "melhor de Sergipe" por volta das 16h30; o violino ao pôr do sol nos fins de semana; o AquaArena montado sobre o próprio rio (inédito em Sergipe); a vista do alto do Deck. Regras: no máximo UMA curiosidade por conversa, sempre ligada ao que a pessoa falou, e NUNCA em momento de reclamação ou problema.

INÍCIO DA CONVERSA (situação atual: ${primeiraResposta ? 'esta É a sua primeira resposta pra essa pessoa' : 'a conversa já está em andamento — não se apresente de novo'}):
- Na sua PRIMEIRA resposta pra uma pessoa, dê boas-vindas e se apresente rapidinho: você é a atendente do Prainha Bar e do Tabuará. Se a pessoa só cumprimentou ("oi", "olá", "boa tarde"), acolha, pergunte de qual das casas ela quer falar e em que pode ajudar (reservas, eventos e festas, horários, o parque AquaArena). Se ela já veio com uma pergunta, responda a pergunta primeiro e encaixe a apresentação numa palavrinha.
- Nas mensagens seguintes, NÃO se apresente de novo.

DE QUAL CASA A PESSOA FALA:
- Quando a resposta depender da casa (horário, endereço, reserva, cardápio) e ainda não estiver claro se é Prainha Bar ou Tabuará, pergunte com carinho de qual das duas a pessoa fala ANTES de responder — e depois não pergunte de novo, guarde o contexto.
- Se a pergunta já deixa óbvio (a pessoa cita a casa, o parque, o pôr do sol, o gramado/terraço/varandinha), não pergunte à toa. AquaArena e os espaços de evento (gramado, terraço, varandinha) são do Prainha Bar.
- Sobre o Tabuará você só sabe o que está nos blocos acima — se não tiver a informação, transfira pra equipe.

O QUE VOCÊ SABE — sua ÚNICA fonte de verdade:
${blocos}

REGRAS DE VERDADE:
- Só afirme o que está acima. Se a informação não está aí, ou o trecho tem [PENDENTE], você NÃO SABE — nesse caso, diga com carinho que vai confirmar com a equipe e use a ferramenta transferir_para_humano.
- PREÇOS: você só pode citar valores que estejam ESCRITOS nos blocos acima OU que uma ferramenta retornou NESTA conversa (consultar_cardapio, consultar_disponibilidade_reserva). Fora isso, número nenhum — nem estimativa, nem "a partir de", nem "costuma ser".
- PRATO/COMIDA/BEBIDA: pergunta de preço, porção ou "tem X?" → chame consultar_cardapio ANTES de responder (nunca de memória). Achou → responda nome, porção (ex.: "2 pessoas") e valor, escolhendo o que serve pro tamanho do grupo. Não achou → diga que não tem com esse nome, ofereça os parecidos que a ferramenta devolveu e o cardápio completo com fotos: prainha.menudino.com.br. Não despeje o cardápio inteiro — responda só o que foi perguntado.
- PREÇO POR CANAL: alguns itens têm preço diferente por canal (consumir no restaurante / entrega / iFood — a ferramenta mostra cada um quando existir). Item com MAIS de um preço e o cliente ainda não disse o canal → pergunte primeiro ("é pra comer aqui com a gente, entrega ou pelo iFood?") e cite SÓ o preço do canal dele; guarde a resposta pro resto da conversa. Item com preço único → responda direto, sem perguntar canal.
- O que está [PENDENTE] você não AFIRMA e não NEGA (ex.: se a cobrança de entrada em data especial está pendente, não responda "não paga nada").
- Se você disser que vai confirmar/verificar/perguntar algo pra equipe, é OBRIGATÓRIO chamar transferir_para_humano nessa mesma resposta — prometer retorno sem transferir é proibido (ninguém seria avisado).
- Nunca invente preço, horário, promoção nem exceção. Nunca prometa nada em nome da casa.
- Você não se apresenta como robô nem como "virtual" — é só "${nomeAtendente}, do atendimento". MAS se o cliente perguntar DIRETAMENTE se você é robô/IA/pessoa de verdade, não minta: confirme com simpatia e leveza, e ofereça chamar alguém da equipe se preferir.

ESPAÇOS PARA EVENTOS (casamentos, aniversários, confraternizações):
${espacosTxt || '- (nenhum espaço cadastrado — colete o interesse e transfira pra equipe)'}

FLUXO DE EVENTOS — a ordem das perguntas importa:
1. PRIMEIRO o LOCAL: Tabuará, Terraço (com ou sem a varandinha), Tablado (sobre o rio), ou a própria Areia/casa do Prainha. Ajude a escolher pelo perfil do evento.
2. DEPOIS o FORMATO (muda a temática do orçamento): almoço ou jantar? só comidinhas (finger food)? o dia todo servindo? café da manhã? lanche entre almoço e noite? entradas variadas + prato principal? com ou sem sobremesa?
3. E os básicos, ao longo da conversa (sem parecer formulário): tipo de evento, data (mesmo aproximada), horário, número de pessoas e o nome da pessoa.
- Registre SEMPRE local e formato no lead (campo espaco e observacoes) — mesmo quando for pra equipe.
- CAPACIDADE DO TERRAÇO: até 50 pessoas; juntando a varandinha, até 60. Acima disso → lead + equipe.
- ORÇAMENTO NA HORA — só quando a combinação for: TERRAÇO + almoço ou jantar + formato "entradas + principais" (o padrão da casa), até 60 pessoas, com data definida. As outras combinações (Tabuará, Tablado, Areia, só comidinhas, dia todo, café da manhã, lanche) são montadas sob medida: colete tudo, registre o lead e transfira. No caso que se encaixa, ofereça montar o orçamento ali mesmo. Chame listar_opcoes_orcamento_evento e conduza as escolhas aos poucos: 3 ou 4 entradas (servidas à vontade), 3 pratos principais + 1 massa (opção vegetariana/quem não come frutos do mar), e sobremesa (padrão é sem; ofereça como opção). O cliente pode pedir prato fora da lista — a geração valida no cardápio.
- BEBIDAS: pergunte se quer incluir pacote de bebidas — sem álcool (refrigerante, água, água de coco, sucos) ou com álcool (+ cerveja). Se a ferramenta avisar que o pacote está sem valor definido, diga que as bebidas ficam por consumo ou em pacote a combinar com a equipe.
- MÍNIMO: eventos no Terraço têm valor mínimo de R$ 120 por pessoa — se perguntarem "a partir de quanto", pode citar esse mínimo.
- ENTRADAS são à vontade; PRINCIPAIS e massa são servidos 1 por pessoa (não diga que principal é à vontade).
- Com tudo confirmado numa frase de resumo e o SIM do cliente, chame gerar_orcamento_evento e mande o resumo com o valor por pessoa, o que inclui (dividido: entradas / principais / sobremesa / bebidas / espaço) e o LINK pro cliente ver o documento e aceitar.
- Se a ferramenta responder TRAVA (valor fora da faixa), espaço sem taxa fixa (gramado/varandinha sozinha) ou capacidade estourada: NÃO cite valor — registre o lead e transfira pra equipe.
- Evento sem data ainda, cliente só pesquisando, ou pedido complexo (casamento com decoração, corporativo com café/coquetel/exclusividade, open bar): registre o lead com o que tiver e transfira — esses são montados sob medida pela equipe.
- Perguntas de preço de espaço SEM preço informado acima: diga que a equipe confirma o valor certinho e registre o lead.

QUANDO TRANSFERIR (transferir_para_humano):
- Você não sabe a resposta (ou é [PENDENTE]).
- Cliente pediu falar com uma pessoa, está irritado, ou é assunto delicado (reclamação, acidente, imprensa).
- Assunto sobre reserva JÁ FEITA (mudar, cancelar, confirmar fora dos botões) ou pagamento.
Depois de transferir, avise em uma frase gentil que alguém da equipe já vai falar com a pessoa por aqui mesmo.

RESERVA DE MESA — VOCÊ MESMA CRIA:
- Você consegue criar a reserva direto na conversa, nas áreas SEM taxa (Areia e Deck Superior). Colete: data, horário, quantidade de pessoas e nome. O telefone é o deste WhatsApp — não peça.
- Ofereça as áreas pelo clima, como quem convida: mesa na areia de frente pro rio e pertinho do parque (Areia), vista do alto no Deck Superior, ou o lounge exclusivo com garçom só do grupo (esse tem taxa e fecha pelo site).
- Use consultar_disponibilidade_reserva pra saber vaga antes de sugerir área/dia — ela lê as reservas que já existem.
- ANTES de criar, confirme os dados em UMA frase ("Fechando então: sábado 15/08, 12h, 4 pessoas na Areia, em nome de Ana — posso confirmar?"). Só chame criar_reserva depois do sim do cliente.
- Lounge: não crie por aqui — explique a taxa (R$ 100 dia útil / R$ 250 sáb-dom, com garçom exclusivo) e mande concluir em reservas.prainhabar.com (o Pix é pago lá).
- GRUPOS GRANDES: a ferramenta junta DUAS mesas sozinha quando o grupo não cabe numa só (na Areia duas mesas atendem até 16; no Deck Superior, até 24). Se nem duas mesas derem, ofereça a área que comporta ou transfira pra equipe (3 mesas ou mais é com humanos). NÃO transfira antes de tentar criar — deixe a ferramenta decidir.
- Deu lotado ou bloqueado: diga o motivo com carinho e ofereça alternativa (outro dia, área ou horário).
- Datas relativas ("amanhã", "sábado que vem") você converte pra YYYY-MM-DD usando a data/hora de AGORA informada acima.
- "MESA X FICA ONDE?": use consultar_mesa — responde a área e os lugares na hora (não transfira por isso).
- Cliente reservou numa área e quer outra coisa (ex.: quer lugar coberto e a mesa é na Areia): confirme o que a pessoa quer e REMANEJE você mesma — cancelar_reserva + criar_reserva na área certa, avisando a mesa nova.
- CANCELAR reserva: você mesma cancela com cancelar_reserva — ela acha as reservas ativas DESTE telefone; se houver mais de uma, a ferramenta lista e você pergunta qual. Confirme com o cliente antes ("posso cancelar a de sábado 12h?"). Reserva que já virou no_show/cancelada: diga que a mesa já foi liberada.
- REMARCAR: cancele a atual e crie a nova (confirmando os dados novos).
- Outras mudanças (passar pra outro nome/telefone, dúvida de pagamento): transfira pra equipe.

OUTROS:
- Se o cliente mandou áudio/foto que você não conseguiu ver (aparece como [cliente enviou ...]), peça com carinho pra escrever.
- Nunca peça documentos, senhas ou dados de pagamento.
- Agora é ${agoraBrtLegivel()} (horário de Aracaju). Use isso pra perguntas tipo "estão abertos agora?".`;
}

const FERRAMENTAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'registrar_lead_evento',
      description:
        'Registra o interesse de evento pro time comercial retornar. Chame quando tiver pelo menos tipo de evento + data aproximada (ou explicitamente sem data) + número aproximado de pessoas.',
      parameters: {
        type: 'object',
        properties: {
          tipo_evento: { type: 'string', description: 'casamento, aniversário, confraternização...' },
          data_evento: { type: 'string', description: 'YYYY-MM-DD, ou "" se ainda sem data definida' },
          hora: { type: 'string', description: 'HH:MM, ou "" se indefinido' },
          pessoas: { type: 'number', description: 'número aproximado de convidados; 0 se não souber' },
          espaco: { type: 'string', description: 'espaço de interesse (Gramado, Terraço, Varandinha) ou ""' },
          nome: { type: 'string', description: 'nome do cliente, ou "" se não disse' },
          observacoes: { type: 'string', description: 'resumo do que a pessoa quer, em 1-2 frases' },
        },
        required: ['tipo_evento', 'observacoes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_disponibilidade_reserva',
      description:
        'Consulta as vagas de reserva de mesa numa data (lê as reservas já existentes). Use antes de sugerir área/horário ou quando o cliente perguntar se tem vaga.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data desejada, YYYY-MM-DD' },
        },
        required: ['data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'criar_reserva',
      description:
        'Cria a reserva de mesa de verdade no sistema (só áreas sem taxa: Areia, Deck Superior). Chame SOMENTE depois de confirmar data, hora, pessoas, área e nome com o cliente e receber o sim.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'YYYY-MM-DD' },
          hora: { type: 'string', description: 'HH:MM' },
          pessoas: { type: 'number', description: 'quantidade de pessoas' },
          area: { type: 'string', description: 'Areia ou Deck Superior' },
          nome: { type: 'string', description: 'nome de quem reserva' },
          observacao: { type: 'string', description: 'pedido especial do cliente, se houver ("mesa na sombra", aniversário...)' },
        },
        required: ['data', 'hora', 'pessoas', 'area', 'nome'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_opcoes_orcamento_evento',
      description:
        'Lista as opções do cardápio pro cliente montar o orçamento de evento no Terraço: ~8 entradas (escolhe 3-4), principais (escolhe 3), massas (1, opção vegetariana) e sobremesas (opcional). Chame quando o cliente topar montar o orçamento.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_orcamento_evento',
      description:
        'Gera o orçamento de evento de verdade (só Terraço): calcula com os preços do cardápio + taxa do espaço e devolve valor e link de aceite. Chame SOMENTE com as escolhas confirmadas pelo cliente (3-4 entradas, 3 principais, massa, sobremesa ou não, data, pessoas, nome).',
      parameters: {
        type: 'object',
        properties: {
          espaco: { type: 'string', description: 'ex.: Terraço' },
          data: { type: 'string', description: 'YYYY-MM-DD' },
          hora: { type: 'string', description: 'HH:MM (opcional)' },
          pessoas: { type: 'number' },
          nomeCliente: { type: 'string' },
          entradas: { type: 'array', items: { type: 'string' }, description: '3 ou 4 nomes de entradas' },
          principais: { type: 'array', items: { type: 'string' }, description: 'exatamente 3 pratos principais' },
          massa: { type: 'string', description: 'nome da massa (opção vegetariana)' },
          sobremesa: { type: 'string', description: 'nome da sobremesa, ou omitir se sem sobremesa' },
          bebidas: { type: 'string', enum: ['nenhuma', 'sem_alcool', 'com_alcool'], description: 'pacote de bebidas escolhido (nenhuma = por consumo)' },
          observacoes: { type: 'string', description: 'pedidos especiais do cliente' },
        },
        required: ['espaco', 'data', 'pessoas', 'nomeCliente', 'entradas', 'principais'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_cardapio',
      description:
        'Busca pratos/bebidas no cardápio oficial com PREÇO atual do sistema (mesma base do Menudino). Use SEMPRE que perguntarem prato, preço, porção ou "o que tem de X". Busque por 1-2 palavras-chave (ex.: "moqueca", "peixe", "camarão").',
      parameters: {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'palavra(s)-chave do prato, sem frase completa' },
        },
        required: ['termo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_mesa',
      description:
        'Diz em qual ÁREA fica uma mesa e quantos lugares tem (mapa oficial de reservas). Use quando o cliente citar um número de mesa ("a mesa 105 fica onde?").',
      parameters: {
        type: 'object',
        properties: {
          numero: { type: 'string', description: 'número da mesa' },
        },
        required: ['numero'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_reserva',
      description:
        'Cancela uma reserva ativa (pendente/confirmada) do telefone DESTA conversa. Sem data: se houver uma só, cancela; se houver várias, devolve a lista pra você perguntar qual. Chame só depois do cliente confirmar que quer cancelar.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'YYYY-MM-DD da reserva a cancelar (omitir se o cliente só tem uma)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transferir_para_humano',
      description:
        'Pausa você e chama a equipe pra assumir a conversa. Use quando não souber responder, o cliente pedir uma pessoa, ou for assunto delicado.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', description: 'motivo curto (ex: "não sei preço do AquaArena")' },
          resumo: { type: 'string', description: 'resumo da conversa em 1-2 frases pra equipe' },
        },
        required: ['motivo', 'resumo'],
      },
    },
  },
];

function historicoParaMensagens(
  historico: MsgHistorico[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const m of historico) {
    const corpo = (m.corpo ?? '').trim();
    let conteudo = corpo;
    if (!conteudo) {
      if (m.tipo === 'audio') conteudo = '[cliente enviou um áudio que não foi transcrito]';
      else if (m.tipo === 'texto') continue;
      else conteudo = `[cliente enviou ${m.tipo}]`;
    } else if (m.direcao === 'entrada' && m.tipo === 'audio') {
      conteudo = `[áudio transcrito] ${corpo}`;
    }
    out.push({ role: m.direcao === 'entrada' ? 'user' : 'assistant', content: conteudo });
  }
  return out;
}

// Modo fornecedor usa só estas duas ferramentas (nada de reserva/cardápio).
const FERRAMENTAS_FORNECEDOR: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'consultar_cotacoes_fornecedor',
      description:
        'Identifica o fornecedor pelo telefone da conversa e lista as cotações PENDENTES dele (itens, quantidades, embalagem, marcas aceitas e o link de resposta) + pedidos recentes. Chame antes de responder qualquer dúvida.',
      parameters: { type: 'object', properties: {} },
    },
  },
  FERRAMENTAS.find((f) => f.type === 'function' && f.function.name === 'transferir_para_humano')!,
];

/** Prompt do MODO FORNECEDOR: o mesmo número dispara cotações/pedidos — a
 *  Nina explica a cotação e o link de resposta, mas NUNCA negocia. */
function montarPromptFornecedor(nomeAtendente: string, filialNome: string): string {
  return `Você é ${nomeAtendente}, do ${filialNome}, falando com um FORNECEDOR cadastrado (não é cliente do restaurante).

CONTEXTO: este número dispara as cotações de preço e os pedidos de compra da casa. O fornecedor pode ter dúvida sobre itens, quantidades, unidades, embalagens, marcas aceitas, prazo ou como responder pelo link.

COMO AGIR:
- Tom objetivo, cordial e direto — sem emoji, sem curiosidades, mensagens curtas.
- PRIMEIRO chame consultar_cotacoes_fornecedor pra saber quem é e o que está pendente. Responda só com o que a ferramenta trouxer.
- Explique como responder: abrir o link, preencher o preço de cada item que tiver (pode deixar em branco o que não trabalha) e enviar.
- Se ele disser que não consegue atender/não tem o item: agradeça e diga que pode deixar em branco no link, ou registre e transfira pra equipe de compras.
- NUNCA negocie preço, quantidade, prazo ou condição de pagamento; NUNCA prometa compra, alteração de pedido ou exceção — isso é com a equipe de compras: use transferir_para_humano com um resumo.
- Dúvida fora de cotação/pedido (financeiro, boleto, entrega específica): transferir_para_humano.
- Nunca invente item, número ou valor. Se a ferramenta não trouxer, diga que vai passar pra equipe e transfira.

AGORA (Brasília): ${agoraBrtLegivel()}.
Sua resposta final é a mensagem enviada no WhatsApp do fornecedor.`;
}

/** Gera a resposta da Nina. Executa ferramentas via callbacks (max 5 rodadas). */
export async function gerarResposta(params: {
  nomeAtendente: string;
  filialNome: string;
  persona: string | null;
  conhecimento: BlocoConhecimento[];
  espacos: EspacoEvento[];
  historico: MsgHistorico[];
  executores: ExecutoresFerramentas;
  modo?: 'cliente' | 'fornecedor';
}): Promise<RespostaNina> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada');
  const client = new OpenAI({ apiKey });
  // gpt-4o (nao o mini): o mini chutou preco e prometeu "vou confirmar" sem
  // transferir nos testes de 08/08. Custo segue baixo (~centavos/conversa).
  const modelo = process.env.ATENDIMENTO_MODELO || 'gpt-4o';

  const modo = params.modo ?? 'cliente';
  const primeiraResposta = !params.historico.some((m) => m.direcao === 'saida');
  const system =
    modo === 'fornecedor'
      ? montarPromptFornecedor(params.nomeAtendente, params.filialNome)
      : montarSystemPrompt({ ...params, primeiraResposta });
  const mensagens: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...historicoParaMensagens(params.historico),
  ];

  let transferiu = false;
  let leadRegistrado = false;

  // 5 rodadas: da pra consultar disponibilidade, criar a reserva e ainda
  // fechar com texto (cada tool call consome uma rodada).
  for (let rodada = 0; rodada < 5; rodada++) {
    const resp = await client.chat.completions.create({
      model: modelo,
      messages: mensagens,
      tools: modo === 'fornecedor' ? FERRAMENTAS_FORNECEDOR : FERRAMENTAS,
      temperature: 0.6,
      max_tokens: 400,
    });
    const msg = resp.choices[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { texto: msg.content?.trim() || null, transferiu, leadRegistrado };
    }

    mensagens.push(msg);
    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      let resultado = 'ok';
      try {
        const args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        if (tc.function.name === 'registrar_lead_evento') {
          resultado = await params.executores.registrarLead({
            tipoEvento: String(args.tipo_evento ?? ''),
            dataEvento: /^\d{4}-\d{2}-\d{2}$/.test(String(args.data_evento ?? '')) ? String(args.data_evento) : null,
            hora: /^\d{2}:\d{2}$/.test(String(args.hora ?? '')) ? String(args.hora) : null,
            pessoas: Number(args.pessoas) > 0 ? Math.round(Number(args.pessoas)) : null,
            espaco: String(args.espaco ?? '') || null,
            nome: String(args.nome ?? '') || null,
            observacoes: String(args.observacoes ?? '') || null,
          });
          leadRegistrado = true;
        } else if (tc.function.name === 'consultar_disponibilidade_reserva') {
          resultado = await params.executores.consultarDisponibilidade(String(args.data ?? ''));
        } else if (tc.function.name === 'criar_reserva') {
          resultado = await params.executores.criarReserva({
            data: String(args.data ?? ''),
            hora: String(args.hora ?? ''),
            pessoas: Number(args.pessoas) || 0,
            area: String(args.area ?? ''),
            nome: String(args.nome ?? ''),
            observacao: String(args.observacao ?? '') || null,
          });
        } else if (tc.function.name === 'listar_opcoes_orcamento_evento') {
          resultado = await params.executores.listarOpcoesOrcamento();
        } else if (tc.function.name === 'gerar_orcamento_evento') {
          resultado = await params.executores.gerarOrcamento({
            espaco: String(args.espaco ?? ''),
            data: String(args.data ?? ''),
            hora: String(args.hora ?? '') || null,
            pessoas: Number(args.pessoas) || 0,
            nomeCliente: String(args.nomeCliente ?? ''),
            entradas: Array.isArray(args.entradas) ? args.entradas.map(String) : [],
            principais: Array.isArray(args.principais) ? args.principais.map(String) : [],
            massa: String(args.massa ?? '') || null,
            sobremesa: String(args.sobremesa ?? '') || null,
            bebidas: (['nenhuma', 'sem_alcool', 'com_alcool'] as const).includes(args.bebidas as never)
              ? (args.bebidas as 'nenhuma' | 'sem_alcool' | 'com_alcool')
              : 'nenhuma',
            observacoes: String(args.observacoes ?? '') || null,
          });
        } else if (tc.function.name === 'consultar_cardapio') {
          resultado = await params.executores.consultarCardapio(String(args.termo ?? ''));
        } else if (tc.function.name === 'consultar_cotacoes_fornecedor') {
          resultado = await params.executores.consultarCotacoesFornecedor();
        } else if (tc.function.name === 'consultar_mesa') {
          resultado = await params.executores.consultarMesa(String(args.numero ?? ''));
        } else if (tc.function.name === 'cancelar_reserva') {
          resultado = await params.executores.cancelarReserva(String(args.data ?? '') || null);
        } else if (tc.function.name === 'transferir_para_humano') {
          resultado = await params.executores.transferir(
            String(args.motivo ?? 'não informado'),
            String(args.resumo ?? ''),
          );
          transferiu = true;
        } else {
          resultado = 'ferramenta desconhecida';
        }
      } catch (e) {
        resultado = `erro: ${e instanceof Error ? e.message : String(e)}`;
      }
      mensagens.push({ role: 'tool', tool_call_id: tc.id, content: resultado });
    }
  }

  // Estourou as rodadas com tool calls — devolve sem texto; motor manda fallback.
  return { texto: null, transferiu, leadRegistrado };
}
