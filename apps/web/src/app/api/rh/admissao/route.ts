// Admissão pelo link do WhatsApp — lado do RH (04/11/2026).
// GET  ?filialId=…                         → convites da casa
// POST { acao:'consultar', filialId, cpf } → SPC (regra 7: identificarPorCpf) + cadastro existente
// POST { acao:'criar', filialId, cpf, nome, telefone, termos } → convite + link wa.me
// POST { acao:'cancelar', id }
// Regra em lib/rh/admissao.ts; a pessoa preenche em /op/admissao/<token>.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { cpfValido, consultarCpfSoCache } from '@/lib/spc';
import { identificarPorCpf } from '@/lib/identificar-cpf';
import { novoTokenAssinatura } from '@/lib/rh/assinatura';
import {
  ADMISSAO_VALIDADE_DIAS,
  EMPREGADORES,
  LINK_BASE_ADMISSAO,
  resumoCombinado,
  type TermosConvite,
} from '@/lib/rh/admissao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function acessoFilial(userId: string, filialId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) return false;
  const [l] = await db
    .select({ f: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  return !!l;
}

async function usuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

const soDig = (s: string) => String(s ?? '').replace(/\D/g, '');

/** Telefone no formato do wa.me (55 + DDD + número). */
function foneWa(t: string): string | null {
  let d = soDig(t);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

export async function GET(req: Request) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'funcionario.create');
  if (semPerm) return semPerm;
  const filialId = new URL(req.url).searchParams.get('filialId') ?? '';
  if (!(await acessoFilial(user.id, filialId))) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const C = schema.admissaoConvite;
  const rows = await db
    .select({
      id: C.id,
      cpf: C.cpf,
      nome: C.nome,
      telefone: C.telefone,
      status: C.status,
      termos: C.termos,
      token: C.token,
      expiraEm: C.expiraEm,
      criadoEm: C.criadoEm,
      abertoEm: C.abertoEm,
      assinadoEm: C.assinadoEm,
      funcionarioId: C.funcionarioId,
      assinaturaId: C.assinaturaId,
      documentos: C.documentos,
    })
    .from(C)
    .where(eq(C.filialId, filialId))
    .orderBy(desc(C.criadoEm))
    .limit(100);
  return NextResponse.json({
    convites: rows.map((r) => ({
      ...r,
      link: LINK_BASE_ADMISSAO + r.token,
      token: undefined,
      docs: Array.isArray(r.documentos) ? r.documentos.length : 0,
      documentos: undefined,
      vencido: r.status !== 'assinado' && r.status !== 'cancelado' && r.expiraEm.getTime() < Date.now(),
    })),
  });
}

const Termos = z.object({
  modelo: z.enum(['intermitente', 'experiencia', 'indeterminado']),
  empregadorCnpj: z.string().regex(/^\d{14}$/),
  admissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cargo: z.string().min(2).max(60),
  cbo: z.string().max(10).default(''),
  atividades: z.string().max(2000).default(''),
  valor: z.string().min(1).max(20),
  jornada: z.string().min(2).max(300),
  local: z.string().max(300).default(''),
  expDias: z.string().max(3).default('45'),
  expProrrogacao: z.string().max(3).default('45'),
  setor: z.string().max(20).default(''),
});

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('consultar'), filialId: z.string().uuid(), cpf: z.string(), forcarSpc: z.boolean().optional() }),
  z.object({
    acao: z.literal('criar'),
    filialId: z.string().uuid(),
    cpf: z.string(),
    nome: z.string().min(3).max(200),
    telefone: z.string().min(8).max(20),
    termos: Termos,
    dadosSpc: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ acao: z.literal('cancelar'), id: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'funcionario.create');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  if (b.acao === 'cancelar') {
    const C = schema.admissaoConvite;
    const [c] = await db.select({ filialId: C.filialId, status: C.status }).from(C).where(eq(C.id, b.id)).limit(1);
    if (!c) return NextResponse.json({ error: 'convite não encontrado' }, { status: 404 });
    if (!(await acessoFilial(user.id, c.filialId))) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    if (c.status === 'assinado') return NextResponse.json({ error: 'já foi assinado — o desligamento é pela ficha' }, { status: 409 });
    await db
      .update(C)
      .set({ status: 'cancelado', canceladoEm: new Date(), canceladoPor: user.id })
      .where(and(eq(C.id, b.id), inArray(C.status, ['enviado', 'aberto'])));
    return NextResponse.json({ ok: true });
  }

  if (!(await acessoFilial(user.id, b.filialId))) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  const cpf = soDig(b.cpf);
  if (!cpfValido(cpf)) return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });

  if (b.acao === 'consultar') {
    // Regra 7: toda consulta passa por identificarPorCpf (vira cadastro nas casas).
    const r = await identificarPorCpf(cpf, b.filialId, { usuarioId: user.id, forcarSpc: b.forcarSpc === true });
    const spc = await consultarCpfSoCache(cpf).catch(() => null);
    const F = schema.funcionario;
    const [existente] = await db
      .select({
        id: F.id,
        nome: F.nome,
        ativo: F.ativo,
        filialId: F.filialId,
        casa: schema.filial.nome,
        empresaRegistro: F.empresaRegistro,
        regime: F.regimeSalarial,
        dataAdmissao: F.dataAdmissao,
        dataDesligamento: F.dataDesligamento,
        telefone: F.telefone,
      })
      .from(F)
      .innerJoin(schema.filial, eq(schema.filial.id, F.filialId))
      .where(eq(F.cpf, cpf))
      .limit(1);
    const C = schema.admissaoConvite;
    const [aberto] = await db
      .select({ id: C.id, status: C.status, criadoEm: C.criadoEm })
      .from(C)
      .where(and(eq(C.cpf, cpf), inArray(C.status, ['enviado', 'aberto'])))
      .orderBy(desc(C.criadoEm))
      .limit(1);
    return NextResponse.json({
      fonte: r.fonte,
      spcDisponivel: r.spcDisponivel,
      erroSpc: r.erroSpc ?? null,
      dados: {
        ...r.dados,
        nome: spc?.nome ?? r.dados.nome,
        dataNascimento: r.dados.dataNascimento ?? spc?.nascimento ?? null,
        mae: spc?.mae ?? null,
        pai: spc?.pai ?? null,
        celular: r.dados.celular ?? spc?.telefone ?? null,
      },
      existente: existente
        ? {
            ...existente,
            dataAdmissao: existente.dataAdmissao ?? null,
            dataDesligamento: existente.dataDesligamento ?? null,
          }
        : null,
      conviteAberto: aberto ?? null,
    });
  }

  // criar
  const termos: TermosConvite = { ...b.termos, cbo: b.termos.cbo ?? '', atividades: b.termos.atividades ?? '' };
  if (!EMPREGADORES.some((e) => e.cnpj === termos.empregadorCnpj)) {
    return NextResponse.json({ error: 'empregador desconhecido' }, { status: 400 });
  }
  const valor = Number(termos.valor.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'valor inválido' }, { status: 400 });
  const wa = foneWa(b.telefone);
  if (!wa) return NextResponse.json({ error: 'WhatsApp inválido (DDD + número)' }, { status: 400 });

  const F = schema.funcionario;
  const [ativoOutro] = await db
    .select({ id: F.id, ativo: F.ativo, empresaRegistro: F.empresaRegistro, cnpjRegistro: F.cnpjRegistro })
    .from(F)
    .where(eq(F.cpf, cpf))
    .limit(1);
  if (ativoOutro?.ativo && ativoOutro.cnpjRegistro && ativoOutro.cnpjRegistro !== termos.empregadorCnpj) {
    return NextResponse.json(
      {
        error: `Essa pessoa está ATIVA registrada em ${ativoOutro.empresaRegistro ?? ativoOutro.cnpjRegistro}. Faça o desligamento antes de mandar um contrato por outra empresa.`,
      },
      { status: 409 },
    );
  }

  const token = novoTokenAssinatura();
  const expira = new Date(Date.now() + ADMISSAO_VALIDADE_DIAS * 86400_000);
  const C = schema.admissaoConvite;
  // Convite antigo em aberto do mesmo CPF: cancela (vale o novo).
  await db
    .update(C)
    .set({ status: 'cancelado', canceladoEm: new Date(), canceladoPor: user.id })
    .where(and(eq(C.cpf, cpf), inArray(C.status, ['enviado', 'aberto'])));
  const [conv] = await db
    .insert(C)
    .values({
      filialId: b.filialId,
      funcionarioId: ativoOutro?.id ?? null,
      cpf,
      nome: b.nome.trim(),
      telefone: wa,
      termos,
      dadosSpc: b.dadosSpc ?? null,
      token,
      status: 'enviado',
      expiraEm: expira,
      criadoPor: user.id,
    })
    .returning({ id: C.id });

  const link = LINK_BASE_ADMISSAO + token;
  const primeiro = b.nome.trim().split(/\s+/)[0];
  const texto =
    `Olá, ${primeiro}! Aqui é do RH do Prainha. Pra fazer o seu registro, abra o link abaixo: ` +
    `preencha os seus dados, mande as fotos dos documentos, leia o contrato e assine com uma selfie.\n\n` +
    `Combinado: ${resumoCombinado(termos)}\n\n${link}\n\nO link vale ${ADMISSAO_VALIDADE_DIAS} dias.`;
  return NextResponse.json({
    ok: true,
    id: conv.id,
    link,
    whatsapp: `https://wa.me/${wa}?text=${encodeURIComponent(texto)}`,
  });
}
