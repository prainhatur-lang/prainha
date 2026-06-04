// OTP via Twilio Verify — alternativa ao WhatsApp Cloud API (Meta), sem template
// nem WABA. O Twilio gera, envia e valida o codigo (canal SMS ou WhatsApp).
//
// Config por env (Vercel):
//   TWILIO_ACCOUNT_SID       - SID da conta Twilio
//   TWILIO_AUTH_TOKEN        - auth token
//   TWILIO_VERIFY_SERVICE_SID- SID do Verify Service (VAxxxx)
//   TWILIO_OTP_CHANNEL       - "sms" (default) | "whatsapp"
//
// Quando essas envs existem, a reserva publica usa o Twilio em vez do WhatsApp/Meta.

export function twilioConfigurado(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function auth(): string {
  return 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
}

function e164(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  return '+' + d;
}

/** Dispara o envio do codigo (Twilio gera e envia). Throw em falha. */
export async function twilioStart(telefone: string): Promise<void> {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const canal = (process.env.TWILIO_OTP_CHANNEL || 'sms').toLowerCase();
  const body = new URLSearchParams({ To: e164(telefone), Channel: canal });
  const r = await fetch(`https://verify.twilio.com/v2/Services/${sid}/Verifications`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Twilio start ${r.status}: ${t.slice(0, 300)}`);
  }
}

/** Confere o codigo. Retorna true se aprovado. */
export async function twilioCheck(telefone: string, codigo: string): Promise<boolean> {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const body = new URLSearchParams({ To: e164(telefone), Code: codigo });
  const r = await fetch(`https://verify.twilio.com/v2/Services/${sid}/VerificationCheck`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) return false;
  const d = (await r.json().catch(() => ({}))) as { status?: string };
  return d.status === 'approved';
}
