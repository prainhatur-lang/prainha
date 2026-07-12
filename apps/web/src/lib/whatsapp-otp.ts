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
  return !!((process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_OTP_TEMPLATE);
}

/** Envia o codigo OTP. telefone deve vir so com digitos + DDI (ex: 5579999998888). */
export async function enviarOtpWhatsApp(telefone: string, codigo: string): Promise<ResultadoOtp> {
  if (otpEmModoTeste() || !whatsappConfigurado()) {
    // Sem Meta configurada (ou modo teste): nao envia, sinaliza pra API mostrar o codigo.
    return { enviado: false, modoTeste: true };
  }

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
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
 *  Corpo (texto 100% utilidade, sem tom promocional — evita recategorizacao
 *  pra Marketing que a Meta fez na v1 por "queremos o seu melhor preco/Obrigado!").
 *  IMPORTANTE: o corpo NAO pode terminar numa variavel (regra da Meta) — por isso
 *  o {{3}} (prazo) fica no meio e a frase acaba em texto fixo:
 *    "Ola, {{1}}. {{2}} abriu uma solicitacao de cotacao de precos para voce,
 *     fornecedor cadastrado. O prazo para resposta e {{3}}. Acesse o link abaixo
 *     para informar os valores dos itens solicitados."
 *  + botao URL DINAMICO "Responder cotacao" base
 *  https://app.prainhabar.com/cotacao/preencher/ e variavel {{1}} = token.
 *  Vars na ordem (INALTERADAS): {{1}} nome, {{2}} filial, {{3}} prazo; botao {{1}} = token.
 *  Recriar template como UTILIDADE com esse corpo e apontar WHATSAPP_COTACAO_TEMPLATE
 *  pro novo nome (ex.: convite_cotacao_util). Nenhuma mudanca de codigo necessaria. */
export function conviteCotacaoConfigurado(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) &&
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
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
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

/** Lembrete de confirmacao de reserva (vespera ~17h) — WHATSAPP_LEMBRETE_TEMPLATE
 *  (UTILIDADE). Template tem 4 vars no corpo (nome, data, hora, local) + 2 botoes
 *  de RESPOSTA RAPIDA (quick_reply): "Confirmar presenca" e "Cancelar". O cliente
 *  responde DENTRO do WhatsApp (sem abrir site); a resposta chega no webhook
 *  /api/whatsapp/webhook com o payload "confirmar:<token>" / "cancelar:<token>". */
export function lembreteReservaConfigurado(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.WHATSAPP_LEMBRETE_TEMPLATE
  );
}

export async function enviarLembreteReserva(
  telefone: string,
  vars: { nome: string; data: string; hora: string; local: string; token: string },
): Promise<boolean> {
  if (!lembreteReservaConfigurado()) return false;

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
  const template = process.env.WHATSAPP_LEMBRETE_TEMPLATE!;
  const lang = process.env.WHATSAPP_LEMBRETE_LANG || process.env.WHATSAPP_OTP_LANG || 'pt_BR';

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
            parameters: [vars.nome, vars.data, vars.hora, vars.local].map((t) => ({ type: 'text', text: String(t) })),
          },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `confirmar:${vars.token}` }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `cancelar:${vars.token}` }] },
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

/** Envia um texto livre (so funciona dentro da janela de 24h apos o cliente
 *  mandar mensagem — ex.: logo apos ele tocar num botao). Best-effort. */
export async function enviarTextoWhatsApp(telefone: string, texto: string): Promise<boolean> {
  const tokenEnv = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META;
  if (!tokenEnv || !process.env.WHATSAPP_PHONE_ID) return false;
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const resp = await fetch(`https://graph.facebook.com/${ver}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenEnv}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'text',
      text: { body: texto },
    }),
  });
  return resp.ok;
}

/** Envio do PEDIDO de compra pro fornecedor (WHATSAPP_PEDIDO_TEMPLATE — UTILIDADE).
 *  Corpo: {{1}} fornecedor, {{2}} filial, {{3}} numero, {{4}} itens (1 linha,
 *  sem quebra), {{5}} total.
 *  BOTÕES (opcional, igual ao lembrete de reserva): quando o template tem 2
 *  botões de RESPOSTA RÁPIDA (Confirmar / Não consigo) E a env
 *  WHATSAPP_PEDIDO_CONFIRM está ligada, manda os botões com payload
 *  "ped_ok:<pedidoId>" / "ped_nao:<pedidoId>". O fornecedor responde dentro do
 *  zap; o webhook /api/whatsapp/webhook atualiza o pedido pra CONFIRMADO/RECUSADO.
 *  Corpo sugerido do template v2 (NÃO terminar em variável): "Olá {{1}}! Pedido
 *  de compra do {{2}} (nº {{3}}): {{4}}. Total: {{5}}. Você consegue entregar?
 *  Confirme em um dos botões abaixo. Prazo: 4 horas." */
export function pedidoCompraConfigurado(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.WHATSAPP_PEDIDO_TEMPLATE
  );
}

export async function enviarPedidoCompra(
  telefone: string,
  vars: { fornecedor: string; filial: string; numero: string; itens: string; total: string; pedidoId?: string },
): Promise<boolean> {
  if (!pedidoCompraConfigurado()) return false;

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
  const template = process.env.WHATSAPP_PEDIDO_TEMPLATE!;
  const lang = process.env.WHATSAPP_PEDIDO_LANG || process.env.WHATSAPP_OTP_LANG || 'pt_BR';
  // Variaveis de template nao aceitam \n nem >4 espacos seguidos — sanitiza.
  const limpa = (s: string) => s.replace(/\s+/g, ' ').trim();
  const ordem = [vars.fornecedor, vars.filial, vars.numero, vars.itens, vars.total];

  const components: unknown[] = [
    { type: 'body', parameters: ordem.map((t) => ({ type: 'text', text: limpa(String(t)) })) },
  ];
  // Botoes Confirmar / Nao consigo — so quando o template v2 tem os 2 quick_reply
  // e a flag esta ligada (evita quebrar o template antigo sem botao).
  if (process.env.WHATSAPP_PEDIDO_CONFIRM && vars.pedidoId) {
    components.push(
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `ped_ok:${vars.pedidoId}` }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `ped_nao:${vars.pedidoId}` }] },
    );
  }

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
        components,
      },
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`WhatsApp API ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return true;
}

/** Avisa o cliente da LISTA DE ESPERA que a mesa ficou pronta
 *  (WHATSAPP_ESPERA_TEMPLATE — UTILIDADE). Corpo: {{1}} nome, {{2}} filial.
 *  Corpo sugerido (NAO terminar em variavel): "Olá {{1}}! Sua mesa no {{2}} já
 *  está pronta. Procure a recepção, por favor. Te esperamos!" Best-effort. */
export function mesaProntaConfigurado(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.WHATSAPP_ESPERA_TEMPLATE
  );
}

export async function enviarMesaPronta(
  telefone: string,
  vars: { nome: string; filial: string },
): Promise<boolean> {
  if (!mesaProntaConfigurado()) return false;
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
  const template = process.env.WHATSAPP_ESPERA_TEMPLATE!;
  const lang = process.env.WHATSAPP_ESPERA_LANG || process.env.WHATSAPP_OTP_LANG || 'pt_BR';
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
          { type: 'body', parameters: [vars.nome, vars.filial].map((t) => ({ type: 'text', text: String(t) })) },
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

/** Avisa o cliente de uma MUDANÇA na reserva feita pela recepção — troca de
 *  mesa, no-show ou cancelamento (WHATSAPP_ATUALIZACAO_TEMPLATE — UTILIDADE).
 *  Corpo: {{1}} nome, {{2}} mensagem (frase já pronta, varia por tipo de
 *  mudança — o template não muda, só o texto da variável).
 *  Corpo sugerido do template (NÃO terminar em variável): "Olá {{1}}! {{2}}
 *  Qualquer dúvida, é só chamar a gente por aqui." Best-effort. */
export function atualizacaoReservaConfigurada(): boolean {
  return !!(
    (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META) &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.WHATSAPP_ATUALIZACAO_TEMPLATE
  );
}

export async function enviarAtualizacaoReserva(
  telefone: string,
  vars: { nome: string; mensagem: string },
): Promise<boolean> {
  if (!atualizacaoReservaConfigurada()) return false;
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
  const template = process.env.WHATSAPP_ATUALIZACAO_TEMPLATE!;
  const lang = process.env.WHATSAPP_ATUALIZACAO_LANG || process.env.WHATSAPP_OTP_LANG || 'pt_BR';
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
          { type: 'body', parameters: [vars.nome, vars.mensagem].map((t) => ({ type: 'text', text: String(t) })) },
        ],
      },
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error(`WhatsApp atualizacao erro ${resp.status}: ${txt.slice(0, 300)}`);
    return false;
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
  // Gate proprio (token + phone + template de confirmacao). NAO depende do
  // WHATSAPP_OTP_TEMPLATE (resquicio do OTP, que foi pro Twilio e nunca foi setado).
  const tokenEnv = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META;
  if (!tokenEnv || !process.env.WHATSAPP_PHONE_ID || !template || otpEmModoTeste()) return false;

  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID!;
  const token = (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META)!;
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
