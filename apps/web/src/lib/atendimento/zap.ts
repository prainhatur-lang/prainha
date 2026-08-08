// Graph API (Meta) com phone_number_id parametrizado — a Nina pode morar em
// numeros diferentes por filial (whatsapp_numero), entao nada de env fixa de
// phone id aqui (a WHATSAPP_PHONE_ID segue sendo usada pelos fluxos internos
// de cotacao/pedido/reserva em whatsapp-otp.ts).

function token(): string {
  return process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
}

function versao(): string {
  return process.env.WHATSAPP_API_VERSION || 'v21.0';
}

export function zapConfigurado(): boolean {
  return !!token();
}

/** Envia texto livre (janela de 24h). Retorna o wa_message_id ou null + erro. */
export async function enviarTexto(
  phoneNumberId: string,
  para: string,
  corpo: string,
): Promise<{ waMessageId: string | null; erro?: string }> {
  if (!token()) return { waMessageId: null, erro: 'WHATSAPP_TOKEN/META ausente' };
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${versao()}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: para,
          type: 'text',
          text: { body: corpo },
        }),
      },
    );
    const json = (await resp.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string } }
      | null;
    if (!resp.ok) {
      return { waMessageId: null, erro: `${resp.status}: ${json?.error?.message ?? 'erro desconhecido'}` };
    }
    return { waMessageId: json?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { waMessageId: null, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Marca a mensagem do cliente como lida e mostra "digitando..." enquanto a
 *  Nina pensa. Best-effort: se a API recusar o typing_indicator, tenta so o
 *  read; qualquer falha e' engolida. */
export async function marcarLidaComDigitando(
  phoneNumberId: string,
  waMessageId: string,
): Promise<void> {
  if (!token()) return;
  const enviar = (body: Record<string, unknown>) =>
    fetch(`https://graph.facebook.com/${versao()}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const base = { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId };
    const r = await enviar({ ...base, typing_indicator: { type: 'text' } });
    if (!r.ok) await enviar(base).catch(() => {});
  } catch {
    // silencioso — so cosmetico
  }
}

/** Busca o numero de exibicao (display_phone_number) de um phone_number_id
 *  na Meta — usado pelo painel pra preencher whatsapp_numero.numero_exibicao. */
export async function buscarNumeroExibicao(phoneNumberId: string): Promise<string | null> {
  if (!token()) return null;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${versao()}/${phoneNumberId}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${token()}` } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { display_phone_number?: string };
    return j.display_phone_number ?? null;
  } catch {
    return null;
  }
}

/** Baixa uma midia recebida (audio, imagem...): GET /{media_id} da o url
 *  temporario, e o download exige o mesmo Bearer. */
export async function baixarMidia(
  mediaId: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!token()) return null;
  try {
    const meta = await fetch(`https://graph.facebook.com/${versao()}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!meta.ok) return null;
    const info = (await meta.json()) as { url?: string; mime_type?: string };
    if (!info.url) return null;
    const arq = await fetch(info.url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!arq.ok) return null;
    const buffer = Buffer.from(await arq.arrayBuffer());
    return { buffer, mime: info.mime_type ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}
