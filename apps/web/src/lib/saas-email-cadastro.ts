// E-mail de quem se cadastra no /conheca (05/11/2026): com a loja já criada
// manda endereço, login, senha provisória e código da empresa; sem ela (loja
// preparada pelo time) confirma o cadastro e diz que o time chama no WhatsApp.
// O resultado fica anotado em saas_conta.observacao.

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { enviarEmail, esc, type ResultadoEmail } from '@/lib/email';
import type { AcessoSaas } from '@/lib/saas-provisao';

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,Helvetica,sans-serif;color:#1b2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0f2a33;color:#ffffff;padding:18px 24px;font-size:20px;font-weight:bold">Concilia</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${titulo}</h1>
${corpo}
</td></tr>
<tr><td style="padding:14px 24px;background:#f4f7f8;color:#5a6878;font-size:12px">Você recebeu este e-mail porque criou uma conta de teste no Concilia.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function enviarEmailCadastro(p: {
  contaId: string | null;
  email: string;
  responsavel: string;
  nomeFantasia: string;
  whatsapp: string;
  testeFim: string;
  acesso: AcessoSaas | null;
}): Promise<ResultadoEmail> {
  const nome = esc(p.responsavel.split(' ')[0] || p.responsavel);
  const loja = esc(p.nomeFantasia);
  const fim = p.testeFim.split('-').reverse().join('/');
  const a = p.acesso;

  let assunto: string;
  let html: string;
  let texto: string;
  if (a) {
    assunto = `Seu acesso ao Concilia — ${p.nomeFantasia}`;
    const linhas = [
      `Endereço: <b>${esc(a.loginUrl)}</b>`,
      `E-mail: <b>${esc(a.email)}</b>`,
      a.senhaProvisoria
        ? `Senha provisória: <b style="font-family:monospace;font-size:16px">${esc(a.senhaProvisoria)}</b>`
        : 'Senha: a mesma que você já usa no Concilia.',
      ...(a.codigoEmpresa ? [`Código da empresa (app da maquininha): <b>${esc(a.codigoEmpresa)}</b>`] : []),
    ];
    html = moldura(
      `Conta criada, ${nome}!`,
      `<p style="margin:0 0 12px;line-height:1.5">A loja <b>${loja}</b> já está pronta, com <b>todos os módulos</b> até <b>${fim}</b>, sem pagar nada.</p>
<div style="border:1px solid #cfe3e5;border-radius:8px;padding:14px;line-height:1.8;font-size:14px">${linhas.join('<br>')}</div>
<p style="margin:12px 0;font-size:13px;color:#5a6878">No primeiro acesso o sistema pede pra você trocar a senha.</p>
<p style="margin:18px 0 0"><a href="${esc(a.loginUrl)}" style="display:inline-block;background:#f2b134;color:#1b2430;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Entrar na minha loja</a></p>`,
    );
    texto = [
      `Conta criada, ${p.responsavel.split(' ')[0]}!`,
      `A loja ${p.nomeFantasia} já está pronta, com todos os módulos até ${fim}.`,
      `Endereço: ${a.loginUrl}`,
      `E-mail: ${a.email}`,
      a.senhaProvisoria ? `Senha provisória: ${a.senhaProvisoria}` : 'Senha: a mesma que você já usa no Concilia.',
      ...(a.codigoEmpresa ? [`Código da empresa: ${a.codigoEmpresa}`] : []),
      'No primeiro acesso o sistema pede pra você trocar a senha.',
    ].join('\n');
  } else {
    assunto = `Recebemos o cadastro do ${p.nomeFantasia} no Concilia`;
    html = moldura(
      `Cadastro recebido, ${nome}!`,
      `<p style="margin:0 0 12px;line-height:1.5">Seu teste com <b>todos os módulos</b> vai até <b>${fim}</b>, sem pagar nada.</p>
<p style="margin:0 0 12px;line-height:1.5">A loja <b>${loja}</b> está sendo preparada. Nossa equipe chama você no WhatsApp <b>${esc(p.whatsapp)}</b> pra entregar o acesso e ajudar a começar.</p>
<p style="margin:0;line-height:1.5">No fim do teste, se quiser continuar, a mensalidade é paga por Pix. Se não quiser, não precisa fazer nada.</p>`,
    );
    texto = [
      `Cadastro recebido, ${p.responsavel.split(' ')[0]}!`,
      `Seu teste com todos os módulos vai até ${fim}.`,
      `A loja ${p.nomeFantasia} está sendo preparada. Nossa equipe chama você no WhatsApp ${p.whatsapp} pra entregar o acesso.`,
    ].join('\n');
  }

  const r = await enviarEmail({ para: p.email, assunto, html, texto });
  if (p.contaId && r.motivo !== 'desligado') {
    const nota = r.ok
      ? `E-mail ${a ? 'de acesso' : 'de cadastro'} enviado em ${new Date().toISOString()} (${r.id ?? ''})`
      : `E-mail não saiu: ${r.motivo}`;
    await db
      .update(schema.saasConta)
      .set({ observacao: sql`concat_ws(E'\n', ${schema.saasConta.observacao}, ${nota}::text)` })
      .where(eq(schema.saasConta.id, p.contaId))
      .catch(() => {});
  }
  return r;
}
