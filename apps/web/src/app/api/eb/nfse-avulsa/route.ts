// Nota de serviço (NFS-e) avulsa pra empresa de fora — ações da tela /eb/nfse-avulsa:
//   cnpj      busca razão social e endereço do tomador (só pra preencher)
//   salvar    cria ou corrige o rascunho
//   emitir    emite a NFS-e Nacional (lib/nfse/emitir-avulsa.ts)
//   descartar descarta o rascunho (nota emitida não se descarta aqui)
// GET ?id=...  baixa o XML da nota emitida.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { configEb } from '@/lib/eb/faturas';
import { buscarEnderecoCnpj, emitirNfseAvulsa } from '@/lib/nfse/emitir-avulsa';
import { carregarPemEb } from '@/lib/nfse/emitir-eb';
import { baixarDanfse } from '@/lib/nfse/sefin';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const Dig = (n: number, msg: string) => z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().length(n, msg));

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('cnpj'), cnpj: z.string() }),
  z.object({
    acao: z.literal('salvar'),
    id: z.string().uuid().nullable(),
    tomadorCnpj: Dig(14, 'CNPJ do tomador tem 14 dígitos'),
    tomadorNome: z.string().trim().min(2, 'Informe a razão social do tomador').max(300),
    tomadorEmail: z.string().trim().max(80).nullable(),
    tomadorCodigoMunicipio: Dig(7, 'Código IBGE do município do tomador tem 7 dígitos'),
    tomadorCidade: z.string().trim().max(120).nullable(),
    tomadorCep: Dig(8, 'CEP do tomador tem 8 dígitos'),
    tomadorLogradouro: z.string().trim().min(1, 'Informe o endereço do tomador').max(255),
    tomadorNumero: z.string().trim().max(60).nullable(),
    tomadorBairro: z.string().trim().min(1, 'Informe o bairro do tomador').max(60),
    codigoTributacao: Dig(6, 'Código de tributação nacional tem 6 dígitos'),
    descricao: z.string().trim().min(3, 'Descreva o serviço').max(2000),
    municipioPrestacao: Dig(7, 'Código IBGE do município da prestação tem 7 dígitos'),
    dataCompetencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    valorServico: z.number().positive('Informe o valor do serviço'),
    aliquotaIss: z.number().min(0).max(5, 'O ISS vai no máximo a 5% (LC 116).').nullable(),
    issRetido: z.boolean(),
  }),
  z.object({ acao: z.literal('emitir'), id: z.string().uuid() }),
  z.object({ acao: z.literal('descartar'), id: z.string().uuid() }),
]);

const r2 = (n: number) => Math.round(n * 100) / 100;

async function entrar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const semPerm = await negarSemPerm(user.id, 'folha_equipe.fechar');
  if (semPerm) return { erro: semPerm };
  const cfg = await configEb();
  if (!cfg) return { erro: NextResponse.json({ error: 'Nenhuma empresa com NFS-e configurada.' }, { status: 500 }) };
  return { user, cfg };
}

// Imprimir a nota emitida (dono, 11/11/2026: "não tem opção de imprimir").
// Primeiro tenta o PDF oficial (DANFSe) na Receita, com o certificado da E.B.;
// se a Receita não entregar, abre uma folha pronta pra imprimir com os dados
// da nota e a chave de acesso.
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const dinheiro = (v: unknown) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

async function imprimir(id: string, cfg: { filialId: string; razaoSocial: string }) {
  const [n] = await db
    .select()
    .from(schema.nfseAvulsa)
    .where(and(eq(schema.nfseAvulsa.id, id), eq(schema.nfseAvulsa.filialId, cfg.filialId)))
    .limit(1);
  if (!n || n.status !== 'EMITIDA' || !n.nfseChave) {
    return NextResponse.json({ error: 'Só dá pra imprimir nota já emitida.' }, { status: 404 });
  }
  const [nc] = await db
    .select({ ambiente: schema.nfseConfig.ambiente, cnpj: schema.nfseConfig.cnpj })
    .from(schema.nfseConfig)
    .where(eq(schema.nfseConfig.filialId, cfg.filialId))
    .limit(1);
  try {
    const pem = await carregarPemEb(cfg.filialId);
    if (typeof pem !== 'string') {
      const r = await baixarDanfse({
        ambiente: nc?.ambiente === 'homologacao' ? 'homologacao' : 'producao',
        chave: n.nfseChave,
        pem,
      });
      if (r.status === 200 && r.corpo.subarray(0, 4).toString('latin1') === '%PDF') {
        return new NextResponse(new Uint8Array(r.corpo), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="nfse-${n.nfseNumero ?? n.nfseChave}.pdf"`,
          },
        });
      }
      console.warn('[nfse-avulsa] DANFSe não veio da Receita', r.status, r.tipo);
    }
  } catch (err) {
    console.warn('[nfse-avulsa] DANFSe falhou', (err as Error).message);
  }

  const [ano, mes, dia] = String(n.dataCompetencia).split('-');
  const emitida = n.nfseEmitidaEm
    ? n.nfseEmitidaEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    : '';
  const cod = n.codigoTributacao.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3');
  const linha = (r: string, v: string) => `<tr><th>${r}</th><td>${v}</td></tr>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>NFS-e nº ${esc(n.nfseNumero)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
h1{font-size:18px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 4px;border-bottom:1px solid #999;padding-bottom:2px}
table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:normal;color:#555;width:190px;vertical-align:top;padding:3px 0}td{padding:3px 0}
.topo{display:flex;justify-content:space-between;align-items:flex-start;border:1px solid #111;padding:10px 12px}
.chave{font-family:monospace;font-size:12px;word-break:break-all}.total{font-size:16px;font-weight:bold}
.obs{margin-top:18px;font-size:11px;color:#555}button{margin-bottom:14px;padding:6px 14px}
@media print{button{display:none}body{margin:0}}
</style></head><body>
<button onclick="window.print()">Imprimir</button>
<div class="topo"><div><h1>NFS-e — Nota Fiscal de Serviço eletrônica</h1><div>Padrão nacional</div></div>
<div style="text-align:right"><div class="total">Nº ${esc(n.nfseNumero)}</div><div>Emitida em ${esc(emitida)}</div><div>Competência ${dia}/${mes}/${ano}</div></div></div>
<h2>Chave de acesso</h2><div class="chave">${esc(n.nfseChave)}</div>
<h2>Prestador</h2><table>${linha('Nome', esc(cfg.razaoSocial))}${linha('CNPJ', esc(fmtCnpj(nc?.cnpj ?? '')))}</table>
<h2>Tomador</h2><table>${linha('Nome', esc(n.tomadorNome))}${linha('CNPJ', esc(fmtCnpj(n.tomadorCnpj)))}
${linha('Endereço', esc(`${n.tomadorLogradouro}, ${n.tomadorNumero || 'S/N'} — ${n.tomadorBairro} — ${n.tomadorCidade ?? ''} — CEP ${n.tomadorCep}`))}
${n.tomadorEmail ? linha('E-mail', esc(n.tomadorEmail)) : ''}</table>
<h2>Serviço</h2><table>${linha('Código de tributação', esc(cod))}${linha('Descrição', esc(n.descricao).replace(/\n/g, '<br>'))}</table>
<h2>Valores</h2><table>${linha('Valor do serviço', dinheiro(n.valorServico))}
${n.issRetido ? linha(`ISS retido (${esc(n.aliquotaIss)}%)`, dinheiro(n.valorIss)) : linha('ISS', 'sem retenção — prestador do Simples Nacional')}
${linha('Valor líquido', `<span class="total">${dinheiro(n.valorLiquido)}</span>`)}</table>
<p class="obs">Resumo impresso pelo sistema. A nota oficial pode ser conferida em www.nfse.gov.br/consultapublica com a chave de acesso acima.</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(req: Request) {
  const e = await entrar();
  if ('erro' in e) return e.erro;
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  if (sp.get('imprimir') === '1') return imprimir(id, e.cfg);
  const [n] = await db
    .select({ xml: schema.nfseAvulsa.nfseXml, chave: schema.nfseAvulsa.nfseChave })
    .from(schema.nfseAvulsa)
    .where(and(eq(schema.nfseAvulsa.id, id), eq(schema.nfseAvulsa.filialId, e.cfg.filialId)))
    .limit(1);
  if (!n?.xml) return NextResponse.json({ error: 'nota sem XML' }, { status: 404 });
  return new NextResponse(n.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="nfse-${n.chave ?? id}.xml"`,
    },
  });
}

export async function POST(req: Request) {
  const e = await entrar();
  if ('erro' in e) return e.erro;
  const { user, cfg } = e;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues.find((i) => i.message && !i.message.startsWith('Invalid') && !i.message.startsWith('Too') && !i.message.startsWith('Number'))?.message;
    return NextResponse.json({ error: msg ?? 'dados inválidos' }, { status: 400 });
  }
  const body = parsed.data;

  if (body.acao === 'cnpj') {
    const d = await buscarEnderecoCnpj(body.cnpj);
    if (!d) return NextResponse.json({ error: 'Não achei esse CNPJ na Receita. Preencha na mão.' }, { status: 404 });
    return NextResponse.json({ ok: true, dados: d });
  }

  const daEmpresa = (id: string) => and(eq(schema.nfseAvulsa.id, id), eq(schema.nfseAvulsa.filialId, cfg.filialId));

  if (body.acao === 'salvar') {
    if (body.dataCompetencia > hojeBr()) {
      return NextResponse.json({ error: 'A data de competência não pode ser no futuro.' }, { status: 400 });
    }
    if (body.issRetido && body.aliquotaIss === null) {
      return NextResponse.json({ error: 'ISS retido pelo tomador: informe a alíquota.' }, { status: 400 });
    }
    // E.B. é do Simples: sem retenção a nota não leva alíquota (E0625) — dono 11/11/2026
    if (!body.issRetido) body.aliquotaIss = null;
    const valor = r2(body.valorServico);
    const iss = body.aliquotaIss === null ? 0 : r2((valor * body.aliquotaIss) / 100);
    const campos = {
      tomadorCnpj: body.tomadorCnpj,
      tomadorNome: body.tomadorNome,
      tomadorEmail: body.tomadorEmail || null,
      tomadorCodigoMunicipio: body.tomadorCodigoMunicipio,
      tomadorCidade: body.tomadorCidade || null,
      tomadorCep: body.tomadorCep,
      tomadorLogradouro: body.tomadorLogradouro,
      tomadorNumero: body.tomadorNumero || null,
      tomadorBairro: body.tomadorBairro,
      codigoTributacao: body.codigoTributacao,
      descricao: body.descricao,
      municipioPrestacao: body.municipioPrestacao,
      dataCompetencia: body.dataCompetencia,
      valorServico: valor.toFixed(2),
      aliquotaIss: body.aliquotaIss === null ? null : body.aliquotaIss.toFixed(2),
      issRetido: body.issRetido,
      valorIss: iss.toFixed(2),
      valorLiquido: (body.issRetido ? r2(valor - iss) : valor).toFixed(2),
      atualizadoEm: new Date(),
    };
    if (body.id) {
      const [atual] = await db.select({ status: schema.nfseAvulsa.status }).from(schema.nfseAvulsa).where(daEmpresa(body.id)).limit(1);
      if (!atual) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });
      if (atual.status !== 'RASCUNHO') return NextResponse.json({ error: 'Só rascunho pode ser corrigido.' }, { status: 400 });
      await db.update(schema.nfseAvulsa).set(campos).where(daEmpresa(body.id));
      return NextResponse.json({ ok: true, id: body.id });
    }
    const [novo] = await db
      .insert(schema.nfseAvulsa)
      .values({ ...campos, filialId: cfg.filialId, criadoPor: user.id })
      .returning({ id: schema.nfseAvulsa.id });
    return NextResponse.json({ ok: true, id: novo!.id });
  }

  const [nota] = await db.select({ status: schema.nfseAvulsa.status }).from(schema.nfseAvulsa).where(daEmpresa(body.id)).limit(1);
  if (!nota) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });

  if (body.acao === 'descartar') {
    if (nota.status !== 'RASCUNHO') return NextResponse.json({ error: 'Nota emitida não se descarta aqui (cancelamento é no portal da NFS-e).' }, { status: 400 });
    await db.update(schema.nfseAvulsa).set({ status: 'CANCELADA', atualizadoEm: new Date() }).where(daEmpresa(body.id));
    return NextResponse.json({ ok: true });
  }

  const r = await emitirNfseAvulsa(body.id);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, chave: r.chave, numero: r.numero, alertas: r.alertas });
}
