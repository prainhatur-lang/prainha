// Comprovante pro CONTADOR de todo pagamento do Inter que dá baixa em conta a
// pagar, fora da tela Pagar conta (essa tem o seu em comprovante-contador.ts):
//   · Pix por chave enviado pelo sistema (pix_pagamento — folha, fornecedor…)
//   · boleto do DDA pago no Inter (baixa automática)
//   · Pix casado com o extrato do Inter
// Dono 23/11/2026 ("sempre que for fazer um pagamento, mandar o comprovante
// para o contador" → "sim, todos"). Um e-mail por baixa, uma vez só
// (comprovante_contador_baixa); o cron de 5 min (pix-sistema-conferir) varre
// as baixas novas e tenta de novo as que falharam.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { emailLigado, enviarEmail, esc } from '@/lib/email';
import { brl, formatDate } from '@/lib/format';
import { montarComprovanteInter, origemInterDasBaixas, type ComprovanteInter, type TipoComprovanteInter } from '@/lib/comprovante-inter';
import { emailsDoContador } from '@/lib/comprovante-contador';

const DESDE = '2026-11-23';
const MAX_TENTATIVAS = 5;
const UUID = /^[0-9a-f-]{36}$/i;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.prainhabar.com';

function assinatura(id: string): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update(['comprovante-baixa', id].join('|')).digest('hex').slice(0, 32);
}

export function linkComprovanteBaixa(baixaId: string): string | null {
  const s = assinatura(baixaId);
  return s ? `${BASE_URL}/comprovante-pagamento/baixa-${baixaId}.${s}` : null;
}

/** "baixa-<id>.<assinatura>" → id da baixa, ou null. */
export function validarTokenBaixa(t: unknown): string | null {
  const m = /^baixa-([0-9a-f-]{36})\.([0-9a-f]+)$/i.exec(String(t ?? ''));
  if (!m || !UUID.test(m[1]!)) return null;
  const esperada = assinatura(m[1]!);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(m[2]!, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return m[1]!;
}

export interface DadosComprovanteBaixa {
  baixaId: string;
  contaPagarId: string;
  casa: string | null;
  contaDescricao: string | null;
  fornecedorNome: string | null;
  dataBaixa: string;
  valor: number;
  tipo: TipoComprovanteInter;
  comp: ComprovanteInter;
}

const FORMA: Record<TipoComprovanteInter, string> = {
  PIX_SISTEMA: 'Pix enviado pelo sistema (Banco Inter)',
  PIX_EXTRATO: 'Pix / transferência (extrato do Banco Inter)',
  BOLETO: 'Boleto pago no Banco Inter',
};
export const formaDoTipo = (t: TipoComprovanteInter) => FORMA[t];

/** Baixa + conta + comprovante montado com os dados do Inter (null se não é do Inter). */
export async function dadosComprovanteBaixa(baixaId: string): Promise<DadosComprovanteBaixa | null> {
  const rows = (await db.execute(sql`
    SELECT b.id, b.conta_pagar_id, b.data::text AS data, b.valor::text AS valor, b.observacao,
           b.lancamento_banco_id, f.nome AS casa, c.descricao AS conta_descricao, fo.nome AS fornecedor_nome
      FROM conta_pagar_baixa b
      JOIN conta_pagar c ON c.id = b.conta_pagar_id
      LEFT JOIN filial f ON f.id = c.filial_id
      LEFT JOIN fornecedor fo ON fo.id = c.fornecedor_id
     WHERE b.id = ${baixaId}::uuid
  `)) as unknown as Array<{
    id: string;
    conta_pagar_id: string;
    data: string;
    valor: string;
    observacao: string | null;
    lancamento_banco_id: string | null;
    casa: string | null;
    conta_descricao: string | null;
    fornecedor_nome: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  const baixa = { id: r.id, observacao: r.observacao, lancamentoBancoId: r.lancamento_banco_id, data: r.data, valor: r.valor };
  const tipo = (await origemInterDasBaixas([baixa])).get(r.id);
  if (!tipo) return null;
  const comp = await montarComprovanteInter(r.conta_pagar_id, baixa, tipo);
  return {
    baixaId: r.id,
    contaPagarId: r.conta_pagar_id,
    casa: r.casa,
    contaDescricao: r.conta_descricao,
    fornecedorNome: r.fornecedor_nome,
    dataBaixa: r.data,
    valor: Number(r.valor),
    tipo,
    comp,
  };
}

function htmlEmail(d: DadosComprovanteBaixa, link: string | null): string {
  const linhas: Array<[string, string]> = [
    ['Empresa / casa', d.casa ?? '—'],
    ['Conta a pagar', d.contaDescricao ?? '—'],
    ...(d.fornecedorNome ? [['Fornecedor', d.fornecedorNome] as [string, string]] : []),
    ['Valor', brl(d.comp.valor ?? d.valor)],
    ['Data do pagamento', formatDate(d.comp.data ?? d.dataBaixa)],
    ['Forma', FORMA[d.tipo]],
    ...d.comp.campos,
  ];
  const tr = linhas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#0f172a;word-break:break-all">${esc(v)}</td></tr>`,
    )
    .join('');
  const botao = link
    ? `<a href="${esc(link)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Abrir comprovante</a>`
    : '';
  const titulo = d.fornecedorNome ?? d.contaDescricao ?? 'Pagamento';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:640px">
<p style="margin:0 0 4px;color:#ea580c;font-size:12px;font-weight:700;text-transform:uppercase">Comprovante de pagamento</p>
<h2 style="margin:0 0 12px;color:#0f172a">${esc(titulo)} — ${esc(brl(d.comp.valor ?? d.valor))}</h2>
<table style="border-collapse:collapse;font-size:14px">${tr}</table>
<div style="margin-top:16px">${botao}</div>
<p style="margin-top:16px;color:#64748b;font-size:12px">Enviado automaticamente pelo sistema do Prainha a cada pagamento feito pelo Inter. Dados lidos da API do Banco Inter.</p>
</div>`;
}

/** Manda o comprovante desta baixa pro contador, se ainda não mandou. Nunca lança erro. */
export async function enviarComprovanteBaixaContador(baixaId: string): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    if (!emailLigado()) return { enviado: false, motivo: 'e-mail desligado' };
    // pega a vez (uma vez só, mesmo com dois envios ao mesmo tempo)
    const pego = (await db.execute(sql`
      INSERT INTO comprovante_contador_baixa (baixa_id, filial_id, enviado_em, tentativas)
      SELECT b.id, c.filial_id, now(), 1
        FROM conta_pagar_baixa b JOIN conta_pagar c ON c.id = b.conta_pagar_id
       WHERE b.id = ${baixaId}::uuid
      ON CONFLICT (baixa_id) DO UPDATE
         SET enviado_em = now(), tentativas = comprovante_contador_baixa.tentativas + 1, atualizado_em = now()
       WHERE comprovante_contador_baixa.enviado_em IS NULL
         AND comprovante_contador_baixa.tentativas < ${MAX_TENTATIVAS}
      RETURNING tentativas
    `)) as unknown as Array<{ tentativas: number }>;
    if (pego.length === 0) return { enviado: false, motivo: 'já enviado' };
    const tentativa = Number(pego[0]!.tentativas);

    const falhou = async (motivo: string) => {
      await db.execute(sql`
        UPDATE comprovante_contador_baixa SET enviado_em = NULL, erro = ${motivo}, atualizado_em = now()
         WHERE baixa_id = ${baixaId}::uuid
      `);
      return { enviado: false, motivo };
    };

    const para = await emailsDoContador();
    if (para.length === 0) return falhou('nenhum e-mail do contador (permissão imposto.enviar)');
    const d = await dadosComprovanteBaixa(baixaId);
    if (!d) return falhou('baixa não é de pagamento do Inter');
    // Inter fora do ar / ainda sem o pagamento: espera a próxima volta do cron
    // (na última tentativa manda com o que tiver)
    if (d.comp.avisos.length > 0 && tentativa < MAX_TENTATIVAS) return falhou(d.comp.avisos.join(' '));

    const link = linkComprovanteBaixa(baixaId);
    const assunto = `Comprovante — ${d.casa ? `${d.casa} — ` : ''}${d.fornecedorNome ?? d.contaDescricao ?? 'pagamento'} — ${brl(d.comp.valor ?? d.valor)}`.slice(0, 200);
    const html = htmlEmail(d, link);
    const erros: string[] = [];
    for (const e of para) {
      const r = await enviarEmail({ para: e, assunto, html });
      if (!r.ok) erros.push(`${e}: ${r.motivo ?? 'falhou'}`);
    }
    if (erros.length === para.length) return falhou(erros.join('; '));
    await db.execute(sql`
      UPDATE comprovante_contador_baixa
         SET para = ${para.join(', ')}, erro = ${erros.length ? erros.join('; ') : null}, atualizado_em = now()
       WHERE baixa_id = ${baixaId}::uuid
    `);
    return { enviado: true };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn('[comprovante-contador-baixa]', baixaId, motivo);
    await db
      .execute(sql`UPDATE comprovante_contador_baixa SET enviado_em = NULL, erro = ${motivo}, atualizado_em = now() WHERE baixa_id = ${baixaId}::uuid`)
      .catch(() => null);
    return { enviado: false, motivo };
  }
}

/**
 * Baixas de pagamento do Inter (desde DESDE) que ainda não foram pro contador.
 * As contas pagas pela tela Pagar conta ficam de fora (já mandam o delas).
 */
export async function enviarComprovantesBaixaPendentes(limiteMs = 15_000, limite = 10): Promise<{ enviados: number; tentados: number }> {
  if (!emailLigado()) return { enviados: 0, tentados: 0 };
  const fim = Date.now() + limiteMs;
  const rows = (await db.execute(sql`
    SELECT b.id
      FROM conta_pagar_baixa b
      LEFT JOIN comprovante_contador_baixa k ON k.baixa_id = b.id
     WHERE b.criado_em >= ${DESDE}::date
       AND (k.baixa_id IS NULL
            OR (k.enviado_em IS NULL AND k.tentativas < ${MAX_TENTATIVAS} AND k.atualizado_em < now() - interval '10 minutes'))
       AND NOT EXISTS (SELECT 1 FROM conta_consumo_pagamento p WHERE p.conta_pagar_id = b.conta_pagar_id)
       AND (
         b.observacao ~ '^Pix (enviado pelo sistema \\(Inter\\)|pago no Inter \\(tela Pedidos)'
         OR b.observacao ~ 'Boleto pago no Inter \\('
         OR EXISTS (
           SELECT 1 FROM lancamento_banco l JOIN conta_bancaria cb ON cb.id = l.conta_bancaria_id
            WHERE cb.banco ILIKE '%inter%'
              AND (l.id = b.lancamento_banco_id
                   OR l.id IN (SELECT v.lancamento_banco_id FROM pix_conta_vinculo v WHERE v.conta_pagar_baixa_id = b.id))
         )
       )
     ORDER BY b.criado_em
     LIMIT ${limite}
  `)) as unknown as Array<{ id: string }>;
  let enviados = 0;
  let tentados = 0;
  for (const r of rows) {
    if (Date.now() > fim) break;
    tentados += 1;
    if ((await enviarComprovanteBaixaContador(r.id)).enviado) enviados += 1;
  }
  return { enviados, tentados };
}
