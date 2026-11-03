// Supervisor da Nina (dono 03/11/2026): "quando a Nina tivesse alguma dúvida,
// ela perguntasse a você diretamente, você lia o processo e dava a resposta.
// No caso de você não conseguir responder, aí ela me procurava."
//
// Antes de transferir pra equipe, a Nina manda a dúvida pra um modelo mais
// forte (Claude Opus), que lê a MESMA base de conhecimento dela, a conversa
// inteira e a ficha do cliente no sistema (reservas, orçamentos de evento,
// pedidos de evento). Se a resposta está ali, volta pra Nina responder; se
// precisa de gente (estorno, desconto, exceção, pedido de atendente), a
// transferência segue como sempre, com o parecer junto no resumo.
// Qualquer erro ou demora = transfere como antes.

import Anthropic from '@anthropic-ai/sdk';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import type { MsgHistorico } from './ia';

export interface ParecerSupervisor {
  decisao: 'responder' | 'precisa_humano';
  /** O que a Nina deve dizer ao cliente (só quando decisao = responder). */
  resposta: string;
  /** Por que precisa de gente, ou de onde veio a resposta. */
  motivo: string;
}

const MODELO_PADRAO = 'claude-opus-5-5';

/** Reservas, orçamentos e pedidos de evento deste telefone na casa. */
async function fichaDoCliente(filialId: string, telefone: string): Promise<string> {
  const fim8 = telefone.replace(/\D/g, '').slice(-8);
  if (fim8.length < 8) return 'Telefone curto demais pra buscar a ficha.';
  const desde = diasAtrasBr(60);
  const like = `%${fim8}`;

  const reservas = (await db.execute(sql`
    SELECT data::text AS data, hora, pessoas, area, mesa, status, cliente_nome, pagamento_status, pagamento_valor
      FROM reserva
     WHERE filial_id = ${filialId}::uuid
       AND regexp_replace(coalesce(cliente_telefone, ''), '\\D', '', 'g') LIKE ${like}
       AND data >= ${desde}::date
     ORDER BY data DESC
     LIMIT 8
  `)) as unknown as Array<Record<string, unknown>>;

  const orcs = (await db.execute(sql`
    SELECT numero, cliente_nome, data_evento::text AS data, hora, pessoas, local, status, pagamento_status,
           entrada_valor, pago_em::text AS pago_em, valido_ate::text AS valido_ate, condicoes
      FROM orcamento_evento
     WHERE filial_id = ${filialId}::uuid
       AND regexp_replace(coalesce(cliente_telefone, ''), '\\D', '', 'g') LIKE ${like}
     ORDER BY criado_em DESC
     LIMIT 6
  `)) as unknown as Array<Record<string, unknown>>;

  const leads = (await db.execute(sql`
    SELECT nome, tipo_evento, data_evento::text AS data, hora, pessoas, espaco, status, observacoes
      FROM evento_lead
     WHERE filial_id = ${filialId}::uuid
       AND regexp_replace(coalesce(telefone, ''), '\\D', '', 'g') LIKE ${like}
     ORDER BY criado_em DESC
     LIMIT 5
  `)) as unknown as Array<Record<string, unknown>>;

  const linha = (o: Record<string, unknown>) =>
    Object.entries(o)
      .filter(([, v]) => v !== null && v !== '' && v !== undefined)
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, ' ').slice(0, 300)}`)
      .join(' · ');

  const partes: string[] = [];
  partes.push(reservas.length ? `RESERVAS (últimos 60 dias e futuras):\n${reservas.map((r) => `- ${linha(r)}`).join('\n')}` : 'RESERVAS: nenhuma neste telefone.');
  partes.push(orcs.length ? `ORÇAMENTOS DE EVENTO:\n${orcs.map((r) => `- ${linha(r)}`).join('\n')}` : 'ORÇAMENTOS DE EVENTO: nenhum neste telefone.');
  partes.push(leads.length ? `PEDIDOS DE EVENTO ANOTADOS:\n${leads.map((r) => `- ${linha(r)}`).join('\n')}` : 'PEDIDOS DE EVENTO ANOTADOS: nenhum.');
  return partes.join('\n\n');
}

function transcrever(historico: MsgHistorico[]): string {
  return historico
    .slice(-30)
    .filter((m) => (m.corpo ?? '').trim())
    .map((m) => {
      const quem = m.direcao === 'entrada' ? 'CLIENTE' : m.autor === 'equipe' ? 'EQUIPE (humano)' : m.autor === 'sistema' ? 'SISTEMA' : 'NINA';
      return `${quem}: ${(m.corpo ?? '').trim().slice(0, 1200)}`;
    })
    .join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    decisao: { type: 'string', enum: ['responder', 'precisa_humano'] },
    resposta: { type: 'string' },
    motivo: { type: 'string' },
  },
  required: ['decisao', 'resposta', 'motivo'],
  additionalProperties: false,
} as const;

/** Pergunta ao supervisor. null = não deu (sem chave, erro, demora): transfere como antes. */
export async function consultarSupervisor(p: {
  filialId: string;
  filialNome: string;
  telefone: string;
  nomeAtendente: string;
  /** O prompt inteiro da Nina (base de conhecimento + regras). */
  systemNina: string;
  historico: MsgHistorico[];
  motivo: string;
  resumo: string;
}): Promise<ParecerSupervisor | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const modelo = process.env.ATENDIMENTO_SUPERVISOR_MODELO || MODELO_PADRAO;

  let ficha = '';
  try {
    ficha = await fichaDoCliente(p.filialId, p.telefone);
  } catch (e) {
    ficha = 'Ficha do cliente indisponível agora.';
    console.error('[nina] supervisor: ficha falhou:', e instanceof Error ? e.message : e);
  }

  const system = `Você é o SUPERVISOR da ${p.nomeAtendente}, a atendente virtual de WhatsApp do ${p.filialNome} (Aracaju-SE). Hoje é ${hojeBr()}.
Ela travou numa dúvida e ia passar a conversa pra equipe humana. Antes disso, ela pergunta a você. Seu trabalho: ler o processo (as regras e a base de conhecimento dela, a conversa e a ficha do cliente no sistema) e decidir.

decisao = "responder" quando a resposta para o cliente está CLARAMENTE nas regras/base dela ou na ficha do cliente. Em "resposta", escreva a informação concreta que a ${p.nomeAtendente} deve passar ao cliente (curta, no tom de WhatsApp dela, em português; sem prometer nada que não esteja escrito).

decisao = "precisa_humano" quando:
- o cliente pediu para falar com uma pessoa/atendente/gerente/dono;
- precisa de autoridade da equipe: cancelar evento ou reserva PAGA, estorno ou devolução de dinheiro, desconto, exceção à regra, negociação de preço/condição, reclamação séria, pagamento antecipado de agência ou empresa, assunto comercial de agência, parceria, contato indicado pro dono;
- as regras dela mandam transferir naquele caso;
- a informação NÃO está nem na base nem na ficha (item [PENDENTE] conta como não está).
Em "motivo", diga em uma frase o porquê (vai pra equipe ler). Em "resposta", deixe vazio.

Nunca invente preço, horário, regra, disponibilidade ou exceção. Na dúvida entre responder e chamar gente, chame gente.

===== REGRAS E BASE DE CONHECIMENTO DA ${p.nomeAtendente.toUpperCase()} =====
${p.systemNina}
===== FIM DAS REGRAS =====`;

  const usuario = `FICHA DO CLIENTE NO SISTEMA (telefone desta conversa):
${ficha}

CONVERSA (mais recente por último):
${transcrever(p.historico)}

DÚVIDA DA ${p.nomeAtendente.toUpperCase()} (por que ela ia transferir):
Motivo: ${p.motivo}
Resumo: ${p.resumo}`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create(
      {
        model: modelo,
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: usuario }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      },
      { timeout: 20_000, maxRetries: 0 },
    );
    if (resp.stop_reason === 'refusal') return null;
    const texto = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)) as Partial<ParecerSupervisor>;
    const decisao = json.decisao === 'responder' && (json.resposta ?? '').trim() ? 'responder' : 'precisa_humano';
    return { decisao, resposta: String(json.resposta ?? '').trim(), motivo: String(json.motivo ?? '').trim() };
  } catch (e) {
    console.error('[nina] supervisor falhou:', e instanceof Error ? e.message : e);
    return null;
  }
}
