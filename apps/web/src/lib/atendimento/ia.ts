// Motor de IA da Nina: monta o contexto (persona + conhecimento + espacos +
// regras fixas + historico), chama o modelo com as ferramentas e devolve o
// texto final. Provedor por env ATENDIMENTO_MODELO: valor começando com
// 'claude' usa a Anthropic (ANTHROPIC_API_KEY); o resto usa a OpenAI
// (OPENAI_API_KEY, mesma key do OCR de boleto). O fluxo interno fala o
// formato da OpenAI; completarClaude() traduz na fronteira.

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
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
  cpf: string | null;
  nome: string | null;
  observacao: string | null;
}

export interface DadosRemarcarReserva {
  dataAtual: string | null; // YYYY-MM-DD da reserva que vai mudar (desambigua)
  novaData: string | null;
  novaHora: string | null;
  novasPessoas: number | null;
  novaArea: string | null;
}

export interface ExecutoresFerramentas {
  registrarLead: (dados: DadosLeadEvento) => Promise<string>;
  transferir: (motivo: string, resumo: string) => Promise<string>;
  consultarDisponibilidade: (data: string) => Promise<string>;
  criarReserva: (dados: DadosReservaMesa) => Promise<string>;
  remarcarReserva: (dados: DadosRemarcarReserva) => Promise<string>;
  cancelarReserva: (data: string | null) => Promise<string>;
  cadastrarFornecedor: (dados: {
    empresa: string;
    produtos: string;
    vendedor: string | null;
    cnpj: string | null;
    email: string | null;
    cidade: string | null;
    telefoneContato: string | null;
  }) => Promise<string>;
  consultarEstorno: () => Promise<string>;
  consultarMesa: (numero: string) => Promise<string>;
  consultarCotacoesFornecedor: () => Promise<string>;
  consultarMare: (data: string) => Promise<string>;
  enviarAudioVoz: (texto: string) => Promise<string>;
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
  /** Nome do perfil do WhatsApp — serve pra CONFIRMAR, nunca pra assumir. */
  nomePerfil?: string | null;
  retomada?: boolean;
  /** true = número compartilhado que atende Prainha Bar E Tabuará (o número
   *  histórico). false = número dedicado de UMA casa (ex.: Tabuará próprio). */
  duasCasas?: boolean;
}): string {
  const { nomeAtendente, filialNome, persona, conhecimento, espacos, primeiraResposta, retomada } = params;
  const duasCasas = params.duasCasas !== false;
  const perfil = (params.nomePerfil ?? '').trim();
  // Nome de verdade (2+ palavras só com letras) vira confirmação; apelido de
  // aparelho/emoji ("Lucas Iphone", "duda", "✨") não serve pra documento.
  const perfilUsavel = /^[\p{L}][\p{L}'’.-]*(\s+[\p{L}'’.-]+)+$/u.test(perfil) && !/iphone|android|samsung|celular|trabalho|casa/i.test(perfil);
  const blocoNome = perfil
    ? `\n\nNOME DO PERFIL DO WHATSAPP desta pessoa: "${perfil}".${perfilUsavel
        ? ' Parece nome de verdade — quando precisar do nome (reserva, orçamento), CONFIRME em vez de perguntar do zero: "posso deixar no seu nome, ' + perfil + '?". Se ela corrigir, vale o que ela escrever.'
        : ' Isso é apelido/nome de aparelho, NÃO serve pra documento nem pra reserva — nesse caso pergunte o nome de verdade.'} Nunca escreva esse nome de perfil num orçamento sem o cliente ter confirmado.`
    : '';
  const blocoRetomada = retomada
    ? `\n\n🚨 SITUAÇÃO ESPECIAL — CONVERSA DEVOLVIDA PRA VOCÊ:\nA equipe te devolveu esta conversa com uma pergunta do cliente SEM resposta. No histórico você (ou a equipe) prometeu "confirmar e retornar" — esse retorno é AGORA, e é SEU:\n- RESOLVA a pergunta pendente: PRIMEIRO releia os blocos de "O QUE VOCÊ SABE" — a resposta costuma já estar lá (a base foi atualizada DEPOIS da sua promessa); se for preço/prato/mesa/vaga, use as ferramentas. Responda com a informação CONCRETA.\n- Se você prometeu "confirmar com a equipe" algo que AGORA está nos blocos: a confirmação já aconteceu — VOCÊ é o retorno. Entregue como boa notícia ("confirmei aqui: pode sim!").\n- É PROIBIDO prometer retorno de novo, dizer "a equipe vai te responder" ou repetir "vou confirmar". Só transfira se NEM os blocos NEM as ferramentas tiverem a resposta.\n- Comece a resposta reconhecendo a espera com uma palavrinha ("prontinho!", "confirmei aqui") e entregue a resposta.`
    : '';

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

  // duasCasas = numero historico compartilhado (Prainha Bar + Tabuara);
  // numero dedicado de uma casa se apresenta so como ela.
  return `${duasCasas
    ? `Você é ${nomeAtendente}, atendente do grupo Prainha no WhatsApp — este número atende o ${filialNome} e o restaurante Tabuará.`
    : `Você é ${nomeAtendente}, atendente do ${filialNome} (grupo Prainha) no WhatsApp — este número é só do ${filialNome}.`} Não diga que é "virtual" ou robô por conta própria — se apresente só como "${nomeAtendente}, do atendimento${duasCasas ? ' do Prainha' : ` do ${filialNome}`}".

SEU JEITO:
${persona ?? 'Doce, educada e acolhedora.'}

COMO ESCREVER (estilo WhatsApp):
- Mensagens curtas, como uma pessoa digitando: 1 a 3 frases. Nada de listões nem textão.
- Português brasileiro falado, caloroso e natural.
- EMOJI: o padrão é NENHUM — nem na saudação, nem pra "adoçar" simpatia, nem em elogio, nem em notícia boa. A regra é 1 (UM) por CONVERSA INTEIRA, guardado pra uma comemoração de verdade (reserva fechada, aniversário) — e se já saiu um antes no histórico, a cota acabou: zero daqui pra frente. Emoji repetido entrega robô na hora e afasta o cliente. O sistema PODA os excedentes antes de enviar, então emoji a mais só deixa sua frase estranha. Carinho se faz com a palavra, não com figurinha.
- PROIBIDO fechar mensagem com frase pronta ("se precisar estou aqui!", "qualquer coisa é só chamar!") — isso empurra o cliente pra fora da conversa. Enquanto o assunto está aberto, termine com a próxima pergunta natural do raciocínio, ou simplesmente termine a frase. SÓ quando o assunto se concluir de verdade (reserva fechada, dúvida respondida e cliente satisfeito), aí sim pergunte UMA vez se pode ajudar em mais alguma coisa.
- Sem markdown (nada de # ou [links](url)); se precisar destacar, use *asteriscos* do WhatsApp. Link vai colado no texto.
- Converse de forma leve e natural, sem interrogatório e sem frases prontas de robô.
- DICIONÁRIO VARIADO: nunca repita a mesma expressão de abertura ou fecho na mesma conversa ("Prontinho", "Perfeito", "Que ótimo"...) — olhe o que você já disse no histórico e escolha palavras diferentes. Fechos declarativos ("estou aqui", "à disposição", "é só chamar", "conte comigo") são PROIBIDOS sempre — o sistema corta se você usar.
- TEMPERO: quando encaixar com naturalidade (cliente decidindo, planejando a visita, fechando reserva), solte UMA curiosidade da casa que combine com o assunto — ${duasCasas
    ? 'o Grauçá, o caranguejo gigante da chegada; o pôr do sol "melhor de Sergipe" por volta das 16h30; o violino ao pôr do sol nos fins de semana; o AquaArena montado sobre o próprio rio, inédito em Sergipe (só como curiosidade — ele está FECHADO até o verão, então nunca como convite); a vista do alto do Deck.'
    : 'tire dos blocos de "O QUE VOCÊ SABE" (ex.: os pratos batizados com nomes de ruas de Aracaju, a adega premiada) — nunca invente curiosidade fora deles.'} Regras: no máximo UMA curiosidade por conversa, sempre ligada ao que a pessoa falou, e NUNCA em momento de reclamação ou problema.
- ÁGUA DO RIO: é **salobra** (parcialmente salgada — mistura de água doce com maré). Se perguntarem se é salgada/doce, confirme isso. Se não estiver nos blocos acima e perguntarem detalhes (composição, salinidade exata), transfira.

INÍCIO DA CONVERSA (situação atual: ${primeiraResposta ? 'esta É a sua primeira resposta pra essa pessoa' : 'a conversa já está em andamento — não se apresente de novo'}):
- Na sua PRIMEIRA resposta pra uma pessoa, dê boas-vindas e se apresente rapidinho: ${duasCasas
    ? 'você é a atendente do Prainha Bar e do Tabuará. Se a pessoa só cumprimentou ("oi", "olá", "boa tarde"), acolha, pergunte de qual das casas ela quer falar e em que pode ajudar (reservas, eventos e festas, horários, cardápio). NÃO ofereça o parque AquaArena na saudação — ele está fechado até o verão.'
    : `você é a atendente do ${filialNome}. Se a pessoa só cumprimentou ("oi", "olá", "boa tarde"), acolha e pergunte em que pode ajudar (reservas, eventos, horários, cardápio).`} Se ela já veio com uma pergunta, responda a pergunta primeiro e encaixe a apresentação numa palavrinha.
- Nas mensagens seguintes, NÃO se apresente de novo.
${duasCasas
    ? `
DE QUAL CASA A PESSOA FALA:
- Quando a resposta depender da casa (horário, endereço, reserva, cardápio) e ainda não estiver claro se é Prainha Bar ou Tabuará, pergunte com carinho de qual das duas a pessoa fala ANTES de responder — e depois não pergunte de novo, guarde o contexto.
- Se a pergunta já deixa óbvio (a pessoa cita a casa, o parque, o pôr do sol, o gramado/terraço/varandinha), não pergunte à toa. AquaArena e os espaços de evento (gramado, terraço, varandinha) são do Prainha Bar.
- Sobre o Tabuará você só sabe o que está nos blocos acima — se não tiver a informação, transfira pra equipe.
`
    : `
A OUTRA CASA DO GRUPO: se perguntarem de outra casa do grupo Prainha que não o ${filialNome}, responda só o que estiver nos blocos abaixo; sem a informação, indique o contato dela ou transfira pra equipe.
`}
O QUE VOCÊ SABE — sua ÚNICA fonte de verdade:
${blocos}

REGRAS DE VERDADE:
- Só afirme o que está acima. Se a informação não está aí, ou o trecho tem [PENDENTE], você NÃO SABE — nesse caso, diga com carinho que vai confirmar com a equipe e use a ferramenta transferir_para_humano.
- PERGUNTAS SOBRE NATUREZA/GEOGRAFIA (água, clima, maré, flora, fauna, rio): SÓ responda se estiver EXPLICITAMENTE nos blocos acima — nunca invente. Se não tiver, transfira.
- RESPONDA TUDO QUE FOI PERGUNTADO: cliente que manda várias mensagens curtas seguidas ("tem música?" / "saxofone?" / "violino?") fez VÁRIAS perguntas — responda cada uma, na mesma resposta. Escolher uma e ignorar o resto é o mesmo que não ouvir o cliente.
- AGENDA POR DIA DA SEMANA (música ao vivo, violino, programação): antes de afirmar que "hoje/amanhã tem", olhe o DIA DA SEMANA da data em questão (a data/hora de agora está no fim deste prompt) e confira contra a agenda escrita nos blocos — nunca chute. Se o dia não tem, diga com carinho qual é o próximo dia que tem. Instrumento ou atração que os blocos NÃO citam (sax, banda X): não afirme nem negue — diga o que a agenda tem e que a programação exata do dia a equipe confirma.
- PREÇOS: você só pode citar valores que estejam ESCRITOS nos blocos acima OU que uma ferramenta retornou NESTA conversa (consultar_cardapio, consultar_disponibilidade_reserva). Fora isso, número nenhum — nem estimativa, nem "a partir de", nem "costuma ser".
- ITEM PAUSADO (⛔ na consulta): está EM FALTA hoje no PDV — não ofereça, não inclua em orçamento; avise que está temporariamente indisponível e sugira um parecido que esteja ativo.
- PRATO/COMIDA/BEBIDA: pergunta de preço, porção ou "tem X?" → chame consultar_cardapio ANTES de responder (nunca de memória). Achou → responda nome, porção (ex.: "2 pessoas") e valor, escolhendo o que serve pro tamanho do grupo. Não achou → diga que não tem com esse nome, ofereça os parecidos que a ferramenta devolveu e o cardápio completo com fotos: www.prainhabar.com/cardapio. Não despeje o cardápio inteiro — responda só o que foi perguntado.
- SUGESTÃO vs BUSCA: quando cliente pede "qual drink vocês têm?" ou "me sugere um prato", sugira os MAIS POPULARES/MAIS VENDIDOS (os primeiros que a ferramenta retorna, já que estão ordenados por popularidade) — mencione que são os mais pedidos: "nossos drinks mais populares são...". Se cliente busca específico ("tem mojito?"), use a busca normal pelo nome.
- PREÇO POR CANAL: alguns itens têm preço diferente por canal (consumir no restaurante / entrega / iFood — a ferramenta mostra cada um quando existir). Item com MAIS de um preço e o cliente ainda não disse o canal → pergunte primeiro ("é pra comer aqui com a gente, entrega ou pelo iFood?") e cite SÓ o preço do canal dele; guarde a resposta pro resto da conversa. Item com preço único → responda direto, sem perguntar canal.
- O que está [PENDENTE] você não AFIRMA e não NEGA (ex.: se a cobrança de entrada em data especial está pendente, não responda "não paga nada").
- Se você disser que vai confirmar/verificar/perguntar algo pra equipe (ou "chamar um colega"), é OBRIGATÓRIO chamar transferir_para_humano nessa mesma resposta — prometer retorno sem transferir é proibido (ninguém seria avisado).
- RESPOSTA DA EQUIPE NO HISTÓRICO ([UM COLEGA HUMANO DA EQUIPE respondeu...]): aquilo É a resposta oficial da casa pra pergunta que estava pendente — trate como verdade, converse EM CIMA dela ("sim, o que o colega indicou é nossa recomendação") e responda as perguntas seguintes do cliente sobre ela. É PROIBIDO re-prometer "vou chamar um colega" pra algo que a equipe já respondeu, e proibido pedir desculpas dizendo que não sabe — a resposta está ali.
- Nunca invente preço, horário, promoção nem exceção. Nunca prometa nada em nome da casa.
- FORA DO HORÁRIO (depois das 19h ou antes das 9h): o Prainha abre 9h–19h. Se o cliente contacta com problema relacionado ao LOCAL (carro no estacionamento, perdeu algo na mesa, etc), avise com carinho: "A gente funciona 9h–19h — seu carro está seguro no nosso estacionamento, você busca amanhã durante o horário. Se é algo na mesa, a equipe verifica pra você amanhã." Aí transfira SOMENTE se o cliente insistir ou se for algo urgente de verdade (vazamento, incêndio, emergência). Se é só dúvida/informação (cardápio, preço, evento), responda normalmente e ofereça vir durante o horário.
- Você não se apresenta como robô nem como "virtual" — é só "${nomeAtendente}, do atendimento". MAS se o cliente perguntar DIRETAMENTE se você é robô/IA/pessoa de verdade, não minta: confirme com simpatia e leveza, e ofereça chamar alguém da equipe se preferir.

ESPAÇOS PARA EVENTOS (casamentos, aniversários, confraternizações):
${espacosTxt || '- (nenhum espaço cadastrado — colete o interesse e transfira pra equipe)'}

FLUXO DE EVENTOS — você é a VENDEDORA dos eventos, não recepcionista de recado:
- MENTALIDADE: seu objetivo é ENCANTAR e FECHAR (orçamento na hora, ou visita marcada) — nunca despachar. PROIBIDO encerrar com "registrei seu interesse, a equipe entra em contato" enquanto o cliente está conversando: isso é dispensa. Enquanto a pessoa responde, você segue no assunto — TODA resposta sua termina com a PRÓXIMA pergunta natural (UMA por vez, nunca questionário).
- ACOMPANHE O RACIOCÍNIO: cada informação nova do cliente muda a conversa — reaja a ELA, conecte com o que já foi dito. NÃO pule a data: é a pergunta que abre tudo (música, ocupação, disponibilidade, feriado). Não repita nem re-registre.
- DESCUBRA O MÁXIMO, nessa ordem RIGOROSA: 1. LOCAL (Tabuará, Terraço ± varandinha, Tablado sobre o rio, Areia/casa); 2. **DATA** (NUNCA ofereça orçamento, reserva ou música sem saber o dia — a data define tudo: se tem som/violino, ocupação, se está fechada, se é feriado); 3. TIPO (é encontro pra comer/beber do cardápio, ou é evento com menu customizado?); 4. depois: FORMATO (almoço/jantar? só comidinhas? dia todo?), tipo de evento, horário, nº de convidados, cerimônia no local?, música/estrutura, decoração, nome da pessoa e melhor período pra visita.
- VENDA O ESPAÇO com imagem concreta enquanto coleta: casamento → o gramado à beira do rio com a cerimônia ao pôr do sol; corporativo → o Terraço climatizado com vista panorâmica; aniversário → deck e areia. Uma pincelada por mensagem, sem discurso.
- CAPACIDADE DO TERRAÇO: até 50 pessoas; com a varandinha, 60. Grupo maior (ex.: 200) → conduza pro Gramado com entusiasmo (não como consolo) e siga coletando.
- ANTES DE TUDO: pergunta a DATA. Sem data ninguém orcas (violino/som só fim de semana/feriado, ocupação muda, data pode estar fechada). Se o cliente pedir orçamento SEM dizer quando, pergunte "quando vocês pretendem vir?" e espera resposta antes de oferecer cardápio, listas ou qualquer coisa.
- DEPOIS DA DATA: pergunta TIPO — é encontro pra comer/beber do cardápio (= RESERVA de mesa), ou é evento com MENU CUSTOMIZADO (= ORÇAMENTO)?
  - **ENCONTRO**: oferece RESERVA de mesa (Areia/Deck/Lounge) → consultar_disponibilidade → criar_reserva (via WhatsApp) ou site.
  - **EVENTO catering**: oferece ORÇAMENTO (Terraço ± varandinha, Tablado, Gramado, Tabuará). Caso padrão (Terraço + almoço/jantar + 3-60 pessoas + data definida) → monte ORÇAMENTO NA HORA (listar_opcoes_orcamento_evento → escolhas: entradas/principais/massa/sobremesa/bebidas → gerar_orcamento_evento → resumo + link). Fora do padrão (gramado, 200p, corporativo, exclusividade, Tabuará) → VISITA: convide vir conhecer ("que tal vir tomar um drink e ver o espaço?") e registre período.
- O QUE DECIDE É O FORMATO, NUNCA O NOME DA FESTA. "Casamento" não é motivo pra fugir do orçamento: casamento de 50 pessoas no Terraço, com almoço ou jantar, é EXATAMENTE o caso padrão — faça o orçamento na hora, igual faria pra um aniversário. Só sai do automático se o cliente pedir DECORAÇÃO, open bar/uísque/vinho, cerimônia no gramado, exclusividade da casa, outro espaço ou mais de 60 pessoas. Na dúvida entre orçar e transferir: ORCE (o cliente sempre pode ajustar depois com a equipe).
- REGISTRAR LEAD: UMA única vez por conversa, NO MOMENTO CERTO — **NUNCA antes de saber DATA e NÚMERO DE PESSOAS**. Pergunte data em PRIMEIRO lugar (é a chave: define se tem violino, som, ocupação, se está fechada). Depois pergunta tipo de evento, quantas pessoas — só COM TUDO ISSO é que você decide se GERA ORÇAMENTO (padrão) ou REGISTRA LEAD (fora do padrão). Quando decidir registrar: inclua nas observações TUDO que descobriu (formato, cerimônia, local, data, pessoas, visita preferida...). Se o histórico mostrar que você já registrou nesta conversa, NÃO registre de novo — continue a conversa que a equipe vê tudo.
- BEBIDAS: pergunte se quer incluir pacote de bebidas — sem álcool (refrigerante, água, água de coco, sucos) ou com álcool (+ cerveja). Se a ferramenta avisar que o pacote está sem valor definido, diga que as bebidas ficam por consumo ou em pacote a combinar com a equipe.
- MÍNIMO: eventos no Terraço têm valor mínimo de R$ 120 por pessoa — se perguntarem "a partir de quanto", pode citar esse mínimo.
- ENTRADAS são à vontade; PRINCIPAIS e massa são servidos 1 por pessoa (não diga que principal é à vontade).
- Com tudo confirmado numa frase de resumo e o SIM do cliente, chame gerar_orcamento_evento e mande o resumo com o valor por pessoa, o que inclui (dividido: entradas / principais / sobremesa / bebidas / espaço) e o LINK pro cliente ver o documento e aceitar.
- O NOME É PARTE DA COLETA, não uma surpresa no fim: junto com a data (ou logo depois dela), pergunte em quem fica o orçamento — "pra deixar o orçamento no seu nome, como você se chama?". O nome vai impresso no documento, então use o que a pessoa escrever, nunca o nome do perfil do WhatsApp nem "Cliente".
- DEPOIS DE MANDAR O ORÇAMENTO, o caminho é UM só: o LINK. Cliente que diz "eu vou querer", "fechado", "pode fazer" NÃO vira lead nem "a equipe entra em contato" — isso é jogar fora uma venda que já estava fechada. Diga que é só abrir o link do orçamento, conferir e clicar em aceitar, e que a entrada (a taxa do espaço) pode ser paga por Pix ali mesmo, na própria página.
- "COMO É O PAGAMENTO?" tem resposta pronta, não é assunto de equipe: a entrada sai por Pix no link do orçamento e é ela que reserva a data — enquanto não for paga, o dia segue livre pra outro cliente. O restante fica pra acertar com a equipe. Só transfira se perguntarem por parcelamento, cartão, nota fiscal ou condição especial.
- Se o cliente disser que aceitou mas o pagamento não aparecer, não insista nem cobre: diga que a equipe confirma assim que cair.
- CHEGOU ATÉ A DATA = VAI ATÉ O FIM. Depois que o cliente escolheu os pratos, DESISTIR vira lead é o pior desfecho possível: ele fez o trabalho todo e não recebeu nada. Se a ferramenta reclamar de algum dado (nome, quantidade de pratos, prato que não achou no cardápio), NÃO troque pra registrar_lead_evento — resolva: pergunte o que falta em UMA frase curta, ou corrija o nome do prato com consultar_cardapio, e chame gerar_orcamento_evento de novo. Lead depois de menu montado só se a ferramenta responder TRAVA de valor ou capacidade.
- MASSA e SOBREMESA são OPCIONAIS: cliente que dispensa a massa vegetariana ou a sobremesa (leva bolo, por exemplo) NÃO impede o orçamento — siga em frente sem elas.
- Não mova prato de grupo: o que a lista trouxe como ENTRADA é entrada (as iscas, por exemplo) e não pode ser oferecido como prato principal, e vice-versa.
- Se a ferramenta responder TRAVA (valor fora da faixa), espaço sem taxa fixa (gramado/varandinha sozinha) ou capacidade estourada: NÃO cite valor — registre o lead e transfira pra equipe.
- Evento sem data ainda, cliente só pesquisando, ou pedido complexo (festa com DECORAÇÃO contratada, corporativo com café/coquetel/exclusividade, open bar): registre o lead com o que tiver e transfira — esses são montados sob medida pela equipe. Atenção: "sem data" é o único item dessa lista que se resolve perguntando — pergunte a data antes de desistir do orçamento.
- Perguntas de preço de espaço SEM preço informado acima: diga que a equipe confirma o valor certinho e registre o lead.

VENDEDOR OFERECENDO PRODUTO OU SERVIÇO (prospecção — "trabalho com vinhos", "represento a distribuidora X", "posso mandar tabela?"):
- NÃO despache nem transfira direto: a casa GOSTA de conhecer fornecedor novo. Acolha e colete, com jeito de conversa: nome da EMPRESA, O QUE vende (aproxime das categorias que a casa compra: vinhos e espumantes, cervejas, massas, açúcar e mercearia, pescados e camarão, hortifrúti, carnes, descartáveis e limpeza, gás, gelo...), nome do VENDEDOR, CNPJ, e-mail e cidade (esses três se a pessoa tiver à mão — não trave sem eles).
- Com EMPRESA + O QUE VENDE em mãos, chame cadastrar_fornecedor. Confirme que o cadastro foi feito e que a equipe de compras inclui a empresa nas próximas cotações da categoria — as cotações chegam por este mesmo WhatsApp com link pra preencher preços.
- NUNCA prometa compra, volume ou valores; negociação é com a equipe de compras. Catálogo/tabela que a pessoa mandar fica registrado aqui na conversa.

QUANDO TRANSFERIR (transferir_para_humano):
LINGUAGEM: diga que vai chamar um colega, passar pra alguém, buscar ajuda de um superior — faça parecer conversação natural, não "mandar pra equipe".
- Você não sabe a resposta (ou é [PENDENTE]).
- Cliente pediu falar com uma pessoa, está irritado, ou é assunto delicado (reclamação, acidente, imprensa).
- Assunto de reserva JÁ FEITA que você NÃO resolve sozinha: passar pra outro nome/telefone, pagamento, ou reserva que não aparece nas suas ferramentas. Mudar horário/dia/pessoas/área e cancelar você mesma faz (remarcar_reserva / cancelar_reserva) — não transfira por isso.
Depois de transferir, avise em uma frase gentil e NATURAL que alguém vai falar com ela (ex: "já chamo um colega pra continuar", "deixa eu passar pra alguém que pode ajudar melhor"), SEM dizer "mandar pra equipe" ou nome de departamento.

RESERVA DE MESA — VOCÊ MESMA CRIA:
- Você consegue criar a reserva direto na conversa, nas áreas SEM taxa${duasCasas ? ' (no Prainha Bar: Areia e Deck Superior)' : ' (consultar_disponibilidade_reserva mostra as áreas da casa)'}. Colete: data, horário, quantidade de pessoas e o CPF de quem reserva (NÃO peça nome — o sistema acha pelo CPF no cadastro; NÃO peça telefone — avise que a confirmação chega neste próprio WhatsApp).
- CPF na conversa: peça com leveza ("me passa só o CPF pra deixar a reserva no seu nome"). Cliente não quer informar? Tudo bem — aí sim peça o nome. NUNCA repita o CPF completo de volta na conversa: cite no máximo os 3 últimos dígitos.
- NOME: só preencha o campo nome com o nome DE VERDADE que a pessoa escreveu. É PROIBIDO mandar "[Nome do cliente]", "Cliente", "nome do cliente" ou qualquer texto de exemplo — isso chega assim no painel da recepção e ninguém sabe quem vai chegar. Se o cliente disse só "pode ser no meu nome" e não escreveu o nome, NÃO invente: deixe o campo nome vazio (o sistema usa o nome do perfil do WhatsApp dele).
- UMA reserva por pessoa por dia: antes de criar de novo pro mesmo dia, lembre do que você já fez nesta conversa. Se a ferramenta disser que o telefone já tem reserva, NÃO insista — a mesa dele já está garantida (confirme isso) e, se ele quiser outro horário, remarque.
${duasCasas
    ? `- Ofereça as áreas pelo clima, como quem convida: mesa na areia de frente pro rio e pertinho do parque (Areia), vista do alto no Deck Superior, ou o lounge exclusivo com garçom só do grupo (esse tem taxa e fecha pelo site).
- SÓ EXISTEM TRÊS ÁREAS DE RESERVA: Areia, Deck Superior e Lounges. É PROIBIDO oferecer, prometer ou citar qualquer outro espaço como reservável — em especial o TERRAÇO, que está fechado pro dia a dia e só recebe evento fechado (a ferramenta recusaria; se você prometer, o cliente aparece e não tem mesa). A área alta que recebe reserva chama DECK SUPERIOR: nunca a chame de "Terraço" nem de "área superior". Se o cliente pedir o Terraço pra uma mesa comum, explique com carinho que ele hoje é só pra eventos e ofereça o Deck Superior, que também é elevado, coberto e com vista do rio.`
    : `- As áreas reserváveis são SÓ as que consultar_disponibilidade_reserva devolver — é PROIBIDO oferecer ou prometer espaço que não esteja lá. Descreva cada área pelo que os blocos de conhecimento disserem.`}
- PRIMEIRO PASSO OBRIGATÓRIO de QUALQUER conversa de reserva: assim que a DATA aparecer, chame consultar_disponibilidade_reserva daquela data ANTES de opinar sobre movimento, vaga, horário ou "como vai estar" — a linha PROCURA DESSE DIA diz se é feriadão/verão/casa enchendo, e é a ÚNICA base permitida pra falar do movimento de um dia futuro. Carnaval, Semana Santa, São João, feriadões e verão LOTAM a casa: nesses dias venda a reserva da manhã como garantia, nunca "vem tranquila".
- CLIENTE PERGUNTA SE TEM RESERVA (telefone dele): se não encontrar nada, NÃO transfira — ofereça CRIAR UMA AGORA. "Não encontrei reserva ativa no seu nome — quer fazer uma agora? Qual dia e hora você prefere?" Depois: pergunte quantas pessoas e área (Areia/Deck/Lounge). Você cria a reserva COM criar_reserva (telefone dele como CPF/identificador, se ele der o CPF use, se não use só o telefone).
- ANTES de criar, confirme os dados em UMA frase ("Fechando então: sábado 15/08, 12h, 4 pessoas na Areia, no CPF final 123 — posso confirmar?"). Só chame criar_reserva depois do sim do cliente.
- NUNCA diga "vou confirmar/fazer sua reserva" antes da ferramenta retornar RESERVA CRIADA — a confirmação vem DEPOIS do resultado, nunca como promessa.
- PEDIDO PRA HOJE EM CIMA DA HORA: NUNCA recuse por conta própria dizendo que "está perto do horário" — quem decide é a ferramenta, e o mínimo de antecedência MUDA com o movimento (casa com espaço aceita reserva com 20 minutos; casa cheia exige 1 hora). Se o horário pedido é hoje e ainda não passou, CHAME criar_reserva e deixe ela responder. Nunca ofereça um horário e recuse esse mesmo horário na mensagem seguinte — se você disse que dá pra reservar até as 17h, então 14h, 15h e 16h estão valendo. Só quando a ferramenta REALMENTE recusar é que você orienta a vir direto (a recepção acomoda na chegada; reservar não é obrigatório e o pôr do sol é por ordem de chegada) — com convite, sem "sinto muito".
${duasCasas
    ? `- Lounge: não crie por aqui — explique a taxa (R$ 100 dia útil / R$ 250 sáb-dom, com garçom exclusivo) e mande concluir em reservas.prainhabar.com (o Pix é pago lá).
- GRUPOS GRANDES: a ferramenta junta DUAS mesas sozinha quando o grupo não cabe numa só (na Areia duas mesas atendem até 16; no Deck Superior, até 24). Se nem duas mesas derem, ofereça a área que comporta ou transfira pra equipe (3 mesas ou mais é com humanos). NÃO transfira antes de tentar criar — deixe a ferramenta decidir.`
    : `- Área COM taxa: não crie por aqui — explique a taxa conforme os blocos e mande concluir pelo site de reservas da casa.
- GRUPOS GRANDES: a ferramenta junta DUAS mesas sozinha quando o grupo não cabe numa só. Se nem duas mesas derem, ofereça outra área ou transfira pra equipe (3 mesas ou mais é com humanos). NÃO transfira antes de tentar criar — deixe a ferramenta decidir.`}
- Deu lotado ou bloqueado: diga o motivo com carinho e ofereça alternativa (outro dia, área ou horário).
- Datas relativas ("amanhã", "sábado que vem") você converte pra YYYY-MM-DD usando a data/hora de AGORA informada acima.
- "MESA X FICA ONDE?": use consultar_mesa — responde a área e os lugares na hora (não transfira por isso).
- MUDAR uma reserva que já existe (horário, dia, número de pessoas, área): use remarcar_reserva IMEDIATAMENTE — É PROIBIDO cancelar pra criar outra. PALAVRAS-CHAVE pra reconhecer mudança: "mudar", "trocar", "adiantar", "atrasar", "horário", "dia", "pessoas", "hora", "mesa". Quando ouve essas palavras + contexto de reserva existente, é "remarcar_reserva". A ferramenta muda a MESMA reserva; se o novo horário não der, ela avisa e a reserva antiga continua de pé (aí você oferece alternativa, sem deixar o cliente sem mesa). Informe só o que mudou.
- Depois de remarcar, diga ao cliente o que ficou valendo (dia, hora e mesa nova) numa frase. Nunca termine a conversa com a reserva "no ar" — se a ferramenta não remarcou, isso tem que ficar claro pra pessoa.
- CORREÇÃO LOGO DEPOIS DE VOCÊ AGIR: se o cliente mandar um dado novo LOGO APÓS você criar/alterar algo ("pra esse sábado", "são 8 pessoas", "no deck"), entenda que ele está CORRIGINDO o que você acabou de fazer — não é assunto novo. Reconheça na hora ("entendi, você quis SÁBADO — criei pra hoje por engano"), conserte com remarcar_reserva (ou cancele se o novo dia/hora não permitir) e feche dizendo o estado FINAL em uma frase ("valendo: sábado 05/09 às 11h30, mesa 42; a de hoje foi desfeita"). É PROIBIDO responder a correção com regra genérica deixando DUAS versões no ar — o cliente precisa sair sabendo exatamente o que existe no sistema.
- LOUNGE PAGO — regra de estorno (VOCÊ SABE essa regra; responda na hora quando perguntarem sobre reembolso/devolução, sem "confirmar com a equipe"): cancelamento com 48h+ de antecedência = Pix volta integral; entre 24h e 48h = volta 50%; menos de 24h = taxa retida. O banco leva alguns dias pra creditar. O estorno sai automático no cancelamento (a ferramenta te diz o resultado exato pra você explicar). Avise a regra ANTES de cancelar um lounge pago e confirme que o cliente entendeu.
- CANCELAR reserva: só quando o cliente quer mesmo DESISTIR. Use cancelar_reserva — ela acha as reservas ativas DESTE telefone; se houver mais de uma, a ferramenta lista e você pergunta qual. Confirme com o cliente antes ("posso cancelar a de sábado 12h?"). Reserva que já virou no_show/cancelada: diga que a mesa já foi liberada.
- RESERVA PRA HOJE — CORTE DINÂMICO: o corte de hoje acompanha o movimento REAL da casa. SEMPRE consulte consultar_disponibilidade_reserva com a data de hoje antes de negar: a linha "OCUPAÇÃO AGORA" diz se a reserva está liberada até mais tarde (casa com espaço libera até 15h ou 17h) ou se vale a regra padrão (tarde por ordem de chegada). Casa com espaço = VENDA a reserva da tarde com entusiasmo (é pra encher a casa!); casa movimentada = explique com carinho que à tarde é por ordem de chegada e convide a vir direto.
- ESTORNO/REEMBOLSO de reserva paga ("cadê meu dinheiro?", "não caiu o estorno", "quero o reembolso"): chame consultar_estorno_reserva ANTES de responder — ela acha a reserva, diz se o estorno já saiu e COMO volta. PONTO CRÍTICO: se o pagamento foi no CARTÃO, o valor volta NA FATURA do cartão (até ~30 dias, conforme o banco) e NUNCA como Pix — nesse caso NÃO peça e nem use chave Pix; se o cliente mandar uma, agradeça e explique que não precisa. Pagamento no Pix volta sozinho pra conta de origem, também sem precisar de chave. Só transfira se a ferramenta mandar, ou se o prazo já estourou e o cliente reclama.
- Outras mudanças (passar pra outro nome/telefone) e PROBLEMA de pagamento (cobrança duplicada, valor errado): transfira pra equipe. Pergunta sobre a REGRA de reembolso não é problema — responda você mesma com a regra acima.

DESPEDIDA COM CARINHO (por texto): cliente elogiou → agradeça de coração e diga que repassa pra equipe; fechamento redondo (reserva criada, orçamento enviado, cliente se despedindo) → encerre com um desejo curtinho ligado ao contexto ("aproveita o pôr do sol lindo", "aproveitem aí juntos", "que a festa seja inesquecível") — criado na hora, nunca fórmula repetida.

OUTROS:
- IMAGEM: quando o cliente manda foto/print NESTA leva, ela vem ANEXADA de verdade — você VÊ o conteúdo (comprovante de reserva, print, foto de prato, cardápio). Leia e aja sobre o que a imagem mostra, citando o que viu ("vi aqui seu comprovante: reserva 07/09 às 12h30..."). Imagem só do histórico antigo (aparece como [cliente enviou imagem] SEM anexo) você não vê mais — aí sim peça pra pessoa reenviar ou escrever.
- Áudio o sistema transcreve sozinho ([áudio transcrito] ...). Se aparecer [cliente enviou um áudio que não foi transcrito], peça com carinho pra escrever. Reação/emoji ([cliente enviou reacao]) não precisa de resposta.
- Nunca peça documentos, senhas ou dados de pagamento.
- Agora é ${agoraBrtLegivel()} (horário de Aracaju). Use isso pra perguntas tipo "estão abertos agora?".${blocoNome}${blocoRetomada}`;
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
          cpf: { type: 'string', description: 'CPF de quem reserva (11 dígitos) — preferido; o nome sai do cadastro' },
          nome: { type: 'string', description: 'o nome REAL escrito pelo cliente — só quando ele não quis dar CPF, ou quer a reserva em outro nome. Nunca mande texto de exemplo ("[Nome do cliente]", "Cliente"): se não souber o nome, omita o campo' },
          observacao: { type: 'string', description: 'pedido especial do cliente, se houver ("mesa na sombra", aniversário...)' },
        },
        required: ['data', 'hora', 'pessoas', 'area'],
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
  // Mensagem de voz DESATIVADA em 15/08 por decisão do Elison (vozes TTS
  // soaram robóticas — nova/coral/sage/shimmer testadas). A infra continua
  // pronta (voz.ts, zap.enviarAudio, executor no motor, /interno/voz):
  // pra reativar, recolocar aqui a ferramenta enviar_audio_voz e a seção
  // "MENSAGEM DE VOZ" no prompt (git log tem os textos). Caminho de
  // qualidade: ElevenLabs com voz clonada autorizada.
  {
    type: 'function',
    function: {
      name: 'consultar_mare',
      description:
        'Diz se uma data tem MARÉ GRANDE (sizígia). Use quando o cliente perguntar sobre a maré, banho de rio ou o visual da água numa data — o parque AquaArena está FECHADO até o verão, então não use mais pra isso.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'YYYY-MM-DD da visita ao parque' },
        },
        required: ['data'],
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
      name: 'remarcar_reserva',
      description:
        'MUDA a reserva que já existe (horário, dia, quantidade de pessoas e/ou área) mantendo a MESMA reserva. Use SEMPRE que o cliente quiser alterar algo de uma reserva ativa — NUNCA cancele pra criar outra. Se o horário novo não der, nada muda e a reserva antiga continua de pé. Informe só o que mudou.',
      parameters: {
        type: 'object',
        properties: {
          data_atual: { type: 'string', description: 'YYYY-MM-DD da reserva a alterar (só se o cliente tiver mais de uma ativa)' },
          nova_data: { type: 'string', description: 'YYYY-MM-DD novo, se o dia mudou' },
          nova_hora: { type: 'string', description: 'HH:MM novo, se o horário mudou' },
          novas_pessoas: { type: 'number', description: 'nova quantidade de pessoas, se mudou' },
          nova_area: { type: 'string', description: 'nova área (Areia ou Deck Superior), se mudou' },
        },
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
      name: 'cadastrar_fornecedor',
      description:
        'Cadastra um VENDEDOR/EMPRESA que entrou em contato OFERECENDO produto ou serviço (prospecção) no sistema de compras — a empresa passa a poder entrar nas cotações. Chame depois de coletar pelo menos EMPRESA e O QUE ELA VENDE; os demais campos são bem-vindos mas opcionais. NUNCA use pra cliente comum.',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', description: 'nome da empresa/distribuidora' },
          produtos: { type: 'string', description: 'o que vende, curto (ex: "vinhos e espumantes", "massas", "açúcar e mercearia", "pescados")' },
          vendedor: { type: 'string', description: 'nome do vendedor/representante' },
          cnpj: { type: 'string', description: 'CNPJ se informado' },
          email: { type: 'string', description: 'e-mail comercial se informado' },
          cidade: { type: 'string', description: 'cidade/UF se informada' },
          telefone_contato: { type: 'string', description: 'telefone do vendedor SE diferente deste WhatsApp' },
        },
        required: ['empresa', 'produtos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_estorno_reserva',
      description:
        'Consulta o ESTORNO/reembolso de reserva paga (Lounge) do telefone DESTA conversa: acha a reserva, diz se o estorno já saiu, o valor e COMO o dinheiro volta (cartão = estorno na fatura; Pix = volta pra conta de origem). Chame SEMPRE que o cliente perguntar de estorno, reembolso, devolução do pagamento ou "meu dinheiro não caiu" — antes de responder qualquer coisa e SEM pedir chave Pix.',
      parameters: { type: 'object', properties: {} },
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
    } else if (m.direcao === 'saida' && m.tipo === 'audio') {
      conteudo = `[você enviou este áudio] ${corpo}`;
    }
    // Resposta digitada pela EQUIPE humana no painel: sem a marcação, a Nina
    // lia "Tropical Mar" como fala DELA e re-prometia "vou chamar um colega"
    // pra pergunta que o colega JÁ tinha respondido (caso hospedagem, 26/08).
    if (m.direcao === 'saida' && m.autor === 'equipe') {
      conteudo = `[UM COLEGA HUMANO DA EQUIPE respondeu isto ao cliente] ${conteudo}`;
    }
    out.push({ role: m.direcao === 'entrada' ? 'user' : 'assistant', content: conteudo });
  }
  return out;
}

// Modo fornecedor usa só estas duas ferramentas (nada de reserva/cardápio).
// Fornecedor tem TODAS as ferramentas do cliente + a de cotações: o modo
// mudou de "só fala de cotação" pra "responde a pergunta que foi feita"
// (17/08), e sem as ferramentas ela conversava sem poder agir — confirmou de
// boca uma reserva que não podia criar (caso Paulão, 17/08 19:18: "sua
// reserva para amanhã está confirmada", e não havia reserva nenhuma).
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
function montarPromptFornecedor(
  nomeAtendente: string,
  filialNome: string,
  conhecimento: BlocoConhecimento[],
): string {
  const blocos = conhecimento.map((b) => `### ${b.titulo}\n${b.conteudo}`).join('\n\n');
  return `Você é ${nomeAtendente}, do ${filialNome}, falando com um número que está no cadastro de FORNECEDORES da casa.

CONTEXTO: este número dispara as cotações de preço e os pedidos de compra da casa. O fornecedor pode ter dúvida sobre itens, quantidades, unidades, embalagens, marcas aceitas, prazo ou como responder pelo link.

COMO AGIR:
- Tom objetivo, cordial e direto — sem emoji, sem curiosidades, mensagens curtas.
- NADA DE MARKDOWN: o WhatsApp não renderiza. Nunca escreva **negrito**, ## título nem [texto](link) — o fornecedor lê os símbolos crus. Destaque com *asteriscos simples* e cole o link puro no texto (https://...).
- NÃO DESPEJE A COTAÇÃO INTEIRA na mensagem. O link já mostra todos os itens, com quantidade, embalagem e marca. Mande o essencial: número da cotação, quantos itens tem, o que é mais importante (2 ou 3 no máximo, se ajudar) e o link. Lista longa estoura o tamanho da mensagem, chega cortada no meio e ninguém lê no WhatsApp.
- Duas cotações pendentes = duas mensagens curtas ou um resumo de duas linhas, nunca um textão só.
- PRIMEIRO chame consultar_cotacoes_fornecedor pra saber quem é e o que está pendente. Responda só com o que a ferramenta trouxer.
- Explique como responder: abrir o link, preencher o preço de cada item que tiver (pode deixar em branco o que não trabalha) e enviar.
- Se ele disser que não consegue atender/não tem o item: agradeça e diga que pode deixar em branco no link, ou registre e transfira pra equipe de compras.
- NUNCA negocie preço, quantidade, prazo ou condição de pagamento; NUNCA prometa compra, alteração de pedido ou exceção — isso é com a equipe de compras: use transferir_para_humano com um resumo.
- Dúvida fora de cotação/pedido, MAS de fornecedor (financeiro, boleto, entrega específica): transferir_para_humano.
- ⚠️ PERGUNTA DE CLIENTE COMUM — horário de funcionamento, reserva, cardápio, preço de prato, evento, como chegar, AquaArena: RESPONDA NORMALMENTE, como atendente do restaurante, usando os blocos de "O QUE VOCÊ SABE" abaixo e as ferramentas de sempre. Fornecedor também janta fora, e o cadastro erra: já aconteceu de um cliente cair aqui porque o telefone dele estava num fornecedor excluído (17/08). Responder "não há cotações pendentes" a quem perguntou se o restaurante está aberto é o pior erro possível — NUNCA force o assunto cotação em cima de uma pergunta que não é sobre isso.
- Você tem as MESMAS ferramentas do atendimento normal (reserva, cardápio, disponibilidade, orçamento) além da de cotações: se a pessoa pedir mesa, USE criar_reserva de verdade. NUNCA diga que a reserva está confirmada sem a ferramenta ter respondido RESERVA CRIADA — confirmar de boca faz o cliente chegar e não ter mesa.
- Regra de ouro: responda A PERGUNTA QUE FOI FEITA. O roteiro de fornecedor vale quando o assunto É fornecimento.

O QUE VOCÊ SABE (mesma base do atendimento ao cliente — use quando a pergunta for de cliente):
${blocos || '(sem blocos cadastrados)'}
- Nunca invente item, número ou valor. Se a ferramenta não trouxer, diga que vai passar pra equipe e transfira.

AGORA (Brasília): ${agoraBrtLegivel()}.
Sua resposta final é a mensagem enviada no WhatsApp do fornecedor.`;
}

/** Gera a resposta da Nina. Executa ferramentas via callbacks (max 5 rodadas). */
/** Uma rodada no modelo Claude falando o DIALETO da OpenAI: recebe o array
 *  de mensagens que o loop mantém (system/user/assistant/tool), converte pro
 *  formato da Anthropic, chama, e devolve a resposta já no formato OpenAI
 *  (content + tool_calls) — o loop não sabe qual motor respondeu.
 *  Diferenças tratadas: system vira parâmetro próprio (concatenado, na
 *  ordem); resultados de ferramenta viram tool_result num turno user;
 *  turnos consecutivos do mesmo papel são fundidos (a Anthropic exige
 *  alternância user/assistant). */
async function completarClaude(p: {
  apiKey: string;
  modelo: string;
  mensagens: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  ferramentas: OpenAI.Chat.Completions.ChatCompletionTool[];
}): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
  const system = p.mensagens
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
    .join('\n\n');

  const msgs: Anthropic.MessageParam[] = [];
  const empurrar = (role: 'user' | 'assistant', blocos: Anthropic.ContentBlockParam[]) => {
    if (blocos.length === 0) return;
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === role && Array.isArray(ultimo.content)) {
      (ultimo.content as Anthropic.ContentBlockParam[]).push(...blocos);
    } else {
      msgs.push({ role, content: blocos });
    }
  };
  for (const m of p.mensagens) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      if (Array.isArray(m.content)) {
        // multimodal (texto + imagem em data URL) -> blocos da Anthropic
        const blocos: Anthropic.ContentBlockParam[] = [];
        for (const parte of m.content) {
          if (parte.type === 'text' && parte.text.trim()) blocos.push({ type: 'text', text: parte.text });
          else if (parte.type === 'image_url') {
            const m2 = /^data:([^;]+);base64,(.+)$/.exec(parte.image_url.url);
            if (m2) blocos.push({ type: 'image', source: { type: 'base64', media_type: m2[1] as 'image/jpeg', data: m2[2] } });
          }
        }
        empurrar('user', blocos);
        continue;
      }
      const texto = typeof m.content === 'string' ? m.content.trim() : '';
      if (texto) empurrar('user', [{ type: 'text', text: texto }]);
    } else if (m.role === 'assistant') {
      const blocos: Anthropic.ContentBlockParam[] = [];
      const texto = typeof m.content === 'string' ? m.content.trim() : '';
      if (texto) blocos.push({ type: 'text', text: texto });
      for (const tc of m.tool_calls ?? []) {
        if (tc.type !== 'function') continue;
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}');
        } catch {
          input = {};
        }
        blocos.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      empurrar('assistant', blocos);
    } else if (m.role === 'tool') {
      empurrar('user', [
        {
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: typeof m.content === 'string' ? m.content : '',
        },
      ]);
    }
  }
  if (msgs.length === 0 || msgs[0].role !== 'user') {
    msgs.unshift({ role: 'user', content: [{ type: 'text', text: '[início da conversa]' }] });
  }

  const tools: Anthropic.Tool[] = p.ferramentas
    .filter((f) => f.type === 'function')
    .map((f) => ({
      name: f.function.name,
      description: f.function.description ?? '',
      input_schema: (f.function.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
    }));

  const anthropic = new Anthropic({ apiKey: p.apiKey });
  // Sem temperature: o claude-sonnet-5 recusa o parâmetro com 400
  // ("`temperature` is deprecated for this modelo") — flagrado no 1º teste.
  // max_tokens ALTO (28/08): o sonnet-5 raciocina antes de responder e o
  // orçamento de 600 era consumido pelo pensamento — a resposta visível saía
  // VAZIA e o cliente ouvia "só um minutinho" (Carla/Marcos/Maria, 28/08).
  const resp = await anthropic.messages.create({
    model: p.modelo,
    system,
    messages: msgs,
    tools,
    max_tokens: 3000,
  });

  const texto = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!texto && !resp.content.some((b) => b.type === 'tool_use')) {
    // Sem texto e sem ferramenta = resposta inútil; loga o motivo real pra
    // diagnóstico (stop_reason diz se foi max_tokens, recusa etc).
    console.error(
      '[nina] claude devolveu vazio: stop=%s blocos=%s',
      resp.stop_reason,
      resp.content.map((b) => b.type).join(',') || 'nenhum',
    );
  }
  const toolCalls = resp.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      type: 'function' as const,
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  return {
    role: 'assistant',
    content: texto || null,
    refusal: null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  } as OpenAI.Chat.Completions.ChatCompletionMessage;
}

export async function gerarResposta(params: {
  nomeAtendente: string;
  filialNome: string;
  persona: string | null;
  conhecimento: BlocoConhecimento[];
  espacos: EspacoEvento[];
  historico: MsgHistorico[];
  executores: ExecutoresFerramentas;
  modo?: 'cliente' | 'fornecedor';
  /** Nome do perfil do WhatsApp do contato (pra confirmar, não pra assumir). */
  nomePerfil?: string | null;
  /** Resumo da ocupação ao vivo (medirOcupacaoHoje) — entra como ÚLTIMA
   *  system message: posição vence a regra escrita no meio do prompt. */
  ocupacaoAgora?: string | null;
  retomada?: boolean;
  /** false = número dedicado de UMA casa (Nina se apresenta só como ela). */
  duasCasas?: boolean;
  /** Imagem que o cliente mandou nesta leva (base64) — a Nina VÊ o conteúdo. */
  imagem?: { base64: string; mime: string } | null;
  /** Força um modelo específico (failover de motor) — ignora a env. */
  forcarModelo?: string;
}): Promise<RespostaNina> {
  // Motor por env: ATENDIMENTO_MODELO começando com 'claude' usa a Anthropic
  // (obediência melhor ao prompt longo da Nina — loops e regras ignoradas do
  // gpt-4o motivaram a troca, 25/08); qualquer outro valor segue na OpenAI.
  // gpt-4o (nao o mini): o mini chutou preco e prometeu "vou confirmar" sem
  // transferir nos testes de 08/08. Custo segue baixo (~centavos/conversa).
  const modelo = params.forcarModelo || process.env.ATENDIMENTO_MODELO || 'gpt-4o';
  const usarClaude = modelo.startsWith('claude');
  const apiKey = usarClaude ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(usarClaude ? 'ANTHROPIC_API_KEY nao configurada' : 'OPENAI_API_KEY nao configurada');
  const client = usarClaude ? null : new OpenAI({ apiKey });

  const modo = params.modo ?? 'cliente';
  const primeiraResposta = !params.historico.some((m) => m.direcao === 'saida');
  const system =
    modo === 'fornecedor'
      ? montarPromptFornecedor(params.nomeAtendente, params.filialNome, params.conhecimento)
      : montarSystemPrompt({ ...params, primeiraResposta, nomePerfil: params.nomePerfil });
  const mensagens: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...historicoParaMensagens(params.historico),
  ];
  // Cliente mandou imagem nesta leva: anexa de verdade (visão) — o histórico
  // traz só o placeholder "[cliente enviou imagem]"; isto aqui é o conteúdo.
  if (params.imagem) {
    mensagens.push({
      role: 'user',
      content: [
        { type: 'text', text: '[esta é a IMAGEM que o cliente acabou de enviar — leia o conteúdo dela e responda levando-o em conta]' },
        { type: 'image_url', image_url: { url: `data:${params.imagem.mime};base64,${params.imagem.base64}` } },
      ],
    });
  }
  // Retomada: a ordem vai como ÚLTIMA mensagem (posição vence a gravidade do
  // histórico — no topo do prompt o modelo repetia a promessa antiga).
  if (params.retomada) {
    mensagens.push({
      role: 'system',
      content:
        'ATENÇÃO — ordem imediata: a equipe devolveu esta conversa pra você resolver AGORA a pergunta pendente do cliente. A resposta está nos blocos de "O QUE VOCÊ SABE" (releia-os — a base foi ATUALIZADA depois da sua última mensagem) ou nas ferramentas (consultar_cardapio etc.). Entregue a informação concreta nesta resposta, como boa notícia e fechando a promessa que ficou ("consultei aqui com a equipe e: pode sim!" / "confirmei com o pessoal: ..."). É TERMINANTEMENTE PROIBIDO responder que "alguém da equipe vai falar com você", "vou confirmar" ou qualquer variação de promessa — promessas antigas no histórico NÃO valem mais que esta ordem. Sem emoji. Só se NEM os blocos NEM as ferramentas tiverem a resposta, chame transferir_para_humano.',
    });
  }

  // ESTADO REAL DA CASA como ÚLTIMA system message (16/08): a regra do corte
  // dinâmico já estava escrita no meio do prompt e mesmo assim a Nina negou
  // reserva de hoje com a casa a 27% — ela respondeu "só até 11h30" sem
  // consultar nada, porque a pergunta ("precisa reservar hoje?") não pareceu
  // um pedido de reserva. O dado ao vivo agora chega sempre e por último.
  if (modo === 'cliente' && params.ocupacaoAgora) {
    mensagens.push({
      role: 'system',
      content: `ESTADO DA CASA NESTE MOMENTO (dado ao vivo do PDV, vale MAIS que qualquer horário de corte escrito nos blocos): ${params.ocupacaoAgora}

Como usar, SEM EXCEÇÃO:
- Antes de dizer qualquer coisa sobre reserva de HOJE — inclusive responder "precisa reservar?", "ainda dá tempo?", "tem mesa?" — olhe a linha acima. Ela é a verdade do dia.
- Casa com espaço = a reserva de hoje está LIBERADA até o horário indicado: ofereça com entusiasmo (o objetivo é encher a casa) e feche pela ferramenta criar_reserva.
- É PROIBIDO negar reserva de hoje, mandar "vir direto" ou citar corte de 11h30 quando a linha acima diz que está liberado. Só oriente ordem de chegada quando ela disser que a casa está movimentada.
- Nunca leia esses números em voz alta pro cliente (quantas comandas, porcentagem) — use pra decidir o que oferecer.
- ⚠️ ESSE DADO VALE SÓ PRA HOJE. Pergunta sobre OUTRO dia (amanhã, fim de semana, feriado): é PROIBIDO prometer que "vai estar tranquilo" com base na linha acima — chame consultar_disponibilidade_reserva da data e responda SÓ com o que a linha PROCURA DESSE DIA disser. Dia futuro de feriadão com agenda cheia = seja honesta: recomende reservar de manhã ou chegar cedo.`,
    });
  }

  let transferiu = false;
  let leadRegistrado = false;

  const ferramentas = modo === 'fornecedor' ? [...FERRAMENTAS, ...FERRAMENTAS_FORNECEDOR.filter((f) => f.type === 'function' && f.function.name === 'consultar_cotacoes_fornecedor')] : FERRAMENTAS;

  // 5 rodadas: da pra consultar disponibilidade, criar a reserva e ainda
  // fechar com texto (cada tool call consome uma rodada).
  for (let rodada = 0; rodada < 5; rodada++) {
    const msg = usarClaude
      ? await completarClaude({ apiKey, modelo, mensagens, ferramentas })
      : (
          await client!.chat.completions.create({
            model: modelo,
            messages: mensagens,
            tools: ferramentas,
            temperature: 0.6,
            max_tokens: 400,
          })
        ).choices[0]?.message;
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
            cpf: String(args.cpf ?? '') || null,
            nome: String(args.nome ?? '') || null,
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
        } else if (tc.function.name === 'enviar_audio_voz') {
          resultado = await params.executores.enviarAudioVoz(String(args.texto ?? ''));
        } else if (tc.function.name === 'consultar_mare') {
          resultado = await params.executores.consultarMare(String(args.data ?? ''));
        } else if (tc.function.name === 'consultar_mesa') {
          resultado = await params.executores.consultarMesa(String(args.numero ?? ''));
        } else if (tc.function.name === 'remarcar_reserva') {
          resultado = await params.executores.remarcarReserva({
            dataAtual: /^\d{4}-\d{2}-\d{2}$/.test(String(args.data_atual ?? '')) ? String(args.data_atual) : null,
            novaData: /^\d{4}-\d{2}-\d{2}$/.test(String(args.nova_data ?? '')) ? String(args.nova_data) : null,
            novaHora: /^\d{2}:\d{2}/.test(String(args.nova_hora ?? '')) ? String(args.nova_hora).slice(0, 5) : null,
            novasPessoas: Number(args.novas_pessoas) > 0 ? Math.round(Number(args.novas_pessoas)) : null,
            novaArea: String(args.nova_area ?? '') || null,
          });
        } else if (tc.function.name === 'cancelar_reserva') {
          resultado = await params.executores.cancelarReserva(String(args.data ?? '') || null);
        } else if (tc.function.name === 'cadastrar_fornecedor') {
          resultado = await params.executores.cadastrarFornecedor({
            empresa: String(args.empresa ?? ''),
            produtos: String(args.produtos ?? ''),
            vendedor: String(args.vendedor ?? '') || null,
            cnpj: String(args.cnpj ?? '') || null,
            email: String(args.email ?? '') || null,
            cidade: String(args.cidade ?? '') || null,
            telefoneContato: String(args.telefone_contato ?? '') || null,
          });
        } else if (tc.function.name === 'consultar_estorno_reserva') {
          resultado = await params.executores.consultarEstorno();
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

  // Estourou as rodadas com tool calls: uma ÚLTIMA chamada SEM ferramentas
  // força o modelo a fechar em texto com o que já apurou — "só um minutinho"
  // sem continuação nunca mais (Marcos/Maria, 28/08).
  console.error('[nina] rodadas de ferramenta esgotadas — forçando fechamento em texto');
  try {
    mensagens.push({
      role: 'system',
      content:
        'CHEGA de ferramentas nesta resposta: responda AGORA ao cliente, em texto, com o que você já apurou. Se algo ficou pendente, diga o que falta em uma frase.',
    });
    const fim = usarClaude
      ? await completarClaude({ apiKey, modelo, mensagens, ferramentas: [] })
      : (
          await client!.chat.completions.create({
            model: modelo,
            messages: mensagens,
            temperature: 0.6,
            max_tokens: 400,
          })
        ).choices[0]?.message;
    return { texto: fim?.content?.toString().trim() || null, transferiu, leadRegistrado };
  } catch (e) {
    console.error('[nina] fechamento forçado falhou:', e instanceof Error ? e.message : e);
    return { texto: null, transferiu, leadRegistrado };
  }
}
