// Passagem entre casas (dono, 14/10/2026): "quando a pessoa quiser falar sobre
// Tabuará, transfere para o número do Otávio, e o Otávio já fala com ela, e
// vice-versa". A atendente de uma casa não consegue abrir conversa no número
// da outra (a Meta só deixa o número falar primeiro com template aprovado),
// então a passagem é um link wa.me pro número da outra casa com a mensagem já
// escrita: a pessoa toca, manda, e quem atende lá acha a conversa de origem
// pelo telefone e continua dali — sem pedir tudo de novo.
//
// Entra sozinha toda casa com número ligado (whatsapp_numero.atendente_ativo)
// e atendente ativa (atendimento_config.ativo) — a Prainha Mar entra no dia em
// que tiver número.
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { BlocoConhecimento } from '@concilia/db/schema';
import type { MsgHistorico } from './ia';
import { linkCardapio } from './cardapio';

export interface OutraCasa {
  filialId: string;
  filialNome: string;
  atendente: string;
  /** Só dígitos, com DDI (5579...). */
  numero: string;
}

export interface PassagemRecebida {
  deAtendente: string;
  deCasa: string;
  mensagens: MsgHistorico[];
}

/** Janela em que a conversa de origem ainda vale de contexto pra quem recebe. */
const JANELA_PASSAGEM = '48 hours';

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Nome de exibição: "Tabuara" cadastrado sem acento vira "Tabuará". */
export function nomeDaCasa(nome: string): string {
  return /^tabuara$/i.test(nome.trim()) ? 'Tabuará' : nome;
}

/** As outras casas do grupo que têm atendente própria no WhatsApp. */
export async function casasComAtendente(filialIdAtual: string): Promise<OutraCasa[]> {
  const [atual] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialIdAtual))
    .limit(1);
  if (!atual) return [];
  const linhas = await db
    .select({
      filialId: schema.filial.id,
      filialNome: schema.filial.nome,
      atendente: schema.atendimentoConfig.nomeAtendente,
      numero: schema.whatsappNumero.numeroExibicao,
    })
    .from(schema.whatsappNumero)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.whatsappNumero.filialId))
    .innerJoin(schema.atendimentoConfig, eq(schema.atendimentoConfig.filialId, schema.whatsappNumero.filialId))
    .where(
      and(
        eq(schema.whatsappNumero.atendenteAtivo, true),
        eq(schema.atendimentoConfig.ativo, true),
        eq(schema.filial.organizacaoId, atual.organizacaoId),
        ne(schema.filial.id, filialIdAtual),
      ),
    );
  const vistas = new Set<string>();
  const out: OutraCasa[] = [];
  for (const l of linhas) {
    const numero = (l.numero ?? '').replace(/\D/g, '');
    if (numero.length < 10 || vistas.has(l.filialId)) continue;
    vistas.add(l.filialId);
    out.push({ filialId: l.filialId, filialNome: nomeDaCasa(l.filialNome), atendente: l.atendente, numero });
  }
  return out;
}

// CASA SEM NÚMERO PRÓPRIO (14/10/2026): o botão de WhatsApp do site da Prainha
// Mar cai no número do Prainha Bar, e a Nina dizia "não temos unidade no
// Shopping Praia Sul" (9+ clientes entre 30/09 e 13/10). Enquanto a casa não
// tem número ligado, quem atende por ela é o número do Prainha Bar, lendo a
// base de conhecimento da própria casa (atendimento_config dela, mesmo com a
// atendente desligada). No dia em que a casa ligar número e atendente, ela sai
// daqui e entra em casasComAtendente (passagem).
const FILIAL_TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
/** Reserva online da casa coberta — a Nina manda o link, não cria por aqui. */
const LINK_RESERVA_POR_FILIAL: Record<string, string> = {
  'e899dae2-38bf-4f3f-9149-7effd059fab8': 'https://prainhamar.com.br/reserva',
};

export interface CasaCoberta {
  filialId: string;
  filialNome: string;
  conhecimento: BlocoConhecimento[];
  linkReserva: string | null;
  linkCardapio: string;
}

/**
 * Casas do grupo que ainda não têm WhatsApp próprio e têm base de conhecimento
 * cadastrada. A Tabuará fica de fora: o número do Prainha Bar já fala dela
 * pelos próprios blocos (modo "duas casas").
 */
export async function casasCobertas(filialIdAtual: string, comAtendente: OutraCasa[]): Promise<CasaCoberta[]> {
  const [atual] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialIdAtual))
    .limit(1);
  if (!atual) return [];
  const linhas = await db
    .select({
      filialId: schema.filial.id,
      filialNome: schema.filial.nome,
      conhecimento: schema.atendimentoConfig.conhecimento,
    })
    .from(schema.atendimentoConfig)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.atendimentoConfig.filialId))
    .where(
      and(
        eq(schema.filial.organizacaoId, atual.organizacaoId),
        ne(schema.filial.id, filialIdAtual),
        ne(schema.filial.id, FILIAL_TABUARA),
      ),
    );
  const ligadas = new Set(comAtendente.map((c) => c.filialId));
  return linhas
    .filter((l) => !ligadas.has(l.filialId) && (l.conhecimento ?? []).length > 0)
    .map((l) => ({
      filialId: l.filialId,
      filialNome: nomeDaCasa(l.filialNome),
      conhecimento: l.conhecimento ?? [],
      linkReserva: LINK_RESERVA_POR_FILIAL[l.filialId] ?? null,
      linkCardapio: linkCardapio(l.filialId),
    }));
}

/** Casa coberta pelo nome que o modelo escreveu ("Prainha Mar", "Mar", "mar e grill"). */
export function acharCasaCoberta(casas: CasaCoberta[], pedido: string): CasaCoberta | null {
  const p = semAcento(pedido);
  if (!p) return null;
  const exata = casas.find((c) => semAcento(c.filialNome) === p);
  if (exata) return exata;
  const palavras = p.split(/\s+/).filter((w) => w.length >= 3 && !['prainha', 'restaurante', 'casa', 'bar', 'grill'].includes(w));
  const candidatas = casas.filter((c) => {
    const n = semAcento(c.filialNome);
    return n.includes(p) || palavras.some((w) => n.split(/\s+/).includes(w));
  });
  return candidatas.length === 1 ? candidatas[0] : null;
}

/** Acha a casa pelo que o modelo escreveu ("Tabuará", "tabuara", "Otávio", "Mar"). */
export function acharCasa(casas: OutraCasa[], pedido: string): OutraCasa | null {
  const p = semAcento(pedido);
  if (!p) return casas.length === 1 ? casas[0] : null;
  const exata = casas.find((c) => semAcento(c.filialNome) === p || semAcento(c.atendente) === p);
  if (exata) return exata;
  // "Prainha" sozinho com Bar e Mar ligados é ambíguo: pedaço só vale se casar com UMA.
  const porNome = casas.filter((c) => {
    const n = semAcento(c.filialNome);
    return n.includes(p) || p.includes(n) || p.includes(semAcento(c.atendente));
  });
  if (porNome.length === 1) return porNome[0];
  // "Mar" sozinho, "Tabu": pedaço que só uma casa tem.
  const palavras = p.split(/\s+/).filter((w) => w.length >= 3 && !['prainha', 'restaurante', 'casa', 'bar'].includes(w));
  const candidatas = casas.filter((c) => palavras.some((w) => semAcento(c.filialNome).includes(w)));
  return candidatas.length === 1 ? candidatas[0] : null;
}

/** Link que abre a conversa no número da outra casa com a mensagem já escrita. */
export function linkPassagem(destino: OutraCasa, origemNome: string, resumo: string): string {
  const pedido = resumo.replace(/\s+/g, ' ').trim().slice(0, 200);
  const texto = `Oi, ${destino.atendente}! Vim pelo WhatsApp do ${nomeDaCasa(origemNome)}.${pedido ? ` ${pedido}` : ''}`;
  return `https://wa.me/${destino.numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * Quem chega pelo link: procura, nas OUTRAS casas, a mensagem da atendente com
 * o link deste número pro mesmo telefone nas últimas 48 h e devolve o fim
 * daquela conversa (pra quem recebe continuar de onde parou).
 */
export async function passagemRecebida(params: {
  filialId: string;
  phoneNumberId: string;
  telefone: string;
}): Promise<PassagemRecebida | null> {
  const [meu] = await db
    .select({ numero: schema.whatsappNumero.numeroExibicao })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.phoneNumberId, params.phoneNumberId))
    .limit(1);
  const numero = (meu?.numero ?? '').replace(/\D/g, '');
  if (numero.length < 10) return null;

  const [origem] = await db
    .select({
      conversaId: schema.atendimentoMensagem.conversaId,
      filialId: schema.atendimentoConversa.filialId,
    })
    .from(schema.atendimentoMensagem)
    .innerJoin(schema.atendimentoConversa, eq(schema.atendimentoConversa.id, schema.atendimentoMensagem.conversaId))
    .where(
      and(
        eq(schema.atendimentoConversa.telefone, params.telefone),
        ne(schema.atendimentoConversa.filialId, params.filialId),
        eq(schema.atendimentoMensagem.direcao, 'saida'),
        // Link mandado pela equipe ("passar pro Tabuará" pelo painel) também vale.
        inArray(schema.atendimentoMensagem.autor, ['bot', 'equipe']),
        sql`${schema.atendimentoMensagem.corpo} ILIKE ${`%wa.me/${numero}%`}`,
        sql`${schema.atendimentoMensagem.criadoEm} > now() - ${sql.raw(`interval '${JANELA_PASSAGEM}'`)}`,
      ),
    )
    .orderBy(desc(schema.atendimentoMensagem.criadoEm))
    .limit(1);
  if (!origem) return null;

  const [cfg] = await db
    .select({ atendente: schema.atendimentoConfig.nomeAtendente, casa: schema.filial.nome })
    .from(schema.atendimentoConfig)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.atendimentoConfig.filialId))
    .where(eq(schema.atendimentoConfig.filialId, origem.filialId))
    .limit(1);

  const linhas = await db
    .select({
      direcao: schema.atendimentoMensagem.direcao,
      autor: schema.atendimentoMensagem.autor,
      tipo: schema.atendimentoMensagem.tipo,
      corpo: schema.atendimentoMensagem.corpo,
    })
    .from(schema.atendimentoMensagem)
    .where(eq(schema.atendimentoMensagem.conversaId, origem.conversaId))
    .orderBy(desc(schema.atendimentoMensagem.criadoEm))
    .limit(12);

  return {
    deAtendente: cfg?.atendente ?? 'a atendente',
    deCasa: nomeDaCasa(cfg?.casa ?? 'outra casa do grupo'),
    mensagens: linhas.reverse(),
  };
}
