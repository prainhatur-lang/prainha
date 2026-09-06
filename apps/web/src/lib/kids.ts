// Espaço Kids — lado da NUVEM: ponte do WhatsApp pro vendas-local.
//
// A loja (server.mjs) registra a criança, a mesa e o responsável; a nuvem só
// faz o que a loja não consegue: receber a mensagem do QR pelo webhook da
// Meta (confirma o zap), mandar texto livre na janela de 24 h e guardar as
// respostas do responsável pra loja buscar por polling.
// Spec: docs/superpowers/specs/2026-09-03-espaco-kids-design.md

import { db, schema } from '@concilia/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { enviarTexto } from '@/lib/atendimento/zap';
import { horaAgoraBr } from '@/lib/datas';

// ---------------------------------------------------------------- assinatura

/** Mesma chave do /pagar-mesa e do /cliente-documento (a loja já tem):
 *  s = HMAC_SHA256(PAGAR_MESA_SECRET, f|kids|e). */
function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Valida f/e/s vindos da query (GET) ou do corpo (POST). Devolve a filial
 *  (id + nome) ou null. */
export async function validaLojaKids(
  src: URLSearchParams | Record<string, unknown>,
): Promise<{ id: string; nome: string } | null> {
  const g = (k: string) => {
    const v = src instanceof URLSearchParams ? src.get(k) : src[k];
    return v == null ? '' : String(v);
  };
  const f = g('f'), e = Number(g('e')), s = g('s');
  if (!/^[0-9a-f-]{36}$/.test(f) || !Number.isFinite(e)) return null;
  if (e * 1000 < Date.now()) return null;
  if (!confere([f, 'kids', String(e)], s)) return null;
  const [fil] = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, f))
    .limit(1);
  return fil ?? null;
}

// ---------------------------------------------------------------- número da casa

/** Número do WhatsApp que vai no QR: o da filial; se ela não tem (caso da
 *  Prainha Mar hoje), o primeiro com atendente ativo (o da Nina). */
export async function numeroDaCasa(
  filialId: string,
): Promise<{ phoneNumberId: string; numeroExibicao: string | null } | null> {
  const cols = {
    phoneNumberId: schema.whatsappNumero.phoneNumberId,
    numeroExibicao: schema.whatsappNumero.numeroExibicao,
  };
  const [proprio] = await db
    .select(cols)
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, filialId))
    .orderBy(desc(schema.whatsappNumero.atendenteAtivo), schema.whatsappNumero.criadoEm)
    .limit(1);
  if (proprio) return proprio;
  const [qualquer] = await db
    .select(cols)
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.atendenteAtivo, true))
    .orderBy(schema.whatsappNumero.criadoEm)
    .limit(1);
  return qualquer ?? null;
}

// ---------------------------------------------------------------- textos

/** "Elison Bomfim" -> "Elison B." (igual ao nomeCurto do server.mjs). */
export function nomeCurto(nome: string): string {
  const partes = String(nome || '').trim().split(/\s+/)
    .filter((p) => !/^(da|de|do|das|dos|e)$/i.test(p));
  if (!partes.length) return '';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const primeiro = cap(partes[0]);
  return partes.length > 1 ? `${primeiro} ${partes[1][0].toUpperCase()}.` : primeiro;
}

/** [{nome:'Maria',idade:6},{nome:'João',idade:4}] -> "Maria (6) e João (4)". */
export function listaCriancas(lista: Array<{ nome: string; idade: number | null }>): string {
  const nomes = lista.map((c) => (c.idade != null ? `${c.nome} (${c.idade})` : c.nome));
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** Concordância: "Maria (6) e João (4)" -> plural. */
function plural(criancas: string): boolean {
  return / e /.test(criancas);
}

/** Msg 2 — confirmação automática quando o responsável manda o QR. */
export function msgConfirmacao(ck: {
  responsavelNome: string; criancas: string; loja: string; mesa: number | null;
  linkCamera: string | null; hora: string;
}): string {
  const verbo = plural(ck.criancas) ? 'estão' : 'está';
  const mesa = ck.mesa ? `, mesa ${ck.mesa}` : '';
  const linhas = [
    `✅ Pronto, ${nomeCurto(ck.responsavelNome)}! ${ck.criancas} ${verbo} no Espaço Kids do ${ck.loja}${mesa}, desde ${ck.hora}.`,
  ];
  if (ck.linkCamera) linhas.push(`📹 Veja o espaço ao vivo: ${ck.linkCamera}`);
  linhas.push('Quando a monitora precisar de você, avisamos por aqui. Se quiser falar com ela, é só responder esta mensagem.');
  return linhas.join('\n');
}

/** Msg 4 — entrou de novo no mesmo dia (zap já confirmado, sem QR). */
export function msgEntrou(criancas: string, hora: string, mesa: number | null): string {
  const verbo = plural(criancas) ? 'entraram' : 'entrou';
  return `✅ ${criancas} ${verbo} no Espaço Kids às ${hora}${mesa ? `, mesa ${mesa}` : ''}.`;
}

export const MSG_CODIGO_NAO_ACHADO = 'Não achei esse código. Peça pra monitora mostrar o QR de novo.';

// ---------------------------------------------------------------- envio

/** Manda texto pro responsável e grava em kids_mensagem (direcao saida). */
export async function enviarParaResponsavel(
  ck: { id: string; phoneNumberId: string; telefoneConfirmado: string },
  texto: string,
): Promise<{ waMessageId: string | null; erro?: string }> {
  const envio = await enviarTexto(ck.phoneNumberId, ck.telefoneConfirmado, texto);
  await db
    .insert(schema.kidsMensagem)
    .values({
      checkinId: ck.id,
      direcao: 'saida',
      texto,
      waMessageId: envio.waMessageId,
      erro: envio.erro ?? null,
    })
    .onConflictDoNothing()
    .catch(() => {});
  return envio;
}

// ---------------------------------------------------------------- webhook

type MsgMeta = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
};

const RE_CODIGO = /kids[\s\S]*c[oó]digo\s*[:\-]?\s*([A-Z0-9]{6})/i;

/** Desvio do webhook. Devolve true se a mensagem é do Espaço Kids (a Nina
 *  não deve vê-la):
 *  1. texto com "Kids … código XXXXXX" → confirma o check-in e responde;
 *  2. número com check-in confirmado nas últimas 24 h → guarda a resposta
 *     pra monitora ver na tela (a Nina fica quieta enquanto isso);
 *  3. senão false. Nunca lança. */
export async function tratarKids(msg: MsgMeta, phoneNumberId: string | undefined): Promise<boolean> {
  if (!msg.from || !phoneNumberId) return false;
  try {
    const corpo = msg.type === 'text' ? (msg.text?.body ?? '') : '';
    const m = corpo.match(RE_CODIGO);
    if (m) {
      await confirmarPorCodigo(phoneNumberId, msg.from, m[1].toUpperCase(), corpo, msg.id ?? null);
      return true;
    }

    const [ativo] = await db
      .select({ id: schema.kidsCheckin.id })
      .from(schema.kidsCheckin)
      .where(
        and(
          eq(schema.kidsCheckin.phoneNumberId, phoneNumberId),
          eq(schema.kidsCheckin.telefoneConfirmado, msg.from),
          eq(schema.kidsCheckin.status, 'confirmado'),
          gt(schema.kidsCheckin.confirmadoEm, sql`now() - interval '24 hours'`),
        ),
      )
      .orderBy(desc(schema.kidsCheckin.confirmadoEm))
      .limit(1);
    if (!ativo) return false;

    // Reação/figurinha: some, mas não vira "resposta" na tela da monitora.
    if (msg.type === 'reaction' || msg.type === 'sticker') return true;

    let texto = corpo.trim();
    if (msg.type === 'audio') texto = '🎤 áudio';
    else if (msg.type === 'image') texto = `📷 imagem${msg.image?.caption ? ` — ${msg.image.caption}` : ''}`;
    else if (msg.type === 'video') texto = `🎥 vídeo${msg.video?.caption ? ` — ${msg.video.caption}` : ''}`;
    else if (msg.type === 'document') texto = `📎 ${msg.document?.filename || msg.document?.caption || 'documento'}`;
    else if (msg.type === 'location') texto = '📍 localização';
    else if (!texto) texto = `(${msg.type ?? 'mensagem'})`;

    await db
      .insert(schema.kidsMensagem)
      .values({ checkinId: ativo.id, direcao: 'entrada', texto: texto.slice(0, 2000), waMessageId: msg.id ?? null })
      .onConflictDoNothing();
    return true;
  } catch (e) {
    console.error('tratarKids falhou', e);
    // Já é "assunto do kids" — melhor a Nina ficar quieta do que responder
    // um código de check-in como se fosse pergunta de cardápio.
    return true;
  }
}

async function confirmarPorCodigo(
  phoneNumberId: string,
  from: string,
  codigo: string,
  corpo: string,
  waMessageId: string | null,
): Promise<void> {
  const [ck] = await db
    .select({
      id: schema.kidsCheckin.id,
      filialId: schema.kidsCheckin.filialId,
      responsavelNome: schema.kidsCheckin.responsavelNome,
      criancas: schema.kidsCheckin.criancas,
      mesa: schema.kidsCheckin.mesa,
      linkCamera: schema.kidsCheckin.linkCamera,
      status: schema.kidsCheckin.status,
      telefoneConfirmado: schema.kidsCheckin.telefoneConfirmado,
    })
    .from(schema.kidsCheckin)
    .where(
      and(
        eq(schema.kidsCheckin.phoneNumberId, phoneNumberId),
        eq(schema.kidsCheckin.codigo, codigo),
        gt(schema.kidsCheckin.criadoEm, sql`now() - interval '2 hours'`),
      ),
    )
    .orderBy(desc(schema.kidsCheckin.criadoEm))
    .limit(1);

  // Reentrega da Meta do mesmo QR (já confirmado por esse mesmo celular):
  // grava (dedupe pelo wa_message_id) e não responde de novo.
  if (ck && ck.status === 'confirmado' && ck.telefoneConfirmado === from) {
    await db
      .insert(schema.kidsMensagem)
      .values({ checkinId: ck.id, direcao: 'entrada', texto: corpo.slice(0, 2000), waMessageId })
      .onConflictDoNothing();
    return;
  }

  if (!ck || ck.status !== 'aguardando') {
    await enviarTexto(phoneNumberId, from, MSG_CODIGO_NAO_ACHADO);
    return;
  }

  await db
    .update(schema.kidsCheckin)
    .set({ status: 'confirmado', telefoneConfirmado: from, confirmadoEm: sql`now()` })
    .where(eq(schema.kidsCheckin.id, ck.id));
  await db
    .insert(schema.kidsMensagem)
    .values({ checkinId: ck.id, direcao: 'entrada', texto: corpo.slice(0, 2000), waMessageId })
    .onConflictDoNothing();

  const [fil] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, ck.filialId))
    .limit(1);
  const texto = msgConfirmacao({
    responsavelNome: ck.responsavelNome,
    criancas: ck.criancas,
    loja: fil?.nome ?? 'Prainha',
    mesa: ck.mesa,
    linkCamera: ck.linkCamera,
    hora: horaAgoraBr(),
  });
  await enviarParaResponsavel({ id: ck.id, phoneNumberId, telefoneConfirmado: from }, texto);
}
