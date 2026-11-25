// Rescisão PAGA → e-mail pro contador dar baixa no eSocial (dono 25/11/2026:
// "quando for feito o pagamento da rescisão do funcionário, enviar uma
// mensagem para o contador informando para dar baixa no e-social").
//
// "Paga" = a conta que paga a PESSOA está quitada: a conta ligada ao termo na
// ficha (funcionario_documento.conta_pagar_id) ou, no empregado da E.B., a
// conta da E.B. (conta_pagar_empregador_id — o repasse casa → E.B. não conta).
// Vale qualquer forma de pagamento (Pix pelo Inter, dinheiro, baixa manual).
// Um aviso por termo, uma vez só (rescisao_aviso_esocial); o cron de 5 min
// (pix-sistema-conferir) varre e tenta de novo o que falhou. Vai pros mesmos
// e-mails do comprovante (quem tem imposto.enviar + CONTADOR_EMAIL).

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { emailLigado, enviarEmail, esc } from '@/lib/email';
import { brl, formatDate } from '@/lib/format';
import { emailsDoContador } from '@/lib/comprovante-contador';
import { linkComprovanteBaixa } from '@/lib/comprovante-contador-baixa';

/** Só rescisão cujo pagamento foi registrado a partir deste dia (as antigas não avisam). */
const DESDE = '2026-11-25';
const MAX_TENTATIVAS = 5;

interface DadosAviso {
  documentoId: string;
  nome: string;
  cpf: string | null;
  empresa: string | null;
  cnpj: string | null;
  casaLotacao: string | null;
  dataAfastamento: string | null;
  causa: string | null;
  valor: number;
  dataPagamento: string;
  ultimaBaixaId: string | null;
}

const cpfFmt = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : null;
};
const cnpjFmt = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : null;
};

async function dadosDoAviso(documentoId: string): Promise<DadosAviso | null> {
  const rows = (await db.execute(sql`
    SELECT d.id, fu.nome, fu.cpf, fe.nome AS empresa, fe.cnpj, fl.nome AS casa_lotacao,
           d.dados->>'dataAfastamento' AS data_afastamento, d.dados->>'causa' AS causa,
           c.valor::text AS valor, c.data_pagamento::text AS data_pagamento,
           (SELECT b.id::text FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id ORDER BY b.criado_em DESC LIMIT 1) AS ultima_baixa_id,
           (SELECT max(b.data)::text FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id) AS data_baixa
      FROM funcionario_documento d
      JOIN funcionario fu ON fu.id = d.funcionario_id
      JOIN conta_pagar c ON c.id = coalesce(d.conta_pagar_empregador_id, d.conta_pagar_id)
      LEFT JOIN filial fe ON fe.id = c.filial_id
      LEFT JOIN filial fl ON fl.id = d.filial_id
     WHERE d.id = ${documentoId}::uuid
  `)) as unknown as Array<{
    id: string;
    nome: string;
    cpf: string | null;
    empresa: string | null;
    cnpj: string | null;
    casa_lotacao: string | null;
    data_afastamento: string | null;
    causa: string | null;
    valor: string;
    data_pagamento: string | null;
    ultima_baixa_id: string | null;
    data_baixa: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  const dataPagamento = r.data_pagamento ?? r.data_baixa;
  if (!dataPagamento) return null;
  return {
    documentoId: r.id,
    nome: r.nome,
    cpf: r.cpf,
    empresa: r.empresa,
    cnpj: r.cnpj,
    casaLotacao: r.casa_lotacao,
    dataAfastamento: /^\d{4}-\d{2}-\d{2}$/.test(r.data_afastamento ?? '') ? r.data_afastamento : null,
    causa: r.causa,
    valor: Number(r.valor),
    dataPagamento,
    ultimaBaixaId: r.ultima_baixa_id,
  };
}

function htmlEmail(d: DadosAviso, link: string | null): string {
  const cpf = cpfFmt(d.cpf);
  const cnpj = cnpjFmt(d.cnpj);
  const linhas: Array<[string, string]> = [
    ['Funcionário', d.nome],
    ...(cpf ? [['CPF', cpf] as [string, string]] : []),
    ['Empresa (empregador)', `${d.empresa ?? '—'}${cnpj ? ` — CNPJ ${cnpj}` : ''}`],
    ...(d.casaLotacao && d.casaLotacao !== d.empresa ? [['Casa onde trabalhava', d.casaLotacao] as [string, string]] : []),
    ...(d.dataAfastamento ? [['Data do desligamento', formatDate(d.dataAfastamento)] as [string, string]] : []),
    ...(d.causa ? [['Causa', d.causa] as [string, string]] : []),
    ['Valor líquido pago', brl(d.valor)],
    ['Data do pagamento', formatDate(d.dataPagamento)],
  ];
  const tr = linhas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#0f172a">${esc(v)}</td></tr>`,
    )
    .join('');
  const botao = link
    ? `<a href="${esc(link)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Abrir comprovante do pagamento</a>`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:640px">
<p style="margin:0 0 4px;color:#ea580c;font-size:12px;font-weight:700;text-transform:uppercase">Rescisão paga — dar baixa no eSocial</p>
<h2 style="margin:0 0 12px;color:#0f172a">${esc(d.nome)}</h2>
<p style="margin:0 0 12px;color:#0f172a">A rescisão deste funcionário foi <b>paga</b>. Por favor, <b>dar baixa no eSocial</b> (enviar o desligamento).</p>
<table style="border-collapse:collapse;font-size:14px">${tr}</table>
<div style="margin-top:16px">${botao}</div>
<p style="margin-top:16px;color:#64748b;font-size:12px">Enviado automaticamente pelo sistema do Prainha quando o pagamento da rescisão é registrado.</p>
</div>`;
}

/** Manda o aviso deste termo, se ainda não mandou. Nunca lança erro. */
export async function avisarContadorRescisaoPaga(documentoId: string): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    if (!emailLigado()) return { enviado: false, motivo: 'e-mail desligado' };
    // pega a vez (uma vez só, mesmo com dois envios ao mesmo tempo)
    const pego = (await db.execute(sql`
      INSERT INTO rescisao_aviso_esocial (documento_id, filial_id, conta_pagar_id, enviado_em, tentativas)
      SELECT d.id, d.filial_id, coalesce(d.conta_pagar_empregador_id, d.conta_pagar_id), now(), 1
        FROM funcionario_documento d
       WHERE d.id = ${documentoId}::uuid
      ON CONFLICT (documento_id) DO UPDATE
         SET enviado_em = now(), tentativas = rescisao_aviso_esocial.tentativas + 1, atualizado_em = now()
       WHERE rescisao_aviso_esocial.enviado_em IS NULL
         AND rescisao_aviso_esocial.tentativas < ${MAX_TENTATIVAS}
      RETURNING tentativas
    `)) as unknown as Array<{ tentativas: number }>;
    if (pego.length === 0) return { enviado: false, motivo: 'já enviado' };

    const falhou = async (motivo: string) => {
      await db.execute(sql`
        UPDATE rescisao_aviso_esocial SET enviado_em = NULL, erro = ${motivo}, atualizado_em = now()
         WHERE documento_id = ${documentoId}::uuid
      `);
      return { enviado: false, motivo };
    };

    const para = await emailsDoContador();
    if (para.length === 0) return falhou('nenhum e-mail do contador (permissão imposto.enviar)');
    const d = await dadosDoAviso(documentoId);
    if (!d) return falhou('rescisão sem pagamento registrado');

    const link = d.ultimaBaixaId ? linkComprovanteBaixa(d.ultimaBaixaId) : null;
    const assunto = `Rescisão paga — dar baixa no eSocial — ${d.nome}${d.empresa ? ` (${d.empresa})` : ''}`.slice(0, 200);
    const html = htmlEmail(d, link);
    const erros: string[] = [];
    for (const e of para) {
      const r = await enviarEmail({ para: e, assunto, html });
      if (!r.ok) erros.push(`${e}: ${r.motivo ?? 'falhou'}`);
    }
    if (erros.length === para.length) return falhou(erros.join('; '));
    await db.execute(sql`
      UPDATE rescisao_aviso_esocial
         SET para = ${para.join(', ')}, erro = ${erros.length ? erros.join('; ') : null}, atualizado_em = now()
       WHERE documento_id = ${documentoId}::uuid
    `);
    return { enviado: true };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn('[rescisao-aviso-esocial]', documentoId, motivo);
    await db
      .execute(sql`UPDATE rescisao_aviso_esocial SET enviado_em = NULL, erro = ${motivo}, atualizado_em = now() WHERE documento_id = ${documentoId}::uuid`)
      .catch(() => null);
    return { enviado: false, motivo };
  }
}

/**
 * Termos de rescisão cuja conta (a que paga a pessoa) está quitada, com baixa
 * registrada desde DESDE, e que ainda não avisaram o contador.
 */
export async function avisarRescisoesPagasPendentes(limiteMs = 8_000, limite = 5): Promise<{ enviados: number; tentados: number }> {
  if (!emailLigado()) return { enviados: 0, tentados: 0 };
  const fim = Date.now() + limiteMs;
  const rows = (await db.execute(sql`
    SELECT d.id
      FROM funcionario_documento d
      JOIN conta_pagar c ON c.id = coalesce(d.conta_pagar_empregador_id, d.conta_pagar_id)
      LEFT JOIN rescisao_aviso_esocial k ON k.documento_id = d.id
     WHERE d.cancelado_em IS NULL
       AND (k.documento_id IS NULL
            OR (k.enviado_em IS NULL AND k.tentativas < ${MAX_TENTATIVAS} AND k.atualizado_em < now() - interval '10 minutes'))
       AND (SELECT coalesce(sum(b.valor), 0) FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id) >= c.valor - 0.01
       AND EXISTS (SELECT 1 FROM conta_pagar_baixa b WHERE b.conta_pagar_id = c.id AND b.criado_em >= ${DESDE}::date)
     ORDER BY d.criado_em
     LIMIT ${limite}
  `)) as unknown as Array<{ id: string }>;
  let enviados = 0;
  let tentados = 0;
  for (const r of rows) {
    if (Date.now() > fim) break;
    tentados += 1;
    if ((await avisarContadorRescisaoPaga(r.id)).enviado) enviados += 1;
  }
  return { enviados, tentados };
}
