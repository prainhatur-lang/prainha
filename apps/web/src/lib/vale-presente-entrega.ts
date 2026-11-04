// Vale-presente chegando em QUEM GANHOU — 04/11/2026.
//
// Até aqui o link do vale só ia pra quem COMPRA (Nina/site). Agora, com o
// WhatsApp do presenteado gravado (campo opcional na compra ou digitado pelo
// comprador na página do vale), o vale QUITADO vai direto pra ele.
//
// Quem nunca falou com a casa só recebe mensagem por MODELO aprovado. O
// próprio sistema cria o `vale_presente` (UTILIDADE) na Meta na primeira vez
// que precisa, igual ao `comprovante_pix`. Enquanto o modelo estiver em
// análise, a entrega fica pendente e é tentada de novo quando alguém abre a
// página do vale — e o comprador sempre tem o botão do wa.me como saída.
//
// Corpo: {{1}} presenteado, {{2}} quem deu, {{3}} o presente, {{4}} casa.
// Botão "Ver meu vale": URL dinâmica /presente/{{1}} (token).

import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { wabaDoRemetente } from '@/lib/relatorio-diario-envio';

export const NOME_MODELO_VALE = 'vale_presente';

type Vale = typeof schema.valePresente.$inferSelect;

const versao = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const token = () => process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
const appUrl = () => {
  const v = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\\n/g, '').replace(/\/+$/, '');
  return /^https:\/\//.test(v) ? v : 'https://app.prainhabar.com';
};
const prefixoLink = () => `${appUrl()}/presente/`;

const CORPO =
  'Olá, {{1}}! {{2}} te deu um vale-presente de {{3}} para usar no {{4}}. O vale já está pago. Toque em "Ver meu vale" para abrir o código e mostre na chegada.';
const EXEMPLO = [['Ana e Pedro', 'Maria', 'R$ 200,00', 'Prainha Bar']];

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Telefone BR em E.164 sem "+": 79999998888 → 5579999998888. null = inválido. */
export function foneWhatsApp(s: string | null | undefined): string | null {
  let d = (s ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

/** E-mail simples (só pra não gravar lixo). */
export function emailValido(s: string | null | undefined): string | null {
  const e = (s ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200 ? e : null;
}

export type SituacaoModeloVale = 'aprovado' | 'em_analise' | 'recusado' | 'nao_existe' | 'indisponivel';
export interface EstadoModeloVale {
  situacao: SituacaoModeloVale;
  detalhe: string | null;
  idioma?: string;
}

let lembrado: { quando: number; valor: EstadoModeloVale } | null = null;

export async function estadoModeloVale(forcar = false): Promise<EstadoModeloVale> {
  if (!forcar && lembrado && Date.now() - lembrado.quando < 60_000) return lembrado.valor;
  if (!token() || !process.env.WHATSAPP_PHONE_ID) return { situacao: 'indisponivel', detalhe: 'WhatsApp não configurado' };
  try {
    const waba = await wabaDoRemetente();
    const resp = await fetch(
      `https://graph.facebook.com/${versao()}/${waba}/message_templates?name=${NOME_MODELO_VALE}&fields=id,name,status,language,rejected_reason&limit=50`,
      { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) },
    );
    const json = (await resp.json().catch(() => null)) as
      | { data?: Array<{ name?: string; status?: string; language?: string; rejected_reason?: string }>; error?: { message?: string } }
      | null;
    if (!resp.ok) return { situacao: 'indisponivel', detalhe: json?.error?.message ?? `HTTP ${resp.status}` };
    const iguais = (json?.data ?? []).filter((t) => t.name === NOME_MODELO_VALE);
    const t = iguais.find((x) => x.language === 'pt_BR') ?? iguais[0];
    let valor: EstadoModeloVale;
    if (!t) valor = { situacao: 'nao_existe', detalhe: null };
    else {
      const st = (t.status ?? '').toUpperCase();
      if (st === 'APPROVED') valor = { situacao: 'aprovado', detalhe: null, idioma: t.language };
      else if (st === 'PENDING' || st === 'IN_APPEAL') valor = { situacao: 'em_analise', detalhe: null, idioma: t.language };
      else {
        const motivo = t.rejected_reason && t.rejected_reason !== 'NONE' ? ` (${t.rejected_reason})` : '';
        valor = { situacao: 'recusado', detalhe: `${st}${motivo}`, idioma: t.language };
      }
    }
    lembrado = { quando: Date.now(), valor };
    return valor;
  } catch (e) {
    return { situacao: 'indisponivel', detalhe: e instanceof Error ? e.message : String(e) };
  }
}

/** Cria o `vale_presente` na Meta se ainda não existe. Devolve o estado. */
export async function garantirModeloVale(): Promise<EstadoModeloVale> {
  const atual = await estadoModeloVale();
  if (atual.situacao !== 'nao_existe') return atual;
  try {
    const waba = await wabaDoRemetente();
    const resp = await fetch(`https://graph.facebook.com/${versao()}/${waba}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: NOME_MODELO_VALE,
        language: 'pt_BR',
        category: 'UTILITY',
        components: [
          { type: 'BODY', text: CORPO, example: { body_text: EXEMPLO } },
          {
            type: 'BUTTONS',
            buttons: [
              {
                type: 'URL',
                text: 'Ver meu vale',
                url: `${prefixoLink()}{{1}}`,
                example: [`${prefixoLink()}cgqTXSu3QC4aTAlrd6BcJTyy`],
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await resp.json().catch(() => null)) as { error?: { message?: string; error_user_msg?: string } } | null;
    if (!resp.ok) {
      return { situacao: 'indisponivel', detalhe: json?.error?.error_user_msg ?? json?.error?.message ?? `HTTP ${resp.status}` };
    }
  } catch (e) {
    return { situacao: 'indisponivel', detalhe: e instanceof Error ? e.message : String(e) };
  }
  lembrado = null;
  const depois = await estadoModeloVale(true);
  return depois.situacao === 'nao_existe' || depois.situacao === 'indisponivel'
    ? { situacao: 'em_analise', detalhe: null }
    : depois;
}

/** "R$ 100,00" (vale por valor) ou "um jantar para 2 pessoas" (menu da Nina). */
export function descricaoPresente(v: Pick<Vale, 'tipo' | 'total' | 'pessoas'>): string {
  return v.tipo === 'valor' ? brl(Number(v.total)) : `um jantar para ${v.pessoas} pessoa${v.pessoas === 1 ? '' : 's'}`;
}

export interface ResultadoEntrega {
  enviado: boolean;
  motivo: string;
}

/**
 * Manda o vale QUITADO pro WhatsApp do presenteado (uma vez só por vale).
 * Seguro de chamar várias vezes: sem telefone, não pago ou já entregue = nada.
 */
export async function entregarValeAoPresenteado(v: Vale): Promise<ResultadoEntrega> {
  if (v.status !== 'pago') return { enviado: false, motivo: 'vale não está pago' };
  if (v.presenteadoAvisadoEm) return { enviado: true, motivo: 'já entregue' };
  const para = foneWhatsApp(v.presenteadoTelefone);
  if (!para) return { enviado: false, motivo: 'sem WhatsApp do presenteado' };

  const anotar = (motivo: string) =>
    db
      .update(schema.valePresente)
      .set({ presenteadoAviso: motivo.slice(0, 500) })
      .where(eq(schema.valePresente.id, v.id))
      .catch(() => {});

  const modelo = await garantirModeloVale();
  if (modelo.situacao !== 'aprovado') {
    const motivo =
      modelo.situacao === 'em_analise'
        ? 'modelo vale_presente em análise na Meta — tenta de novo ao abrir o vale'
        : `modelo vale_presente ${modelo.situacao}${modelo.detalhe ? `: ${modelo.detalhe}` : ''}`;
    await anotar(motivo);
    return { enviado: false, motivo };
  }

  // Reserva a entrega (evita mandar 2x se o webhook e a página chegarem juntos).
  const [reservado] = await db
    .update(schema.valePresente)
    .set({ presenteadoAvisadoEm: new Date(), presenteadoAviso: 'enviando' })
    .where(and(eq(schema.valePresente.id, v.id), isNull(schema.valePresente.presenteadoAvisadoEm)))
    .returning({ id: schema.valePresente.id });
  if (!reservado) return { enviado: true, motivo: 'já entregue' };

  const [f] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, v.filialId))
    .limit(1);
  const limpa = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120) || '-';
  const corpo = [
    v.presenteados?.trim() || 'tudo bem',
    v.compradorNome?.trim() || 'Alguém especial',
    descricaoPresente(v),
    f?.nome ?? 'Prainha',
  ].map(limpa);

  try {
    const resp = await fetch(`https://graph.facebook.com/${versao()}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: para,
        type: 'template',
        template: {
          name: NOME_MODELO_VALE,
          language: { code: modelo.idioma || 'pt_BR' },
          components: [
            { type: 'body', parameters: corpo.map((text) => ({ type: 'text', text })) },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: v.token }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await resp.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
      | null;
    if (!resp.ok) {
      const motivo = `WhatsApp recusou: ${json?.error?.code ?? resp.status} ${json?.error?.message ?? ''}`.trim();
      await db
        .update(schema.valePresente)
        .set({ presenteadoAvisadoEm: null, presenteadoAviso: motivo.slice(0, 500) })
        .where(eq(schema.valePresente.id, v.id));
      return { enviado: false, motivo };
    }
    await anotar(`enviado pro WhatsApp ${para}${json?.messages?.[0]?.id ? ` (${json.messages[0].id})` : ''}`);
    return { enviado: true, motivo: 'enviado' };
  } catch (e) {
    const motivo = `falha ao enviar: ${e instanceof Error ? e.message : String(e)}`;
    await db
      .update(schema.valePresente)
      .set({ presenteadoAvisadoEm: null, presenteadoAviso: motivo.slice(0, 500) })
      .where(eq(schema.valePresente.id, v.id));
    return { enviado: false, motivo };
  }
}
