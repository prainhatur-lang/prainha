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

export async function GET(req: Request) {
  const e = await entrar();
  if ('erro' in e) return e.erro;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
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
