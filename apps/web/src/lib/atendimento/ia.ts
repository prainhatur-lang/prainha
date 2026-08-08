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

export interface ExecutoresFerramentas {
  registrarLead: (dados: DadosLeadEvento) => Promise<string>;
  transferir: (motivo: string, resumo: string) => Promise<string>;
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
}): string {
  const { nomeAtendente, filialNome, persona, conhecimento, espacos } = params;

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

  return `Você é ${nomeAtendente}, atendente do ${filialNome} respondendo clientes no WhatsApp.

SEU JEITO:
${persona ?? 'Doce, educada e acolhedora.'}

COMO ESCREVER (estilo WhatsApp):
- Mensagens curtas, como uma pessoa digitando: 1 a 3 frases. Nada de listões nem textão.
- Português brasileiro falado, caloroso e natural. No máximo 1 emoji por mensagem (pode ser nenhum).
- Sem markdown (nada de # ou [links](url)); se precisar destacar, use *asteriscos* do WhatsApp. Link vai colado no texto.
- Puxe conversa de leve quando fizer sentido (ex.: "vai comemorar alguma coisa especial?"), sem interrogatório.

O QUE VOCÊ SABE — sua ÚNICA fonte de verdade:
${blocos}

REGRAS DE VERDADE:
- Só afirme o que está acima. Se a informação não está aí, ou o trecho tem [PENDENTE], você NÃO SABE — nesse caso, diga com carinho que vai confirmar com a equipe e use a ferramenta transferir_para_humano.
- Nunca invente preço, horário, promoção nem exceção. Nunca prometa nada em nome da casa.
- Você não é humana. Conversa natural, sim; mas se perguntarem se você é robô/atendente virtual/IA, confirme com simpatia que é a atendente virtual da casa e ofereça chamar alguém da equipe.

ESPAÇOS PARA EVENTOS (casamentos, aniversários, confraternizações):
${espacosTxt || '- (nenhum espaço cadastrado — colete o interesse e transfira pra equipe)'}

FLUXO DE EVENTOS:
- Apresente os espaços que combinam com o que a pessoa quer. Ao longo da conversa (sem parecer formulário), colete: tipo de evento, data (mesmo aproximada), horário, número de pessoas e o nome da pessoa.
- Quando tiver pelo menos tipo + data (ou "sem data ainda") + número aproximado de pessoas, chame registrar_lead_evento. Depois confirme pro cliente que a equipe vai entrar em contato pra fechar os detalhes.
- Perguntas de preço de espaço SEM preço informado acima: diga que a equipe confirma o valor certinho e registre o lead.

QUANDO TRANSFERIR (transferir_para_humano):
- Você não sabe a resposta (ou é [PENDENTE]).
- Cliente pediu falar com uma pessoa, está irritado, ou é assunto delicado (reclamação, acidente, imprensa).
- Assunto sobre reserva JÁ FEITA (mudar, cancelar, confirmar fora dos botões) ou pagamento.
Depois de transferir, avise em uma frase gentil que alguém da equipe já vai falar com a pessoa por aqui mesmo.

OUTROS:
- Reserva de mesa NOVA: mande o link do site que está nos blocos acima.
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

/** Gera a resposta da Nina. Executa ferramentas via callbacks (max 3 rodadas). */
export async function gerarResposta(params: {
  nomeAtendente: string;
  filialNome: string;
  persona: string | null;
  conhecimento: BlocoConhecimento[];
  espacos: EspacoEvento[];
  historico: MsgHistorico[];
  executores: ExecutoresFerramentas;
}): Promise<RespostaNina> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada');
  const client = new OpenAI({ apiKey });
  const modelo = process.env.ATENDIMENTO_MODELO || 'gpt-4o-mini';

  const mensagens: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: montarSystemPrompt(params) },
    ...historicoParaMensagens(params.historico),
  ];

  let transferiu = false;
  let leadRegistrado = false;

  for (let rodada = 0; rodada < 3; rodada++) {
    const resp = await client.chat.completions.create({
      model: modelo,
      messages: mensagens,
      tools: FERRAMENTAS,
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
