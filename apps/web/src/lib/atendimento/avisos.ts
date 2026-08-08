// Aviso pra equipe no WhatsApp (transferencia ou lead novo) via template
// UTILIDADE `WHATSAPP_AVISO_TEMPLATE` — 4 vars: {{1}} motivo, {{2}} nome do
// cliente, {{3}} telefone, {{4}} filial. Enquanto o template nao existir/
// aprovar na Meta, vira no-op silencioso (o painel continua destacando a
// conversa pendente — nada quebra).

export function avisoEquipeConfigurado(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.WHATSAPP_AVISO_TEMPLATE
  );
}

export async function avisarEquipe(
  numerosEquipe: string[],
  vars: { motivo: string; nomeCliente: string; telefone: string; filial: string },
): Promise<void> {
  if (!avisoEquipeConfigurado() || numerosEquipe.length === 0) return;
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
  const template = process.env.WHATSAPP_AVISO_TEMPLATE!;
  const lang = process.env.WHATSAPP_AVISO_LANG || process.env.WHATSAPP_OTP_LANG || 'pt_BR';
  const limpa = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200) || '-';
  const ordem = [vars.motivo, vars.nomeCliente, vars.telefone, vars.filial];

  await Promise.all(
    numerosEquipe.map((para) =>
      fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: para,
          type: 'template',
          template: {
            name: template,
            language: { code: lang },
            components: [
              { type: 'body', parameters: ordem.map((t) => ({ type: 'text', text: limpa(t) })) },
            ],
          },
        }),
      }).catch(() => {}),
    ),
  );
}
