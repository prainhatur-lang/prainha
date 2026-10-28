// Comprovante do Pix pago pelo sistema → WhatsApp de quem recebeu
// (pedido do dono 28/10/2026).
//
// Quando o Pix vira PAGO (baixarContasDoPix, uma vez só), monta um PDF com os
// dados que o próprio Inter devolve e manda pelo número de WhatsApp da casa
// que pagou:
//   · conversa aberta nas últimas 24 h → documento livre;
//   · fora da janela → template UTILIDADE `WHATSAPP_COMPROVANTE_TEMPLATE`
//     (cabeçalho DOCUMENTO; corpo {{1}} favorecido, {{2}} casa, {{3}} valor,
//     {{4}} data);
//   · sem template configurado → fica SEM_TEMPLATE e a tela oferece o wa.me
//     com o texto + link do PDF.
// O número vem, nesta ordem: fornecedor.fone_whatsapp → telefone do
// funcionário ligado ao fornecedor → vendedor principal → fone_principal
// (só se for celular). A lista "não enviar mais" é respeitada.
// Cada tentativa vira uma linha em pix_comprovante_envio.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { desc, eq, sql } from 'drizzle-orm';
import { consultarPagamentoPixInter, resolverCredenciaisInterPagamentos, type InterPixConsulta } from '@/lib/inter';
import { celular11, rotuloMotivoFora, telefonesForaDosEnvios } from '@/lib/whatsapp-nao-enviar';

const VALIDADE_LINK_MS = 60 * 24 * 3600 * 1000; // 60 dias

// DESLIGADO (28/10/2026). O dono: "o comprovante não pode ser fake" — só vale
// o comprovante OFICIAL do banco. Conferido na doc do Inter (developers.inter.co,
// API Banking v2 e API Pix): não há endpoint de comprovante; o Pix só tem
// GET /banking/v2/pix/{codigoSolicitacao} (JSON) e o único PDF oficial é o
// extrato do período (GET /banking/v2/extrato/exportar), que traz a conta toda.
// Enquanto não houver o oficial, NADA sai: nem o PDF montado aqui, nem wa.me.
export const COMPROVANTE_BANCO_DISPONIVEL = false;
export const MOTIVO_COMPROVANTE_INDISPONIVEL =
  'a API do Inter não fornece o comprovante oficial do Pix (só os dados da transação e o extrato do período)';

function versao(): string {
  return process.env.WHATSAPP_API_VERSION || 'v21.0';
}
function token(): string {
  return process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_META || '';
}
export function baseUrlApp(): string {
  const v = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\\n/g, '').replace(/\/+$/, '');
  return /^https:\/\//.test(v) ? v : 'https://app.prainhabar.com';
}

// ── Link público assinado do PDF ───────────────────────────────────────────

function assinar(corpo: string): string {
  return createHmac('sha256', `pix-comprovante:${process.env.CREDENCIAL_SECRET ?? ''}`).update(corpo).digest('base64url');
}

export function linkComprovantePdf(pixId: string): string {
  const x = String(Date.now() + VALIDADE_LINK_MS);
  return `${baseUrlApp()}/api/financeiro/pedidos-pix/comprovante?id=${pixId}&x=${x}&s=${assinar(`${pixId}.${x}`)}`;
}

export function conferirLinkComprovante(id: string, x: string, s: string): boolean {
  if (!id || !x || !s) return false;
  const esperado = Buffer.from(assinar(`${id}.${x}`));
  const veio = Buffer.from(s);
  if (esperado.length !== veio.length || !timingSafeEqual(esperado, veio)) return false;
  return Number(x) > Date.now();
}

// ── Dados do comprovante ───────────────────────────────────────────────────

export type DadosComprovantePix = {
  pixId: string;
  filialId: string;
  casa: string;
  favorecido: string;
  valor: number;
  dataHora: string | null; // texto pronto (dd/mm/aaaa hh:mm)
  dataCurta: string; // dd/mm/aaaa
  campos: Array<[string, string]>;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dataBr(iso: string | null | undefined): { longa: string | null; curta: string | null } {
  if (!iso) return { longa: null, curta: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return { longa: iso, curta: null };
  const curta = `${m[3]}/${m[2]}/${m[1]}`;
  return { longa: m[4] ? `${curta} ${m[4]}:${m[5]}` : curta, curta };
}

function docFormatado(d: string): string {
  const s = d.replace(/\D/g, '');
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  return d;
}

export async function dadosComprovantePix(pixId: string): Promise<DadosComprovantePix | null> {
  const [p] = await db.select().from(schema.pixPagamento).where(eq(schema.pixPagamento.id, pixId)).limit(1);
  if (!p) return null;
  const [f] = await db.select({ nome: schema.filial.nome }).from(schema.filial).where(eq(schema.filial.id, p.filialId)).limit(1);
  let t: InterPixConsulta['transacaoPix'] =
    ((p.retorno as InterPixConsulta | null)?.transacaoPix as InterPixConsulta['transacaoPix']) ?? undefined;
  if ((!t || !t.dataHoraMovimento) && p.codigoSolicitacao) {
    const cred = resolverCredenciaisInterPagamentos(p.filialId);
    if (cred) {
      try {
        t = (await consultarPagamentoPixInter(cred, p.codigoSolicitacao)).transacaoPix ?? t;
      } catch {
        /* fica com o que tem */
      }
    }
  }
  t = t ?? {};
  const quando = dataBr(t.dataHoraMovimento ?? (p.baixadoEm ? p.baixadoEm.toISOString() : null));
  const favorecido = t.recebedor?.nome || p.favorecido || '—';
  const valor = t.valor != null ? Number(t.valor) : Number(p.valor);
  const campos: Array<[string, string]> = [];
  campos.push(['Valor', brl(valor)]);
  campos.push(['Recebedor', favorecido]);
  if (t.recebedor?.cpfCnpj) campos.push(['CPF/CNPJ', docFormatado(String(t.recebedor.cpfCnpj))]);
  const inst = (t.recebedor as Record<string, unknown> | undefined)?.instituicaoFinanceira;
  if (typeof inst === 'string' && inst) campos.push(['Instituição', inst]);
  campos.push(['Chave Pix', t.chave ?? p.chave]);
  if (quando.longa) campos.push(['Data/hora', quando.longa]);
  campos.push(['Pagador', f?.nome ?? '—']);
  if (p.descricao) campos.push(['Descrição', p.descricao]);
  const e2e = t.endToEnd ?? p.endToEndId;
  if (e2e) campos.push(['ID da transação', e2e]);
  if (p.codigoSolicitacao) campos.push(['Código no Inter', p.codigoSolicitacao]);
  return {
    pixId,
    filialId: p.filialId,
    casa: f?.nome ?? 'Prainha',
    favorecido,
    valor,
    dataHora: quando.longa,
    dataCurta: quando.curta ?? '',
    campos,
  };
}

// ── PDF mínimo (Helvetica, WinAnsi) — sem biblioteca ───────────────────────

function pdfTexto(s: string): string {
  // WinAnsi ≈ latin1 pra acentos do português; fora disso vira '?'
  const limpo = s.replace(/[—–]/g, '-').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  return limpo.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function quebrar(s: string, max: number): string[] {
  const out: string[] = [];
  let resto = s;
  while (resto.length > max) {
    let i = resto.lastIndexOf(' ', max);
    if (i < max * 0.5) i = max;
    out.push(resto.slice(0, i).trimEnd());
    resto = resto.slice(i).trimStart();
  }
  out.push(resto);
  return out;
}

export function pdfComprovantePix(d: DadosComprovantePix): Buffer {
  const ops: string[] = [];
  const txt = (x: number, y: number, tam: number, negrito: boolean, s: string) =>
    ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${x} ${y} Td (${pdfTexto(s)}) Tj ET`);
  let y = 790;
  txt(50, y, 18, true, 'Comprovante de Pix');
  y -= 22;
  txt(50, y, 11, false, `${d.casa} - pago pelo Banco Inter`);
  y -= 34;
  txt(50, y, 26, true, brl(d.valor));
  y -= 18;
  ops.push(`0.8 G 50 ${y} m 545 ${y} l S`);
  y -= 26;
  for (const [k, v] of d.campos) {
    if (k === 'Valor') continue;
    txt(50, y, 10, true, k);
    const linhas = quebrar(v, 60);
    for (const l of linhas) {
      txt(190, y, 10, false, l);
      y -= 15;
    }
    y -= 7;
  }
  y -= 10;
  ops.push(`0.8 G 50 ${y} m 545 ${y} l S`);
  y -= 18;
  txt(50, y, 8, false, 'Dados devolvidos pelo Banco Inter na consulta do Pix. Enviado pelo sistema do Prainha.');

  const conteudo = Buffer.from(ops.join('\n'), 'latin1');
  const objs: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    Buffer.concat([Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`), conteudo, Buffer.from('\nendstream')]),
  ];
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = partes[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    partes.push(b);
    pos += b.length;
  });
  const xref =
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  partes.push(Buffer.from(xref));
  return Buffer.concat(partes);
}

export function nomeArquivoComprovante(d: DadosComprovantePix): string {
  const data = d.dataCurta.replace(/\//g, '-') || 'pix';
  return `comprovante-pix-${data}.pdf`;
}

// ── Destinatário ───────────────────────────────────────────────────────────

export type OrigemFone = 'fone_whatsapp' | 'funcionario' | 'vendedor' | 'fone_principal';

export const ROTULO_ORIGEM: Record<string, string> = {
  fone_whatsapp: 'WhatsApp do cadastro',
  funcionario: 'telefone do funcionário (RH)',
  vendedor: 'WhatsApp do vendedor',
  fone_principal: 'telefone do Consumer',
};

export async function destinatarioDoPix(
  fornecedorId: string | null,
): Promise<{ telefone: string; origem: OrigemFone } | null> {
  if (!fornecedorId) return null;
  const r = (await db.execute(sql`
    SELECT f.fone_whatsapp,
           (SELECT fu.telefone FROM funcionario fu
             WHERE fu.fornecedor_id = f.id AND fu.telefone IS NOT NULL AND fu.telefone <> ''
             LIMIT 1) AS fone_func,
           (SELECT v.whatsapp FROM vendedor_fornecedor vf JOIN vendedor v ON v.id = vf.vendedor_id
             WHERE vf.fornecedor_id = f.id AND v.whatsapp IS NOT NULL AND v.whatsapp <> ''
             ORDER BY vf.principal DESC, vf.criado_em ASC LIMIT 1) AS fone_vend,
           f.fone_principal
      FROM fornecedor f WHERE f.id = ${fornecedorId}::uuid
  `)) as unknown as Array<{
    fone_whatsapp: string | null;
    fone_func: string | null;
    fone_vend: string | null;
    fone_principal: string | null;
  }>;
  const l = r[0];
  if (!l) return null;
  const ordem: Array<[OrigemFone, string | null]> = [
    ['fone_whatsapp', l.fone_whatsapp],
    ['funcionario', l.fone_func],
    ['vendedor', l.fone_vend],
    ['fone_principal', l.fone_principal],
  ];
  for (const [origem, fone] of ordem) {
    const c = celular11(fone);
    if (c) return { telefone: c, origem };
  }
  return null;
}

// ── Envio ──────────────────────────────────────────────────────────────────

async function remetenteDaCasa(filialId: string): Promise<string | null> {
  const linhas = await db
    .select({ id: schema.whatsappNumero.phoneNumberId, ativo: schema.whatsappNumero.atendenteAtivo })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, filialId));
  linhas.sort((a, b) => Number(b.ativo) - Number(a.ativo));
  return linhas[0]?.id ?? process.env.WHATSAPP_PHONE_ID ?? null;
}

async function janelaAberta(filialId: string, fone11: string): Promise<boolean> {
  const r = (await db.execute(sql`
    SELECT 1 FROM atendimento_conversa
     WHERE filial_id = ${filialId}::uuid
       AND right(regexp_replace(telefone, '\D', '', 'g'), 8) = ${fone11.slice(-8)}
       AND ultima_msg_cliente_em > now() - interval '23 hours 50 minutes'
     LIMIT 1
  `)) as unknown as unknown[];
  return r.length > 0;
}

async function postar(phoneId: string, corpo: unknown): Promise<{ wamid: string | null; erro?: string }> {
  try {
    const resp = await fetch(`https://graph.facebook.com/${versao()}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const json = (await resp.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
      | null;
    if (!resp.ok) {
      return { wamid: null, erro: `${json?.error?.code ?? resp.status}: ${json?.error?.message ?? 'erro desconhecido'}` };
    }
    return { wamid: json?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { wamid: null, erro: e instanceof Error ? e.message : String(e) };
  }
}

export function textoComprovante(d: DadosComprovantePix): string {
  return (
    `Olá, ${d.favorecido}! Segue o comprovante do Pix de ${brl(d.valor)} pago pela ${d.casa}` +
    `${d.dataHora ? ` em ${d.dataHora}` : ''}.`
  );
}

export type ResultadoEnvioComprovante = {
  status: 'ENVIADO' | 'ERRO' | 'SEM_NUMERO' | 'SEM_TEMPLATE' | 'NAO_ENVIAR' | 'INDISPONIVEL';
  telefone: string | null;
  modo: 'janela' | 'template' | null;
  mensagem: string;
};

/** Manda o comprovante e grava a tentativa. Nunca lança. */
export async function enviarComprovantePix(
  pixId: string,
  opts: { auto: boolean; usuarioEmail?: string | null },
): Promise<ResultadoEnvioComprovante> {
  let filialId: string | null = null;
  let telefone: string | null = null;
  let origem: string | null = null;
  const gravar = async (r: ResultadoEnvioComprovante, wamid: string | null, erro: string | null) => {
    if (!filialId) return;
    await db
      .insert(schema.pixComprovanteEnvio)
      .values({
        pixPagamentoId: pixId,
        filialId,
        telefone,
        origemFone: origem,
        modo: r.modo,
        status: r.status,
        wamid,
        erro,
        usuarioEmail: opts.usuarioEmail ?? null,
        auto: opts.auto,
      })
      .catch((e) => console.error('pix-comprovante: gravar envio', e instanceof Error ? e.message : e));
  };
  try {
    const [p] = await db
      .select({ id: schema.pixPagamento.id, filialId: schema.pixPagamento.filialId, status: schema.pixPagamento.status, fornecedorId: schema.pixPagamento.fornecedorId })
      .from(schema.pixPagamento)
      .where(eq(schema.pixPagamento.id, pixId))
      .limit(1);
    if (!p) return { status: 'ERRO', telefone: null, modo: null, mensagem: 'Pix não encontrado.' };
    filialId = p.filialId;
    if (p.status !== 'PAGO') {
      const r: ResultadoEnvioComprovante = { status: 'ERRO', telefone: null, modo: null, mensagem: 'O Pix ainda não está pago.' };
      return r;
    }
    if (!COMPROVANTE_BANCO_DISPONIVEL) {
      return {
        status: 'INDISPONIVEL',
        telefone: null,
        modo: null,
        mensagem: `Comprovante do banco indisponível: ${MOTIVO_COMPROVANTE_INDISPONIVEL}. Nada foi enviado.`,
      };
    }
    const dest = await destinatarioDoPix(p.fornecedorId);
    if (!dest) {
      const r: ResultadoEnvioComprovante = {
        status: 'SEM_NUMERO',
        telefone: null,
        modo: null,
        mensagem: 'Recebedor sem celular no cadastro — preencha o WhatsApp dele na linha do Pix.',
      };
      await gravar(r, null, null);
      return r;
    }
    telefone = dest.telefone;
    origem = dest.origem;
    const fora = await telefonesForaDosEnvios([dest.telefone]);
    const motivo = fora.get(dest.telefone);
    if (motivo) {
      const r: ResultadoEnvioComprovante = {
        status: 'NAO_ENVIAR',
        telefone,
        modo: null,
        mensagem: `Número na lista "não enviar mais" (${rotuloMotivoFora(motivo)}).`,
      };
      await gravar(r, null, motivo);
      return r;
    }
    const d = await dadosComprovantePix(pixId);
    if (!d) return { status: 'ERRO', telefone, modo: null, mensagem: 'Pix não encontrado.' };
    const phoneId = await remetenteDaCasa(p.filialId);
    if (!token() || !phoneId) {
      const r: ResultadoEnvioComprovante = { status: 'ERRO', telefone, modo: null, mensagem: 'WhatsApp não configurado.' };
      await gravar(r, null, 'WHATSAPP_TOKEN/META ou número da casa ausente');
      return r;
    }
    const para = `55${dest.telefone}`;
    const link = linkComprovantePdf(pixId);
    const arquivo = nomeArquivoComprovante(d);

    if (await janelaAberta(p.filialId, dest.telefone)) {
      const res = await postar(phoneId, {
        messaging_product: 'whatsapp',
        to: para,
        type: 'document',
        document: { link, filename: arquivo, caption: textoComprovante(d) },
      });
      if (res.wamid) {
        const r: ResultadoEnvioComprovante = { status: 'ENVIADO', telefone, modo: 'janela', mensagem: 'Comprovante enviado.' };
        await gravar(r, res.wamid, null);
        return r;
      }
      // conversa achou que estava aberta e não estava → tenta o template abaixo
      if (!process.env.WHATSAPP_COMPROVANTE_TEMPLATE) {
        const r: ResultadoEnvioComprovante = { status: 'ERRO', telefone, modo: 'janela', mensagem: `WhatsApp recusou: ${res.erro}` };
        await gravar(r, null, res.erro ?? null);
        return r;
      }
    }

    const template = process.env.WHATSAPP_COMPROVANTE_TEMPLATE;
    if (!template) {
      const r: ResultadoEnvioComprovante = {
        status: 'SEM_TEMPLATE',
        telefone,
        modo: null,
        mensagem: 'Sem conversa aberta e o modelo do comprovante ainda não está configurado — use o botão do wa.me.',
      };
      await gravar(r, null, 'WHATSAPP_COMPROVANTE_TEMPLATE ausente');
      return r;
    }
    const res = await postar(phoneId, {
      messaging_product: 'whatsapp',
      to: para,
      type: 'template',
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_COMPROVANTE_LANG || 'pt_BR' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { link, filename: arquivo } }] },
          {
            type: 'body',
            parameters: [d.favorecido, d.casa, brl(d.valor), d.dataCurta || d.dataHora || '—'].map((t) => ({
              type: 'text',
              text: t,
            })),
          },
        ],
      },
    });
    if (res.wamid) {
      const r: ResultadoEnvioComprovante = { status: 'ENVIADO', telefone, modo: 'template', mensagem: 'Comprovante enviado.' };
      await gravar(r, res.wamid, null);
      return r;
    }
    const r: ResultadoEnvioComprovante = { status: 'ERRO', telefone, modo: 'template', mensagem: `WhatsApp recusou: ${res.erro}` };
    await gravar(r, null, res.erro ?? null);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const r: ResultadoEnvioComprovante = { status: 'ERRO', telefone, modo: null, mensagem: msg };
    await gravar(r, null, msg);
    return r;
  }
}

/** Disparo automático quando o Pix vira PAGO: uma vez só por Pix. */
export async function enviarComprovantePixAuto(pixId: string): Promise<void> {
  const [ja] = await db
    .select({ id: schema.pixComprovanteEnvio.id })
    .from(schema.pixComprovanteEnvio)
    .where(sql`${schema.pixComprovanteEnvio.pixPagamentoId} = ${pixId}::uuid AND ${schema.pixComprovanteEnvio.auto}`)
    .limit(1);
  if (ja) return;
  await enviarComprovantePix(pixId, { auto: true });
}

/** Atualiza ENTREGUE/LIDA/ERRO pelo wamid (webhook da Meta). */
export async function registrarStatusComprovante(wamid: string, status: string, erro: string | null): Promise<void> {
  const novo = status === 'delivered' ? 'ENTREGUE' : status === 'read' ? 'LIDA' : status === 'failed' ? 'ERRO' : null;
  if (!novo) return;
  // não volta de LIDA pra ENTREGUE (a Meta às vezes manda fora de ordem)
  await db.execute(sql`
    UPDATE pix_comprovante_envio
       SET status = ${novo}, erro = COALESCE(${erro}::text, erro), atualizado_em = now()
     WHERE wamid = ${wamid}
       AND NOT (status = 'LIDA' AND ${novo}::text = 'ENTREGUE')
  `);
}

/** Último envio de cada Pix (pra tela). */
export async function ultimosEnviosComprovante(pixIds: string[]) {
  if (!pixIds.length) return new Map<string, typeof schema.pixComprovanteEnvio.$inferSelect>();
  const linhas = await db
    .select()
    .from(schema.pixComprovanteEnvio)
    .where(sql`${schema.pixComprovanteEnvio.pixPagamentoId} IN (${sql.join(pixIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
    .orderBy(desc(schema.pixComprovanteEnvio.criadoEm));
  const m = new Map<string, (typeof linhas)[number]>();
  for (const l of linhas) if (!m.has(l.pixPagamentoId)) m.set(l.pixPagamentoId, l);
  return m;
}

/** Link wa.me com o texto e o link do PDF (fallback de 1 toque). */
export async function linkWaMeComprovante(pixId: string, telefone: string | null): Promise<string | null> {
  if (!COMPROVANTE_BANCO_DISPONIVEL) return null;
  const d = await dadosComprovantePix(pixId);
  if (!d) return null;
  const texto = `${textoComprovante(d)}\n\nComprovante: ${linkComprovantePdf(pixId)}`;
  return `https://wa.me/${telefone ? `55${telefone}` : ''}?text=${encodeURIComponent(texto)}`;
}
