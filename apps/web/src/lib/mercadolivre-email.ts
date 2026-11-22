// E-mails do Mercado Livre (plano B, sem API). O script do Google na conta que
// compra empurra os e-mails pra /api/mercadolivre/email com o token abaixo.
// Aqui: o token (derivado do CREDENCIAL_SECRET, nenhuma env nova) e a leitura
// do e-mail (tipo, nº do pedido, valor, Pix/cartão, vendedor, endereço, previsão). O e-mail cru fica guardado
// pra refinar a leitura depois.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function mlEmailToken(): string | null {
  const s = process.env.CREDENCIAL_SECRET;
  if (!s) return null;
  return createHmac('sha256', s).update('ml-email-v1').digest('hex');
}

export function mlEmailTokenConfere(recebido: string | null | undefined): boolean {
  const certo = mlEmailToken();
  if (!certo || !recebido) return false;
  const a = Buffer.from(certo);
  const b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TipoEmailML =
  | 'compra' // "Você comprou …" (Pix traz o valor; cartão não traz)
  | 'pix_pendente' // "Finalize a sua compra" — Pix gerado, ainda não pago
  | 'pagamento_recusado' // "Pague sua compra de outra forma" — cartão recusado
  | 'nfe' // "A NF-e da compra #… já está disponível"
  | 'envio' // a caminho / reagendado
  | 'entrega' // "Sua compra chegou"
  | 'cancelamento'
  | 'pagamento'
  | 'outro'; // propaganda, avaliação, palavra-chave, lado vendedor…

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Remetentes de propaganda: nunca são compra. */
function ehPropaganda(de: string): boolean {
  return /ofertas@|promocion@|promo@|novidades@|marketing@/i.test(de);
}

export function mlEmailTipo(assunto: string, de = ''): TipoEmailML {
  if (ehPropaganda(de)) return 'outro';
  const a = semAcento(assunto);
  if (/ganhe pontos|opiniao|palavra-chave|responderam|leve os produtos|agencia correios|avaliar/.test(a)) return 'outro';
  if (/cancel|reembols|devolu/.test(a)) return 'cancelamento';
  if (/^voce comprou/.test(a)) return 'compra';
  if (/finalize a sua compra/.test(a)) return 'pix_pendente';
  if (/pague sua compra de outra forma/.test(a)) return 'pagamento_recusado';
  if (/nf-e/.test(a)) return 'nfe';
  if (/chegou|entregue|entregamos|recebeu/.test(a)) return 'entrega';
  if (/caminho|reagendamos|enviad|despach|saiu para/.test(a)) return 'envio';
  if (/pagamento|aprovad/.test(a)) return 'pagamento';
  return 'outro';
}

/** HTML do e-mail → texto com "|" entre as tags (o ML põe os centavos numa tag à parte). */
function emPedacos(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;|&#8204;|‌| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&atilde;/g, 'ã')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&otilde;/g, 'õ')
    .replace(/\s+/g, ' ')
    .replace(/(\| ?)+/g, '|');
}

/** "4.839" + "99" → 4839.99 ; "1.125" + null → 1125 */
function reais(inteiro: string, centavos: string | null | undefined): number | null {
  const n = Number(inteiro.replace(/\./g, '')) + (centavos ? Number(centavos) / 100 : 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface LeituraEmailML {
  tipo: TipoEmailML;
  /** nº da compra no ML (link "minhas compras", ou o # do assunto). */
  pedido: string | null;
  /** só quando o e-mail diz o valor (Pix); compra no cartão não traz. */
  total: number | null;
  forma: string | null; // 'Pix' | 'Cartão final 7224' | …
  cartaoFinal: string | null;
  produto: string | null;
  vendedor: string | null;
  vendedorDoc: string | null; // CNPJ/CPF só dígitos
  endereco: string | null;
  cep: string | null;
  previsao: string | null; // "entre 21 e 22 de novembro"
  entregueEm: string | null; // "21 de novembro às 14:28 h"
  /** demais nºs 2000… do e-mail (pacote/envio), pra casar depois. */
  outrosIds: string[];
}

export function mlEmailLer(assunto: string, texto: string, html = '', de = ''): LeituraEmailML {
  const tipo = mlEmailTipo(assunto, de);
  const t = html ? emPedacos(html) : texto.replace(/\s*\n\s*/g, '|');
  const corpo = `${assunto}|${t}`;

  const pedido =
    (html || texto).match(/my_purchases(?:\/|%2F)(\d{12,})/i)?.[1] ??
    assunto.match(/#(\d{10,})/)?.[1] ??
    (tipo !== 'outro' ? `${assunto} ${html || texto}`.match(/\b(2000\d{12})\b/)?.[1] : undefined) ??
    null;
  const outrosIds = [...new Set([...(html || texto).matchAll(/\b(2000\d{12})\b/g)].map((m) => m[1]!))].filter(
    (x) => x !== pedido,
  );

  // valor: "Você pagou |R$|4.839|99|com Pix" / "Pague |R$|703|93|via |Pix" (texto puro: "R$4.83999")
  let total: number | null = null;
  let forma: string | null = null;
  const mHtml = t.match(/(?:Voc[êe] pagou|Pague) ?\|R\$ ?\|?([\d.]+)\|(?:(\d{2})\|)?\s*(?:com|via) ?\|?([^|]+)/i);
  if (mHtml) {
    total = reais(mHtml[1]!, mHtml[2]);
    forma = mHtml[3]!.trim();
  } else {
    const mTxt = texto.match(/(?:Voc[êe] pagou|Pague)\s*R\$\s*([\d.]+?)(\d{2})?\s+(?:com|via)\s+(\S+)/i);
    if (mTxt) {
      // no texto puro os centavos vêm grudados: "4.83999" = 4.839,99
      const bruto = mTxt[1]! + (mTxt[2] ?? '');
      const ult = bruto.split('.').pop()!;
      total = ult.length > 3 ? reais(bruto.slice(0, -2), bruto.slice(-2)) : reais(bruto, null);
      forma = mTxt[3]!;
    }
  }
  if (forma && /^pix/i.test(forma)) forma = 'Pix';
  const cartaoFinal = corpo.match(/terminado em (\d{4})/i)?.[1] ?? corpo.match(/final (\d{4})/i)?.[1] ?? null;
  if (!forma && cartaoFinal) forma = `Cartão final ${cartaoFinal}`;

  const produto =
    assunto.match(/^Voc[êe] comprou (.+)$/i)?.[1] ??
    assunto.match(/^Finalize a sua compra de (.+)$/i)?.[1] ??
    t.match(/\|Voc[êe] recebeu ([^|]+)/i)?.[1] ??
    t.match(/\|A caminho! ([^|]+)/i)?.[1] ??
    (tipo === 'nfe' ? t.match(/\|Voc[êe] comprou ([^|]+?)\.? ?\|/i)?.[1] : undefined) ??
    null;

  const vend = t.match(/\|Voc[êe] comprou de ([^|]+)\|(?:(CNPJ|CPF) (\d+))?/i);
  const end = t.match(/\|Envio no meu endere[çc]o\|([^|]+)/i) ?? t.match(/\|(?:Detalhes do envio:|Em) ?\|?(Rua [^|]+?CEP \d{8})/i);
  const cep = (end?.[1] ?? corpo).match(/CEP (\d{8})/)?.[1] ?? null;

  return {
    tipo,
    pedido,
    total,
    forma,
    cartaoFinal,
    produto: produto?.trim() ?? null,
    vendedor: vend?.[1]?.trim() ?? null,
    vendedorDoc: vend?.[3] ?? null,
    endereco: end?.[1]?.trim() ?? null,
    cep,
    previsao: t.match(/\|Chegar[áa] ([^|]+)/i)?.[1]?.trim() ?? assunto.match(/(?:para|chegará) (entre .+)$/i)?.[1] ?? null,
    entregueEm: t.match(/Entregamos em ([^|.]+)/i)?.[1]?.trim() ?? null,
    outrosIds: outrosIds.slice(0, 10),
  };
}

/** Código do script do Google pra colar na conta que compra no ML. */
export function mlEmailScript(urlApp: string, token: string): string {
  return `// Concilia — manda os e-mails do Mercado Livre / Mercado Pago pro sistema.
// 1) Cole isto em script.google.com (Novo projeto), logado na conta que compra no ML.
// 2) Escolha a função "instalar" e clique em Executar. Autorize.
// Pronto: a cada 15 min os e-mails novos vão pro sistema (desde 01/11/2026).

const URL_CONCILIA = '${urlApp}/api/mercadolivre/email';
const TOKEN = '${token}';
const DESDE = 1793502000; // 01/11/2026 00:00 (Brasília)

function enviarML() {
  const props = PropertiesService.getScriptProperties();
  const ultimo = Number(props.getProperty('ultimo') || DESDE);
  const q = 'from:(mercadolivre.com OR mercadolivre.com.br OR mercadopago.com OR mercadopago.com.br) after:' + ultimo;
  let maior = ultimo;
  for (let ini = 0; ini < 500; ini += 50) {
    const threads = GmailApp.search(q, ini, 50);
    if (!threads.length) break;
    const lote = [];
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        const seg = Math.floor(m.getDate().getTime() / 1000);
        if (seg < ultimo) return;
        if (seg > maior) maior = seg;
        lote.push({
          id: m.getId(),
          data: m.getDate().toISOString(),
          de: m.getFrom(),
          para: m.getTo(),
          assunto: m.getSubject(),
          texto: (m.getPlainBody() || '').slice(0, 60000),
          html: (m.getBody() || '').slice(0, 200000),
        });
      });
    });
    for (let i = 0; i < lote.length; i += 20) {
      const r = UrlFetchApp.fetch(URL_CONCILIA, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + TOKEN },
        payload: JSON.stringify({ conta: Session.getActiveUser().getEmail(), emails: lote.slice(i, i + 20) }),
        muteHttpExceptions: true,
      });
      if (r.getResponseCode() !== 200) throw new Error('Concilia respondeu ' + r.getResponseCode() + ': ' + r.getContentText());
    }
    if (threads.length < 50) break;
  }
  // volta 1 h pra não perder e-mail que chega fora de ordem (o sistema ignora repetido)
  props.setProperty('ultimo', String(Math.max(DESDE, maior - 3600)));
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarML').timeBased().everyMinutes(15).create();
  enviarML();
}
`;
}
