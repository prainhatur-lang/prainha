// Envio de e-mail pelo Resend (05/11/2026). Primeiro uso: o acesso de quem se
// cadastra no /conheca. Só liga com a env RESEND_API_KEY (Vercel Production);
// sem ela não envia nada e devolve { ok: false, motivo: 'desligado' }.
// Remetente em EMAIL_REMETENTE (ex.: "Concilia <acesso@conciliabr.app>"),
// com o domínio verificado no Resend.

export interface ResultadoEmail {
  ok: boolean;
  id?: string;
  motivo?: string;
}

export function emailLigado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function enviarEmail(p: {
  para: string;
  assunto: string;
  html: string;
  texto?: string;
  responderPara?: string;
}): Promise<ResultadoEmail> {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) return { ok: false, motivo: 'desligado' };
  const de = process.env.EMAIL_REMETENTE || 'Concilia <acesso@conciliabr.app>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: de,
        to: [p.para],
        subject: p.assunto,
        html: p.html,
        ...(p.texto ? { text: p.texto } : {}),
        ...(p.responderPara || process.env.EMAIL_RESPONDER_PARA
          ? { reply_to: p.responderPara || process.env.EMAIL_RESPONDER_PARA }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok) return { ok: false, motivo: `${r.status} ${j.message ?? ''}`.trim() };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** Escapa texto pra entrar no HTML do e-mail. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
