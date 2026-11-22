// E-mails do Mercado Livre (plano B, sem API). O script do Google na conta que
// compra empurra os e-mails pra /api/mercadolivre/email com o token abaixo.
// Aqui: o token (derivado do CREDENCIAL_SECRET, nenhuma env nova) e a leitura
// best-effort do e-mail (tipo, nº do pedido, total). O e-mail cru fica guardado
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

export type TipoEmailML = 'compra' | 'pagamento' | 'envio' | 'entrega' | 'cancelamento' | 'outro';

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function mlEmailTipo(assunto: string): TipoEmailML {
  const a = semAcento(assunto);
  if (/cancel|reembols|devolu/.test(a)) return 'cancelamento';
  if (/entreg(ue|amos|a realizada)|chegou|recebeu/.test(a)) return 'entrega';
  if (/caminho|enviad|despach|a caminho|saiu para|rastre/.test(a)) return 'envio';
  if (/pagamento|pago|aprovad|pix|boleto|fatura/.test(a)) return 'pagamento';
  if (/compr(ou|a)|pedido/.test(a)) return 'compra';
  return 'outro';
}

/** "1.234,56" → 1234.56 */
function numeroBr(s: string): number | null {
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export interface LeituraEmailML {
  tipo: TipoEmailML;
  pedido: string | null;
  total: number | null;
  valores: number[];
}

export function mlEmailLer(assunto: string, texto: string): LeituraEmailML {
  const corpo = `${assunto}\n${texto}`;
  const pedido =
    corpo.match(/(?:pedido|compra|venda)\s*(?:n[ºo°.]*|#|:)?\s*#?\s*(\d{10,})/i)?.[1] ??
    corpo.match(/#(\d{10,})/)?.[1] ??
    null;
  const valores = [...corpo.matchAll(/R\$\s*([\d.]+,\d{2})/g)]
    .map((m) => numeroBr(m[1]!))
    .filter((n): n is number => n != null);
  const total =
    (() => {
      const m = corpo.match(/total[^\n\dR]{0,40}R\$\s*([\d.]+,\d{2})/i) ?? corpo.match(/(?:voc[eê] pagou|pagamento de)[^\n\dR]{0,30}R\$\s*([\d.]+,\d{2})/i);
      return m ? numeroBr(m[1]!) : null;
    })() ?? (valores.length ? Math.max(...valores) : null);
  return { tipo: mlEmailTipo(assunto), pedido, total, valores: valores.slice(0, 30) };
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
