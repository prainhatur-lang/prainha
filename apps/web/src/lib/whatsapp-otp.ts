// Envio de OTP via WhatsApp Cloud API (Meta / Graph API).
//
// Config por env (setar no Vercel quando a WhatsApp Business Account estiver pronta):
//   WHATSAPP_TOKEN        - access token permanente da WABA
//   WHATSAPP_PHONE_ID     - phone number id do numero WhatsApp Business
//   WHATSAPP_OTP_TEMPLATE - nome do template de autenticacao aprovado (ex: "codigo_reserva")
//   WHATSAPP_OTP_LANG     - idioma do template (default "pt_BR")
//   WHATSAPP_API_VERSION  - versao da Graph API (default "v21.0")
//
// Modo teste: se RESERVA_OTP_MODO_TESTE === 'true', NAO envia — retorna { modoTeste:true }
// e o codigo eh devolvido pela API pra testar o fluxo antes da Meta estar configurada.

export interface ResultadoOtp {
  enviado: boolean;
  modoTeste: boolean;
}

export function otpEmModoTeste(): boolean {
  return process.env.RESERVA_OTP_MODO_TESTE === 'true';
}

export function whatsappConfigurado(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_OTP_TEMPLATE);
}

/** Envia o codigo OTP. telefone deve vir so com digitos + DDI (ex: 5579999998888). */
export async function enviarOtpWhatsApp(telefone: string, codigo: string): Promise<ResultadoOtp> {
  if (otpEmModoTeste() || !whatsappConfigurado()) {
    // Sem Meta configurada (ou modo teste): nao envia, sinaliza pra API mostrar o codigo.
    return { enviado: false, modoTeste: true };
  }

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = process.env.WHATSAPP_TOKEN!;
  const template = process.env.WHATSAPP_OTP_TEMPLATE!;
  const lang = process.env.WHATSAPP_OTP_LANG || 'pt_BR';

  // Componentes do template. Por padrao envia template de UTILIDADE (so corpo
  // com {{1}} = codigo). Se WHATSAPP_OTP_BOTAO='true' (template de AUTENTICACAO),
  // inclui tambem o botao copy-code com o codigo.
  const components: unknown[] = [
    { type: 'body', parameters: [{ type: 'text', text: codigo }] },
  ];
  if (process.env.WHATSAPP_OTP_BOTAO === 'true') {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: codigo }] });
  }
  const body = {
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'template',
    template: { name: template, language: { code: lang }, components },
  };

  const resp = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`WhatsApp API ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return { enviado: true, modoTeste: false };
}

/** Convite de cotacao pro fornecedor (WHATSAPP_COTACAO_TEMPLATE — UTILIDADE).
 *  Template sugerido (corpo): "Olá {{1}}! Aqui é do {{2}}. Estamos cotando alguns
 *  itens e queremos o seu melhor preço. Toque no botão abaixo para responder até
 *  {{3}} (prazo de 4h). Obrigado!" + botão URL DINÂMICO "Responder cotação" com
 *  base https://app.prainhabar.com/cotacao/preencher/ e variável {{1}} = token.
 *  Vars na ordem: {{1}} nome, {{2}} filial, {{3}} prazo; botão {{1}} = token. */
export function conviteCotacaoConfigurado(): boolean {
  return !!(
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.WHATSAPP_COTACAO_TEMPLATE
  );
}

export async function enviarConviteCotacao(
  telefone: string,
  vars: { nome: string; filial: string; prazo: string; token: string },
): Promise<boolean> {
  if (!conviteCotacaoConfigurado()) return false;

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = process.env.WHATSAPP_TOKEN!;
  const template = process.env.WHATSAPP_COTACAO_TEMPLATE!;
  const lang = process.env.WHATSAPP_COTACAO_LANG || process.env.WHATSAPP_OTP_LANG || 'pt_BR';

  const resp = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: [
          {
            type: 'body',
            parameters: [vars.nome, vars.filial, vars.prazo].map((t) => ({ type: 'text', text: String(t) })),
          },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: vars.token }] },
        ],
      },
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`WhatsApp API ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return true;
}

/** Template de confirmacao de reserva (WHATSAPP_CONFIRMACAO_TEMPLATE). Envia os
 *  campos na ordem do template de Utilidade: {{1}} nome, {{2}} data, {{3}} hora,
 *  {{4}} espaco/mesa, {{5}} pessoas, {{6}} link de cancelamento.
 *  Best-effort: so envia se WhatsApp + template de confirmacao configurados. */
export async function enviarConfirmacaoReserva(
  telefone: string,
  vars: { nome: string; data: string; hora: string; local: string; pessoas: string; linkCancelar: string },
): Promise<boolean> {
  const template = process.env.WHATSAPP_CONFIRMACAO_TEMPLATE;
  if (!whatsappConfigurado() || !template || otpEmModoTeste()) return false;

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = process.env.WHATSAPP_TOKEN!;
  const lang = process.env.WHATSAPP_OTP_LANG || 'pt_BR';
  const ordem = [vars.nome, vars.data, vars.hora, vars.local, vars.pessoas, vars.linkCancelar];

  const resp = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: [{ type: 'body', parameters: ordem.map((t) => ({ type: 'text', text: String(t) })) }],
      },
    }),
  });
  return resp.ok;
}
