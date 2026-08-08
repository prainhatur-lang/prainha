// Orquestracao do atendimento da Nina.
//
// Divisao com o webhook:
//  - registrarEntrada() roda ANTES do 200 (rapido, ~2 queries): guard de
//    fornecedor, upsert da conversa, insert da mensagem com dedupe. Garante
//    que nada se perde mesmo se o resto falhar.
//  - processarEntrada() roda DEPOIS do 200 (via after()): transcricao de
//    audio, debounce de mensagens picadas, IA, ferramentas, envio.

import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { gerarResposta, type MsgHistorico } from './ia';
import { enviarTexto, marcarLidaComDigitando, baixarMidia } from './zap';
import { transcreverAudio } from './transcrever';
import { avisarEquipe } from './avisos';

const DEBOUNCE_MS = 6_000;
const HISTORICO_MAX = 30;

export interface EntradaWebhook {
  phoneNumberId: string;
  filialId: string;
  telefone: string; // digitos com DDI (value.messages[].from)
  nomeCliente: string | null;
  waMessageId: string;
  tipo: string; // texto | audio | imagem | video | documento | outro
  corpo: string | null; // texto da mensagem (null p/ midia)
  mediaId: string | null;
}

export interface EntradaRegistrada {
  conversaId: string;
  mensagemId: string;
  deveResponder: boolean;
}

/** True se o telefone bate com algum fornecedor cadastrado (sufixo de 8
 *  digitos em fone principal/secundario, qualquer filial). */
async function ehFornecedor(telefone: string): Promise<boolean> {
  const suf = telefone.replace(/\D/g, '').slice(-8);
  if (suf.length < 8) return false;
  const rows = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(
      sql`right(regexp_replace(coalesce(${schema.fornecedor.fonePrincipal}, ''), '\\D', '', 'g'), 8) = ${suf}
          OR right(regexp_replace(coalesce(${schema.fornecedor.foneSecundario}, ''), '\\D', '', 'g'), 8) = ${suf}`,
    )
    .limit(1);
  return rows.length > 0;
}

/** Persiste a mensagem recebida. Retorna null se for reentrega (dedupe). */
export async function registrarEntrada(e: EntradaWebhook): Promise<EntradaRegistrada | null> {
  const fornecedor = await ehFornecedor(e.telefone);

  const [conversa] = await db
    .insert(schema.atendimentoConversa)
    .values({
      filialId: e.filialId,
      telefone: e.telefone,
      nomeCliente: e.nomeCliente,
      status: fornecedor ? 'fornecedor' : 'bot',
      ultimaMsgClienteEm: sql`now()`,
      ultimaMsgEm: sql`now()`,
      naoLidas: 1,
    })
    .onConflictDoUpdate({
      target: [schema.atendimentoConversa.filialId, schema.atendimentoConversa.telefone],
      set: {
        nomeCliente: sql`COALESCE(NULLIF(excluded.nome_cliente, ''), ${schema.atendimentoConversa.nomeCliente})`,
        // encerrada reabre pro bot; humano/fornecedor ficam como estao
        status: sql`CASE WHEN ${schema.atendimentoConversa.status} = 'encerrada' THEN 'bot' ELSE ${schema.atendimentoConversa.status} END`,
        ultimaMsgClienteEm: sql`now()`,
        ultimaMsgEm: sql`now()`,
        naoLidas: sql`${schema.atendimentoConversa.naoLidas} + 1`,
        atualizadoEm: sql`now()`,
      },
    })
    .returning({ id: schema.atendimentoConversa.id, status: schema.atendimentoConversa.status });

  const inserted = await db
    .insert(schema.atendimentoMensagem)
    .values({
      conversaId: conversa.id,
      waMessageId: e.waMessageId,
      direcao: 'entrada',
      autor: 'cliente',
      tipo: e.tipo,
      corpo: e.corpo,
      mediaId: e.mediaId,
    })
    .onConflictDoNothing({ target: schema.atendimentoMensagem.waMessageId })
    .returning({ id: schema.atendimentoMensagem.id });

  if (inserted.length === 0) return null; // reentrega da Meta

  return {
    conversaId: conversa.id,
    mensagemId: inserted[0].id,
    deveResponder: conversa.status === 'bot',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Roda depois do 200: transcricao, debounce, IA, envio. Nunca lanca. */
export async function processarEntrada(params: {
  registro: EntradaRegistrada;
  entrada: EntradaWebhook;
}): Promise<void> {
  const { registro, entrada } = params;
  try {
    // "lida" + digitando enquanto pensa (cosmetico, best-effort)
    void marcarLidaComDigitando(entrada.phoneNumberId, entrada.waMessageId);

    // Transcricao de audio em paralelo com o debounce
    const tarefas: Promise<unknown>[] = [sleep(DEBOUNCE_MS)];
    if (entrada.tipo === 'audio' && entrada.mediaId) {
      tarefas.push(
        (async () => {
          const midia = await baixarMidia(entrada.mediaId!);
          const texto = midia ? await transcreverAudio(midia.buffer, midia.mime) : null;
          if (texto) {
            await db
              .update(schema.atendimentoMensagem)
              .set({ corpo: texto })
              .where(eq(schema.atendimentoMensagem.id, registro.mensagemId));
          }
        })(),
      );
    }
    await Promise.all(tarefas);

    // Debounce: se chegou mensagem mais nova nessa conversa, quem responde e ela
    const [ultima] = await db
      .select({ id: schema.atendimentoMensagem.id })
      .from(schema.atendimentoMensagem)
      .where(
        and(
          eq(schema.atendimentoMensagem.conversaId, registro.conversaId),
          eq(schema.atendimentoMensagem.direcao, 'entrada'),
        ),
      )
      .orderBy(desc(schema.atendimentoMensagem.criadoEm))
      .limit(1);
    if (!ultima || ultima.id !== registro.mensagemId) return;

    // Estado atual (pode ter mudado durante o debounce — equipe assumiu etc.)
    const [conversa] = await db
      .select()
      .from(schema.atendimentoConversa)
      .where(eq(schema.atendimentoConversa.id, registro.conversaId))
      .limit(1);
    if (!conversa || conversa.status !== 'bot') return;

    const [config] = await db
      .select()
      .from(schema.atendimentoConfig)
      .where(eq(schema.atendimentoConfig.filialId, entrada.filialId))
      .limit(1);
    if (!config?.ativo) return;

    const [fil] = await db
      .select({ nome: schema.filial.nome })
      .from(schema.filial)
      .where(eq(schema.filial.id, entrada.filialId))
      .limit(1);
    const filialNome = fil?.nome ?? 'Prainha Bar';

    const historicoRows = await db
      .select({
        direcao: schema.atendimentoMensagem.direcao,
        autor: schema.atendimentoMensagem.autor,
        tipo: schema.atendimentoMensagem.tipo,
        corpo: schema.atendimentoMensagem.corpo,
      })
      .from(schema.atendimentoMensagem)
      .where(eq(schema.atendimentoMensagem.conversaId, registro.conversaId))
      .orderBy(desc(schema.atendimentoMensagem.criadoEm))
      .limit(HISTORICO_MAX);
    const historico: MsgHistorico[] = historicoRows.reverse();

    const numerosEquipe = config.numerosEquipe ?? [];

    const executores = {
      registrarLead: async (dados: import('./ia').DadosLeadEvento) => {
        await db.insert(schema.eventoLead).values({
          filialId: entrada.filialId,
          conversaId: registro.conversaId,
          nome: dados.nome ?? conversa.nomeCliente,
          telefone: entrada.telefone,
          tipoEvento: dados.tipoEvento || null,
          dataEvento: dados.dataEvento,
          hora: dados.hora,
          pessoas: dados.pessoas,
          espaco: dados.espaco,
          observacoes: dados.observacoes,
        });
        void avisarEquipe(numerosEquipe, {
          motivo: `Novo lead de evento: ${dados.tipoEvento || 'evento'}`,
          nomeCliente: dados.nome ?? conversa.nomeCliente ?? 'sem nome',
          telefone: entrada.telefone,
          filial: filialNome,
        });
        return 'Lead registrado. Confirme ao cliente que a equipe vai entrar em contato pra fechar os detalhes.';
      },
      transferir: async (motivo: string, resumo: string) => {
        await db
          .update(schema.atendimentoConversa)
          .set({
            status: 'humano',
            motivoTransferencia: `${motivo}${resumo ? ` — ${resumo}` : ''}`.slice(0, 500),
            atualizadoEm: sql`now()`,
          })
          .where(eq(schema.atendimentoConversa.id, registro.conversaId));
        void avisarEquipe(numerosEquipe, {
          motivo: `Transferência: ${motivo}`,
          nomeCliente: conversa.nomeCliente ?? 'sem nome',
          telefone: entrada.telefone,
          filial: filialNome,
        });
        return 'Transferido. Avise o cliente, em uma frase gentil, que alguém da equipe já vai falar com ele por aqui mesmo.';
      },
    };

    let texto: string | null = null;
    let transferiu = false;
    try {
      let resposta;
      try {
        resposta = await gerarResposta({
          nomeAtendente: config.nomeAtendente,
          filialNome,
          persona: config.persona,
          conhecimento: config.conhecimento ?? [],
          espacos: config.espacosEvento ?? [],
          historico,
          executores,
        });
      } catch {
        resposta = await gerarResposta({
          nomeAtendente: config.nomeAtendente,
          filialNome,
          persona: config.persona,
          conhecimento: config.conhecimento ?? [],
          espacos: config.espacosEvento ?? [],
          historico,
          executores,
        });
      }
      texto = resposta.texto;
      transferiu = resposta.transferiu;
      if (!texto) {
        texto = transferiu
          ? 'Prontinho! Já chamei alguém da equipe pra falar contigo por aqui mesmo, tá? 😊'
          : 'Oi! Só um minutinho que já te respondo 😊';
      }
    } catch (e) {
      // IA fora do ar (2 tentativas): transfere pra equipe e avisa o cliente
      await executores.transferir('Falha técnica da Nina', 'A IA não conseguiu responder — assumir manualmente.');
      texto = 'Oi! Vou pedir pra alguém da equipe te responder já já, tá bom? 😊';
      transferiu = true;
      console.error('nina: falha ao gerar resposta', e);
    }

    const envio = await enviarTexto(entrada.phoneNumberId, entrada.telefone, texto);
    await db.insert(schema.atendimentoMensagem).values({
      conversaId: registro.conversaId,
      waMessageId: envio.waMessageId,
      direcao: 'saida',
      autor: 'bot',
      tipo: 'texto',
      corpo: texto,
      statusEnvio: envio.erro ? 'erro' : 'enviada',
      erro: envio.erro ?? null,
    });
    await db
      .update(schema.atendimentoConversa)
      .set({ ultimaMsgEm: sql`now()`, atualizadoEm: sql`now()` })
      .where(eq(schema.atendimentoConversa.id, registro.conversaId));
  } catch (e) {
    console.error('nina: processarEntrada falhou', e);
  }
}

/** Atualiza status de entrega (value.statuses do webhook). */
export async function registrarStatusEnvio(
  waMessageId: string,
  status: string,
  erro: string | null,
): Promise<void> {
  const mapa: Record<string, string> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'erro' };
  const statusEnvio = mapa[status];
  if (!statusEnvio) return;
  await db
    .update(schema.atendimentoMensagem)
    .set({ statusEnvio, ...(erro ? { erro } : {}) })
    .where(eq(schema.atendimentoMensagem.waMessageId, waMessageId));
}
