// Faturas de mão de obra da E.B. Serviços — ações da tela /eb/faturas:
//   config    percentual de lucro, alíquota do ISS (Simples), base e vencimento
//   gerar     cria (ou refaz, se ainda rascunho) a fatura da casa no mês, pela folha do contador
//   lancar    lança na casa as duas contas a pagar: líquido pra E.B. e guia do ISS retido
//   receber   marca a fatura como recebida pela E.B.
//   cancelar  cancela a fatura (só sem conta lançada na casa)
//   emitir    emite a NFS-e Nacional da fatura (lib/nfse/emitir-eb.ts)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, ne } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import {
  EB_CNPJ,
  MUNICIPIO_ISS,
  configEb,
  discriminacao,
  nomeCompetencia,
  preverFaturas,
} from '@/lib/eb/faturas';
import { emitirNfseFatura } from '@/lib/nfse/emitir-eb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Comp = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('config'),
    percentualLucro: z.number().min(0).max(500),
    aliquotaIss: z
      .number()
      .min(0)
      .max(5, 'O ISS vai no máximo a 5% (LC 116). Na alíquota do ISS vai só a parte do ISS dentro do Simples, não a alíquota total do DAS.')
      .nullable(),
    base: z.enum(['proventos_fgts', 'proventos', 'liquido']),
    diaVencimento: z.number().int().min(1).max(31),
  }),
  z.object({ acao: z.literal('gerar'), competencia: Comp, tomadorFilialId: z.string().uuid() }),
  z.object({ acao: z.literal('lancar'), faturaId: z.string().uuid(), vencimentoIss: Dia }),
  z.object({ acao: z.literal('receber'), faturaId: z.string().uuid(), data: Dia, valor: z.number().positive() }),
  z.object({ acao: z.literal('cancelar'), faturaId: z.string().uuid() }),
  z.object({ acao: z.literal('emitir'), faturaId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'folha_equipe.fechar');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues.find((i) => i.message && !i.message.startsWith('Invalid') && !i.message.startsWith('Too') && !i.message.startsWith('Number'))?.message;
    return NextResponse.json({ error: msg ?? 'dados inválidos' }, { status: 400 });
  }
  const body = parsed.data;

  const cfg = await configEb();
  if (!cfg) return NextResponse.json({ error: 'E.B. não cadastrada (rode migrate:eb-faturas)' }, { status: 500 });
  const casas = new Set((await filiaisDoUsuario(user.id)).map((f) => f.id));

  if (body.acao === 'config') {
    await db
      .update(schema.nfseConfig)
      .set({
        percentualLucro: String(body.percentualLucro),
        aliquotaIss: body.aliquotaIss === null ? null : String(body.aliquotaIss),
        base: body.base,
        diaVencimento: body.diaVencimento,
        atualizadoEm: new Date(),
        atualizadoPor: user.id,
      })
      .where(eq(schema.nfseConfig.filialId, cfg.filialId));
    return NextResponse.json({ ok: true });
  }

  if (body.acao === 'gerar') {
    if (!casas.has(body.tomadorFilialId)) return NextResponse.json({ error: 'casa sem acesso' }, { status: 403 });
    if (cfg.aliquotaIss === null) {
      return NextResponse.json({ error: 'Informe a alíquota do ISS (Simples) antes de gerar.' }, { status: 400 });
    }
    const [prev] = await preverFaturas(body.competencia, [body.tomadorFilialId], cfg);
    if (!prev) return NextResponse.json({ error: 'Sem folha da E.B. dessa casa nesse mês.' }, { status: 400 });

    const [viva] = await db
      .select()
      .from(schema.faturaServico)
      .where(
        and(
          eq(schema.faturaServico.filialId, cfg.filialId),
          eq(schema.faturaServico.tomadorFilialId, body.tomadorFilialId),
          eq(schema.faturaServico.competencia, body.competencia),
          ne(schema.faturaServico.status, 'CANCELADA'),
        ),
      )
      .limit(1);
    if (viva && (viva.status !== 'RASCUNHO' || viva.contaPagarId)) {
      return NextResponse.json({ error: 'Fatura já emitida ou lançada na casa — cancele antes de refazer.' }, { status: 409 });
    }

    const valores = {
      empregados: prev.empregados,
      horas: String(prev.horas),
      proventos: String(prev.proventos),
      fgts: String(prev.fgts),
      liquidoFolha: String(prev.liquidoFolha),
      base: cfg.base,
      valorBase: String(prev.valorBase),
      percentualLucro: String(prev.percentualLucro),
      valorLucro: String(prev.valorLucro),
      valorServico: String(prev.valorServico),
      aliquotaIss: String(prev.aliquotaIss),
      valorIss: String(prev.valorIss),
      valorLiquido: String(prev.valorLiquido),
      vencimento: prev.vencimento,
      discriminacao: discriminacao(prev, body.competencia, MUNICIPIO_ISS[body.tomadorFilialId] ?? 'Aracaju'),
      atualizadoEm: new Date(),
    };
    if (viva) {
      await db.update(schema.faturaServico).set(valores).where(eq(schema.faturaServico.id, viva.id));
      return NextResponse.json({ ok: true, id: viva.id });
    }
    const [nova] = await db
      .insert(schema.faturaServico)
      .values({
        ...valores,
        filialId: cfg.filialId,
        tomadorFilialId: body.tomadorFilialId,
        competencia: body.competencia,
        criadoPor: user.id,
      })
      .returning({ id: schema.faturaServico.id });
    return NextResponse.json({ ok: true, id: nova!.id });
  }

  const [fat] = await db
    .select()
    .from(schema.faturaServico)
    .where(and(eq(schema.faturaServico.id, body.faturaId), eq(schema.faturaServico.filialId, cfg.filialId)))
    .limit(1);
  if (!fat || !casas.has(fat.tomadorFilialId)) {
    return NextResponse.json({ error: 'fatura não encontrada' }, { status: 404 });
  }
  if (fat.status === 'CANCELADA') return NextResponse.json({ error: 'fatura cancelada' }, { status: 409 });

  if (body.acao === 'lancar') {
    if (fat.contaPagarId) return NextResponse.json({ error: 'já lançada na casa' }, { status: 409 });
    const semPermCasa = await negarSemPerm(user.id, 'conta_pagar.create');
    if (semPermCasa) return semPermCasa;
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(and(eq(schema.fornecedor.filialId, fat.tomadorFilialId), eq(schema.fornecedor.cnpjOuCpf, EB_CNPJ)))
      .limit(1);
    const comp = nomeCompetencia(fat.competencia);
    const municipio = MUNICIPIO_ISS[fat.tomadorFilialId] ?? 'Aracaju';
    const agora = new Date();
    const ids = await db.transaction(async (tx) => {
      const [conta] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: fat.tomadorFilialId,
          fornecedorId: forn?.id ?? null,
          dataVencimento: fat.vencimento,
          valor: fat.valorLiquido,
          competencia: fat.competencia,
          descricao: `E.B. Serviços — mão de obra ${comp} (serviço ${fat.valorServico} − ISS retido ${fat.valorIss})`,
          origem: 'MANUAL',
          criadoPor: user.id,
          criadoEm: agora,
        })
        .returning({ id: schema.contaPagar.id });
      let contaIss: { id: string } | undefined;
      if (Number(fat.valorIss) > 0) {
        [contaIss] = await tx
          .insert(schema.contaPagar)
          .values({
            filialId: fat.tomadorFilialId,
            dataVencimento: body.vencimentoIss,
            valor: fat.valorIss,
            competencia: fat.competencia,
            descricao: `ISS retido da E.B. Serviços ${comp} — guia da prefeitura de ${municipio}`,
            origem: 'MANUAL',
            criadoPor: user.id,
            criadoEm: agora,
          })
          .returning({ id: schema.contaPagar.id });
      }
      await tx
        .update(schema.faturaServico)
        .set({ contaPagarId: conta!.id, contaIssId: contaIss?.id ?? null, atualizadoEm: agora })
        .where(eq(schema.faturaServico.id, fat.id));
      return { conta: conta!.id, iss: contaIss?.id ?? null };
    });
    return NextResponse.json({ ok: true, ...ids });
  }

  if (body.acao === 'receber') {
    await db
      .update(schema.faturaServico)
      .set({ recebidoEm: body.data, valorRecebido: String(body.valor), atualizadoEm: new Date() })
      .where(eq(schema.faturaServico.id, fat.id));
    return NextResponse.json({ ok: true });
  }

  if (body.acao === 'emitir') {
    if (Number(fat.aliquotaIss) <= 0) {
      return NextResponse.json({ error: 'Preencha a alíquota do ISS, salve a regra e gere a fatura de novo.' }, { status: 400 });
    }
    const r = await emitirNfseFatura(fat.id);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 422 });
    return NextResponse.json(r);
  }

  // cancelar
  if (fat.contaPagarId) {
    return NextResponse.json({ error: 'Já tem conta lançada na casa — apague as contas antes de cancelar.' }, { status: 409 });
  }
  if (fat.status === 'EMITIDA') {
    return NextResponse.json({ error: 'NFS-e emitida: o cancelamento é na nota.' }, { status: 409 });
  }
  await db
    .update(schema.faturaServico)
    .set({ status: 'CANCELADA', atualizadoEm: new Date() })
    .where(eq(schema.faturaServico.id, fat.id));
  return NextResponse.json({ ok: true });
}
