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
import { enviarTexto, enviarAudio, marcarLidaComDigitando, baixarMidia } from './zap';
import { gerarAudioNina } from './voz';
import { transcreverAudio } from './transcrever';
import { avisarEquipe } from './avisos';
import {
  consultarDisponibilidade,
  criarReservaWhatsApp,
  remarcarReservaWhatsApp,
  cancelarReservaWhatsApp,
  consultarMesa,
} from './reservar';
import { consultarCardapio } from './cardapio';
import { consultarMareTexto } from './mare';
import { consultarCotacoesFornecedor } from './fornecedor';
import { listarOpcoesOrcamento, gerarOrcamentoEvento } from './orcamento';

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
    // Fornecedor tambem recebe resposta (modo proprio: explica cotacao/pedido)
    deveResponder: conversa.status === 'bot' || conversa.status === 'fornecedor',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Fechos-muleta que o modelo insiste em colar no fim ("se precisar estou
// aqui!") — a regra do prompt segura ~80%; a tesoura garante os 100%.
// A pergunta legítima de conclusão ("posso ajudar em mais algo?") passa.
const FECHOS_REPETITIVOS = [
  /\s*\b(se (você )?(precisar|quiser)|qualquer (coisa|dúvida)|caso (precise|queira))[^.!?\n]*[.!?…]*\s*$/i,
  /\s*\b(estou|estarei|fico) (aqui|à disposição|por aqui|a postos|sempre por aqui)[^.!?\n]*[.!?…]*\s*$/i,
  /\s*\bé só (chamar|avisar|me chamar|falar|mandar mensagem)[^.!?\n]*[.!?…]*\s*$/i,
  /\s*\bconte comigo[^.!?\n]*[.!?…]*\s*$/i,
];

function limparFechoRepetitivo(texto: string): string {
  let out = texto.trim();
  for (let i = 0; i < 3; i++) {
    const antes = out;
    for (const p of FECHOS_REPETITIVOS) out = out.replace(p, '').trim();
    if (out === antes) break;
  }
  // Mensagem que É só o fecho: melhor mandar como veio do que mandar nada.
  return out.length >= 10 ? out : texto.trim();
}

/** Ao DEVOLVER a conversa pra Nina com pergunta do cliente sem resposta
 *  (última mensagem é 'entrada'), ela responde o pendente na hora — sem
 *  esperar o cliente escrever de novo. Chamada pelo PATCH do painel. */
export async function responderPendenteAposDevolucao(conversaId: string): Promise<void> {
  console.log('[nina] retomada iniciada', conversaId);
  try {
    const [conversa] = await db
      .select()
      .from(schema.atendimentoConversa)
      .where(eq(schema.atendimentoConversa.id, conversaId))
      .limit(1);
    if (!conversa || conversa.status !== 'bot') return;

    const [ultima] = await db
      .select()
      .from(schema.atendimentoMensagem)
      .where(eq(schema.atendimentoMensagem.conversaId, conversaId))
      .orderBy(desc(schema.atendimentoMensagem.criadoEm))
      .limit(1);
    if (!ultima || ultima.direcao !== 'entrada') {
      console.log('[nina] retomada: nada pendente', conversaId);
      return;
    }

    const [numero] = await db
      .select()
      .from(schema.whatsappNumero)
      .where(
        and(
          eq(schema.whatsappNumero.filialId, conversa.filialId),
          eq(schema.whatsappNumero.atendenteAtivo, true),
        ),
      )
      .limit(1);
    if (!numero) return;

    console.log('[nina] retomada: processando', conversaId);
    await processarEntrada({
      retomada: true,
      registro: { conversaId, mensagemId: ultima.id, deveResponder: true },
      entrada: {
        phoneNumberId: numero.phoneNumberId,
        filialId: conversa.filialId,
        telefone: conversa.telefone,
        nomeCliente: conversa.nomeCliente,
        waMessageId: ultima.waMessageId ?? '',
        tipo: ultima.tipo,
        corpo: ultima.corpo,
        // corpo já traz a transcrição quando foi áudio — não re-baixa mídia
        mediaId: null,
      },
    });
  } catch (e) {
    // best-effort — devolver nunca pode falhar por causa disso
    console.error('[nina] retomada falhou:', e instanceof Error ? e.message : e);
  }
}

/** Roda depois do 200: transcricao, debounce, IA, envio. Nunca lanca. */
export async function processarEntrada(params: {
  registro: EntradaRegistrada;
  entrada: EntradaWebhook;
  /** true quando a equipe DEVOLVEU a conversa com pergunta pendente — a Nina
   *  precisa RESOLVER agora (ferramentas), proibida de re-prometer retorno. */
  retomada?: boolean;
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
    if (!conversa || (conversa.status !== 'bot' && conversa.status !== 'fornecedor')) return;
    const modo: 'cliente' | 'fornecedor' = conversa.status === 'fornecedor' ? 'fornecedor' : 'cliente';

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

    let audioEnviado = false;
    const executores = {
      enviarAudioVoz: async (textoFala: string) => {
        const fala = (textoFala ?? '').trim();
        if (!fala) return 'Texto vazio — não enviei áudio. Responda por texto.';
        const buf = await gerarAudioNina(fala);
        if (!buf) return 'Não consegui gerar o áudio agora — responda por texto normal.';
        const env = await enviarAudio(entrada.phoneNumberId, entrada.telefone, buf);
        await db.insert(schema.atendimentoMensagem).values({
          conversaId: registro.conversaId,
          waMessageId: env.waMessageId,
          direcao: 'saida',
          autor: 'bot',
          tipo: 'audio',
          corpo: fala,
          statusEnvio: env.erro ? 'erro' : 'enviada',
          erro: env.erro ?? null,
        });
        if (env.erro) return `Falha ao enviar o áudio (${env.erro}) — responda por texto normal.`;
        audioEnviado = true;
        return 'ÁUDIO ENVIADO com a sua voz. Pode encerrar sem texto, ou complementar com UMA frase curta se fizer falta.';
      },
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
      consultarDisponibilidade: (data: string) => consultarDisponibilidade(entrada.filialId, data),
      criarReserva: (dados: import('./ia').DadosReservaMesa) =>
        criarReservaWhatsApp({
          filialId: entrada.filialId,
          filialNome,
          telefone: entrada.telefone,
          data: dados.data,
          hora: dados.hora,
          pessoas: dados.pessoas,
          area: dados.area,
          cpf: dados.cpf,
          nome: dados.nome,
          nomePerfil: conversa.nomeCliente,
          observacao: dados.observacao,
        }),
      consultarCardapio: (termo: string) => consultarCardapio(entrada.filialId, termo),
      listarOpcoesOrcamento: () => listarOpcoesOrcamento(entrada.filialId),
      gerarOrcamento: (dados: import('./ia').DadosOrcamentoEvento) =>
        gerarOrcamentoEvento({
          filialId: entrada.filialId,
          filialNome,
          telefone: entrada.telefone,
          nomeCliente: dados.nomeCliente,
          espaco: dados.espaco,
          data: dados.data,
          hora: dados.hora,
          pessoas: dados.pessoas,
          entradas: dados.entradas,
          principais: dados.principais,
          massa: dados.massa,
          sobremesa: dados.sobremesa,
          bebidas: dados.bebidas,
          observacoes: dados.observacoes,
        }),
      consultarMesa: (numero: string) => consultarMesa(entrada.filialId, numero),
      consultarMare: async (data: string) => consultarMareTexto(data),
      consultarCotacoesFornecedor: () => consultarCotacoesFornecedor(entrada.telefone),
      remarcarReserva: (dados: import('./ia').DadosRemarcarReserva) =>
        remarcarReservaWhatsApp({
          filialId: entrada.filialId,
          filialNome,
          telefone: entrada.telefone,
          dataAtual: dados.dataAtual,
          novaData: dados.novaData,
          novaHora: dados.novaHora,
          novasPessoas: dados.novasPessoas,
          novaArea: dados.novaArea,
        }),
      cancelarReserva: (data: string | null) =>
        cancelarReservaWhatsApp({ filialId: entrada.filialId, telefone: entrada.telefone, data }),
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
    let leadRegistrado = false;
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
          modo,
          retomada: params.retomada === true,
        });
      } catch (e1) {
        console.error('[nina] geracao tentativa 1 falhou:', e1 instanceof Error ? e1.message : e1);
        resposta = await gerarResposta({
          nomeAtendente: config.nomeAtendente,
          filialNome,
          persona: config.persona,
          conhecimento: config.conhecimento ?? [],
          espacos: config.espacosEvento ?? [],
          historico,
          executores,
          modo,
          retomada: params.retomada === true,
        });
      }
      texto = resposta.texto;
      transferiu = resposta.transferiu;
      leadRegistrado = resposta.leadRegistrado;
      // Sem texto E sem áudio enviado = fallback; áudio sozinho é resposta válida.
      if (!texto && !audioEnviado) {
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

    // REDE DE SEGURANÇA: prometeu retorno sem transferir = transfere à força.
    // O prompt já proíbe, mas o modelo escorrega (12/08: cliente celíaca ouviu
    // "vou verificar com a equipe e já retorno" e ninguém foi avisado — ficou
    // 2 dias no vácuo). Lead registrado não conta: a equipe já é avisada.
    if (
      !transferiu &&
      !leadRegistrado &&
      texto &&
      /\bvou (verificar|confirmar|perguntar|checar|falar com|ver com)\b|j[aá] (te )?retorno|retorno (em breve|j[aá] j[aá])/i.test(
        texto,
      )
    ) {
      await executores
        .transferir(
          'Nina prometeu retorno',
          'A Nina disse ao cliente que ia confirmar algo com a equipe — assumir e dar o retorno.',
        )
        .catch(() => {});
      transferiu = true;
    }

    if (texto) {
      texto = limparFechoRepetitivo(texto);
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
    }
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
