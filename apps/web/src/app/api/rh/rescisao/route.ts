// Rescisão → conta a pagar (26/10/2026) — regra em lib/rh/rescisao.ts.
// POST { acao: 'ler', documentoId } → o que a IA leu do TRCT + proposta (valor, vencimento)
// POST { acao: 'lancar', documentoId, valor, vencimento, descricao? } → cria a conta a pagar
//      na casa da lotação, liga ao documento (não deixa lançar duas vezes).
// Precisa de 'funcionario.desligar' e, pra lançar, 'conta_pagar.create'.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { lerRescisao, vencimentoRescisao, TIPOS_DOC_RESCISAO, type RescisaoLida } from '@/lib/rh/rescisao';
import { empregadorEbDoFuncionario } from '@/lib/rh/rescisao-empregador';
import { lancarContaRescisao } from '@/lib/rh/rescisao-lancar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('ler'), documentoId: z.string().uuid() }),
  z.object({
    acao: z.literal('lancar'),
    documentoId: z.string().uuid(),
    valor: z.number().positive().max(1_000_000),
    vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    descricao: z.string().trim().max(200).optional(),
  }),
]);

export async function POST(req: Request) {
  const auth = await exigirPermApi('funcionario.read');
  if (auth.error) return auth.error;
  const user = auth.user;
  const semPerm = await negarSemPerm(user.id, 'funcionario.desligar');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;

  const t = schema.funcionarioDocumento;
  const f = schema.funcionario;
  const [doc] = await db
    .select({
      id: t.id,
      tipo: t.tipo,
      momento: t.momento,
      arquivoPath: t.arquivoPath,
      arquivoNome: t.arquivoNome,
      contaPagarId: t.contaPagarId,
      dados: t.dados,
      funcionarioId: f.id,
      filialId: f.filialId,
      nome: f.nome,
      cpf: f.cpf,
      fornecedorId: f.fornecedorId,
      dataDesligamento: f.dataDesligamento,
    })
    .from(t)
    .innerJoin(f, eq(f.id, t.funcionarioId))
    .where(and(eq(t.id, d.documentoId), isNull(t.canceladoEm)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
  if (doc.momento !== 'desligamento' || !TIPOS_DOC_RESCISAO.includes(doc.tipo)) {
    return NextResponse.json({ error: 'só o termo de rescisão / recibo de acerto vira conta a pagar' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((x) => x.id === doc.filialId)) {
    return NextResponse.json({ error: 'sem acesso à casa da lotação desse funcionário' }, { status: 403 });
  }
  if (doc.contaPagarId) {
    return NextResponse.json({ error: 'esse documento já virou conta a pagar', contaPagarId: doc.contaPagarId }, { status: 409 });
  }

  if (d.acao === 'ler') {
    let lida: RescisaoLida;
    try {
      lida = await lerRescisao(doc.arquivoPath, doc.arquivoNome);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 422 });
    }
    await db.update(t).set({ dados: lida }).where(eq(t.id, doc.id));
    const avisos: string[] = [];
    if (lida.aviso) avisos.push(lida.aviso);
    if (lida.cpf && doc.cpf && lida.cpf !== doc.cpf) avisos.push(`CPF do termo (${lida.cpf}) é diferente do cadastro (${doc.cpf}).`);
    if (!lida.liquido) avisos.push('Não li o valor líquido — digite.');
    if (!lida.dataLimite) avisos.push('O termo não traz data de pagamento: vencimento = afastamento + 10 dias (CLT art. 477).');
    const eb = await empregadorEbDoFuncionario(doc.funcionarioId, doc.cpf).catch(() => null);
    if (eb) {
      avisos.push(
        `Empregado da E.B. Serviços (folha do contador ${eb.competencia}): a casa NÃO paga o funcionário — lança "Repasse E.B." na casa (Pix pra E.B.) e a conta da rescisão pra pessoa fica na E.B.`,
      );
    } else if (!doc.fornecedorId) avisos.push('Funcionário sem cadastro de quem recebe (fornecedor) — a conta sai sem favorecido.');
    return NextResponse.json({
      lida,
      proposta: {
        valor: lida.liquido,
        vencimento: vencimentoRescisao(lida, doc.dataDesligamento),
        descricao: `Rescisão — ${doc.nome}`,
      },
      avisos,
    });
  }

  const semPermConta = await negarSemPerm(user.id, 'conta_pagar.create');
  if (semPermConta) return semPermConta;

  try {
    const r = await lancarContaRescisao(doc, {
      valor: d.valor,
      vencimento: d.vencimento,
      descricao: d.descricao,
      usuarioId: user.id,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if ((e as Error).message === 'JA_LANCADA') {
      return NextResponse.json({ error: 'esse documento já virou conta a pagar' }, { status: 409 });
    }
    throw e;
  }
}
