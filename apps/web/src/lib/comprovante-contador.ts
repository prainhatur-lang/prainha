// Comprovante de pagamento pro CONTADOR (dono 23/11/2026: "mandar os
// comprovantes para o contador. Sempre que for fazer um pagamento, mandar o
// comprovante para o contador").
//
// Cada pagamento da tela /financeiro/pagar-conta (guias, energia, água, boleto
// fora do DDA, Pix copia-e-cola) que vira PAGO manda um e-mail (Resend) pra
// contabilidade — quem tem a permissão 'imposto.enviar' (o login do contador),
// mais CONTADOR_EMAIL se existir. O e-mail traz os dados do banco e o link do
// comprovante (/comprovante-pagamento/<id>.<assinatura>, sem login) e o da guia.
// Uma vez só por pagamento (comprovante_contador_em); se o e-mail falhar, a
// próxima conferência da tela tenta de novo.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { emailLigado, enviarEmail, esc } from '@/lib/email';
import { brl, formatDate } from '@/lib/format';
import { montarComprovanteInter, type ComprovanteInter } from '@/lib/comprovante-inter';
import { urlGuia } from '@/lib/impostos/guia';

/** Pagamentos a partir daqui entram no envio (o dia em que o dono pediu). */
const DESDE = '2026-11-23';
const UUID = /^[0-9a-f-]{36}$/i;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.prainhabar.com';

function assinatura(id: string): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update(['comprovante-pagamento', id].join('|')).digest('hex').slice(0, 32);
}

export function linkComprovantePagamento(id: string): string | null {
  const s = assinatura(id);
  return s ? `${BASE_URL}/comprovante-pagamento/${id}.${s}` : null;
}

/** id do pagamento (conta_consumo_pagamento) ou null se a assinatura é falsa. */
export function validarTokenComprovante(t: unknown): string | null {
  const [id, s] = String(t ?? '').split('.');
  if (!id || !s || !UUID.test(id)) return null;
  const esperada = assinatura(id);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(s, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

/** E-mails da contabilidade: logins com 'imposto.enviar' + CONTADOR_EMAIL. */
export async function emailsDoContador(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT lower(u.email) AS email
      FROM usuario_grupo ug
      JOIN grupo_permissao gp ON gp.grupo_id = ug.grupo_id
      JOIN permissao p ON p.id = gp.permissao_id AND p.codigo = 'imposto.enviar'
      JOIN auth.users u ON u.id = ug.usuario_id
     WHERE u.email IS NOT NULL
  `)) as unknown as Array<{ email: string }>;
  const extra = (process.env.CONTADOR_EMAIL ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  return [...new Set([...rows.map((r) => r.email), ...extra])];
}

export interface DadosComprovantePagamento {
  id: string;
  tipo: string;
  valor: number;
  status: string;
  descricao: string | null;
  favorecido: string | null;
  codigo: string;
  dataPagamento: string | null;
  casa: string | null;
  contaPagarId: string | null;
  contaDescricao: string | null;
  fornecedorNome: string | null;
  guiaUrl: string | null;
  comp: ComprovanteInter | null;
}

/** Junta tudo do pagamento: a linha, a conta, a baixa e o comprovante do Inter. */
export async function dadosComprovantePagamento(id: string): Promise<DadosComprovantePagamento | null> {
  const rows = (await db.execute(sql`
    SELECT p.id, p.tipo, p.valor::text AS valor, p.status, p.descricao, p.favorecido, p.codigo,
           p.data_pagamento::text AS data_pagamento, p.conta_pagar_id, p.codigo_inter,
           f.nome AS casa, c.descricao AS conta_descricao, c.boleto_storage_path, fo.nome AS fornecedor_nome
      FROM conta_consumo_pagamento p
      LEFT JOIN filial f ON f.id = p.filial_id
      LEFT JOIN conta_pagar c ON c.id = p.conta_pagar_id
      LEFT JOIN fornecedor fo ON fo.id = c.fornecedor_id
     WHERE p.id = ${id}::uuid
  `)) as unknown as Array<{
    id: string;
    tipo: string;
    valor: string;
    status: string;
    descricao: string | null;
    favorecido: string | null;
    codigo: string;
    data_pagamento: string | null;
    conta_pagar_id: string | null;
    codigo_inter: string | null;
    casa: string | null;
    conta_descricao: string | null;
    boleto_storage_path: string | null;
    fornecedor_nome: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;

  let comp: ComprovanteInter | null = null;
  let dataBaixa: string | null = null;
  if (r.conta_pagar_id) {
    const observacao =
      r.tipo === 'BOLETO'
        ? `Boleto pago no Inter (${r.codigo_inter ?? id})`
        : `Pix copia-e-cola pago pelo sistema (Inter)${r.codigo_inter ? ` cód ${r.codigo_inter}` : ''}`;
    const [b] = await db
      .select({
        id: schema.contaPagarBaixa.id,
        data: sql<string>`${schema.contaPagarBaixa.data}::text`,
        valor: schema.contaPagarBaixa.valor,
        observacao: schema.contaPagarBaixa.observacao,
        lancamentoBancoId: schema.contaPagarBaixa.lancamentoBancoId,
      })
      .from(schema.contaPagarBaixa)
      .where(and(eq(schema.contaPagarBaixa.contaPagarId, r.conta_pagar_id), eq(schema.contaPagarBaixa.observacao, observacao)))
      .limit(1);
    if (b) {
      dataBaixa = b.data;
      if (r.tipo === 'BOLETO') {
        comp = await montarComprovanteInter(r.conta_pagar_id, b, 'BOLETO').catch(() => null);
      }
    }
  }

  const path = r.boleto_storage_path;
  return {
    id: r.id,
    tipo: r.tipo,
    valor: Number(r.valor),
    status: r.status,
    descricao: r.descricao,
    favorecido: r.favorecido,
    codigo: r.codigo,
    dataPagamento: comp?.data ?? r.data_pagamento ?? dataBaixa,
    casa: r.casa,
    contaPagarId: r.conta_pagar_id,
    contaDescricao: r.conta_descricao,
    fornecedorNome: r.fornecedor_nome,
    guiaUrl: path && !/^https?:/i.test(path) ? urlGuia(path) : path,
    comp,
  };
}

function htmlEmail(d: DadosComprovantePagamento, link: string | null): string {
  const linhas: Array<[string, string]> = [
    ['Empresa / casa', d.casa ?? '—'],
    ['Pagamento', d.descricao ?? d.contaDescricao ?? '—'],
    ...(d.favorecido || d.fornecedorNome ? [['Favorecido', (d.favorecido || d.fornecedorNome)!] as [string, string]] : []),
    ['Valor', brl(d.comp?.valor ?? d.valor)],
    ['Data do pagamento', d.dataPagamento ? formatDate(d.dataPagamento) : '—'],
    ['Forma', d.tipo === 'BOLETO' ? 'Código de barras (Banco Inter)' : 'Pix copia-e-cola (Banco Inter)'],
    ...(d.comp?.campos ?? []),
  ];
  if (d.tipo === 'BOLETO') linhas.push(['Código de barras', d.codigo]);
  const tr = linhas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#0f172a;word-break:break-all">${esc(v)}</td></tr>`,
    )
    .join('');
  const botoes = [
    link ? `<a href="${esc(link)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Abrir comprovante</a>` : '',
    d.guiaUrl ? `<a href="${esc(d.guiaUrl)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;border:1px solid #cbd5e1;color:#334155;border-radius:6px;text-decoration:none;font-weight:600">Guia / boleto (PDF)</a>` : '',
  ].join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:640px">
<p style="margin:0 0 4px;color:#ea580c;font-size:12px;font-weight:700;text-transform:uppercase">Comprovante de pagamento</p>
<h2 style="margin:0 0 12px;color:#0f172a">${esc(d.descricao ?? d.contaDescricao ?? 'Pagamento')} — ${esc(brl(d.comp?.valor ?? d.valor))}</h2>
<table style="border-collapse:collapse;font-size:14px">${tr}</table>
<div style="margin-top:16px">${botoes}</div>
<p style="margin-top:16px;color:#64748b;font-size:12px">Enviado automaticamente pelo sistema do Prainha a cada pagamento feito pelo Inter. Dados lidos da API do Banco Inter.</p>
</div>`;
}

/**
 * Manda o comprovante deste pagamento pro contador, se ainda não mandou.
 * Melhor esforço: nunca lança erro pra quem chamou.
 */
export async function enviarComprovanteContador(id: string): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    if (!emailLigado()) return { enviado: false, motivo: 'e-mail desligado' };
    // pega a vez (uma vez só, mesmo com duas conferências ao mesmo tempo)
    const pego = (await db.execute(sql`
      UPDATE conta_consumo_pagamento SET comprovante_contador_em = now()
       WHERE id = ${id}::uuid AND status = 'PAGO' AND comprovante_contador_em IS NULL
         AND criado_em >= ${DESDE}::date
       RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (pego.length === 0) return { enviado: false, motivo: 'já enviado ou não pago' };

    const falhou = async (motivo: string) => {
      await db.execute(sql`
        UPDATE conta_consumo_pagamento SET comprovante_contador_em = NULL, comprovante_contador_erro = ${motivo}
         WHERE id = ${id}::uuid
      `);
      return { enviado: false, motivo };
    };

    const para = await emailsDoContador();
    if (para.length === 0) return falhou('nenhum e-mail do contador (permissão imposto.enviar)');
    const d = await dadosComprovantePagamento(id);
    if (!d) return falhou('pagamento não encontrado');
    const link = linkComprovantePagamento(id);
    const assunto = `Comprovante — ${d.casa ? `${d.casa} — ` : ''}${d.descricao ?? d.contaDescricao ?? 'pagamento'} — ${brl(d.comp?.valor ?? d.valor)}`.slice(0, 200);
    const html = htmlEmail(d, link);
    const erros: string[] = [];
    for (const e of para) {
      const r = await enviarEmail({ para: e, assunto, html });
      if (!r.ok) erros.push(`${e}: ${r.motivo ?? 'falhou'}`);
    }
    if (erros.length === para.length) return falhou(erros.join('; '));
    await db.execute(sql`
      UPDATE conta_consumo_pagamento
         SET comprovante_contador_para = ${para.join(', ')}, comprovante_contador_erro = ${erros.length ? erros.join('; ') : null}
       WHERE id = ${id}::uuid
    `);
    return { enviado: true };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn('[comprovante-contador]', id, motivo);
    await db
      .execute(sql`UPDATE conta_consumo_pagamento SET comprovante_contador_em = NULL, comprovante_contador_erro = ${motivo} WHERE id = ${id}::uuid`)
      .catch(() => null);
    return { enviado: false, motivo };
  }
}

/** Os pagos desta casa que ainda não foram pro contador (os de antes do envio e os que falharam). */
export async function enviarComprovantesPendentes(filialId: string, limite = 5): Promise<number> {
  if (!emailLigado()) return 0;
  const rows = (await db.execute(sql`
    SELECT id FROM conta_consumo_pagamento
     WHERE filial_id = ${filialId}::uuid AND status = 'PAGO' AND comprovante_contador_em IS NULL
       AND criado_em >= ${DESDE}::date
     ORDER BY criado_em
     LIMIT ${limite}
  `)) as unknown as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) if ((await enviarComprovanteContador(r.id)).enviado) n += 1;
  return n;
}
