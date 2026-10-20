// POST /api/financeiro/pedidos-pix/conferir — confere no Inter um Pix enviado
// pelo sistema. Pago → dá a baixa nas contas. Recusado → libera as contas.
// acao 'liberar': o dono conferiu no app do Inter que o Pix NÃO saiu (só pra
// Pix sem código do Inter, quando a resposta se perdeu). acao 'saiu': conferiu
// que saiu → baixa. (20/10/2026)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { classificarStatusPixInter, consultarPagamentoPixInter, resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { baixarContasDoPix, podePagarPix } from '@/lib/pix-pagamento';
import { dateToBrYmd } from '@/lib/datas';

export const dynamic = 'force-dynamic';

const Body = z.object({
  id: z.string().uuid(),
  acao: z.enum(['conferir', 'liberar', 'saiu']).default('conferir'),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) {
    return NextResponse.json({ error: 'Só o Admin mexe nos Pix enviados pelo sistema.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });

  const [p] = await db.select().from(schema.pixPagamento).where(eq(schema.pixPagamento.id, parsed.data.id)).limit(1);
  if (!p) return NextResponse.json({ error: 'Pix não encontrado' }, { status: 404 });
  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, p.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  if (p.baixadoEm) return NextResponse.json({ ok: true, status: 'PAGO', mensagem: 'Já está pago e baixado.' });

  const marcarPor = `${user.email ?? user.id} em ${new Date().toISOString()}`;

  if (parsed.data.acao === 'liberar') {
    if (p.codigoSolicitacao) {
      return NextResponse.json({ error: 'Este Pix tem código do Inter: use "Conferir no Inter".' }, { status: 400 });
    }
    await db
      .update(schema.pixPagamento)
      .set({ status: 'ERRO', erro: `Marcado como NÃO saiu (conferido no app do Inter) por ${marcarPor}`, atualizadoEm: new Date() })
      .where(eq(schema.pixPagamento.id, p.id));
    return NextResponse.json({ ok: true, status: 'ERRO', mensagem: 'Contas liberadas. Nenhuma baixa feita.' });
  }
  if (parsed.data.acao === 'saiu') {
    await db
      .update(schema.pixPagamento)
      .set({ erro: `Marcado como SAIU (conferido no app do Inter) por ${marcarPor}`, atualizadoEm: new Date() })
      .where(eq(schema.pixPagamento.id, p.id));
    const { baixadas } = await baixarContasDoPix(p.id);
    return NextResponse.json({ ok: true, status: 'PAGO', mensagem: `Baixa feita em ${baixadas} conta(s).` });
  }

  if (!p.codigoSolicitacao) {
    return NextResponse.json(
      {
        error:
          'O Inter não devolveu código pra este Pix (a resposta se perdeu). Confira no app do Inter e use "Saiu" ou "Não saiu".',
      },
      { status: 400 },
    );
  }
  const cred = resolverCredenciaisInterPagamentos(p.filialId);
  if (!cred) return NextResponse.json({ error: 'Integração de pagamentos do Inter não configurada.' }, { status: 400 });

  let consulta;
  try {
    consulta = await consultarPagamentoPixInter(cred, p.codigoSolicitacao);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const t = consulta.transacaoPix ?? {};
  const statusInter = String(t.status ?? '');
  const nosso = classificarStatusPixInter(statusInter);
  await db
    .update(schema.pixPagamento)
    .set({ statusInter: statusInter || null, endToEndId: t.endToEnd ?? p.endToEndId, retorno: consulta as object, atualizadoEm: new Date() })
    .where(eq(schema.pixPagamento.id, p.id));

  if (nosso === 'PAGO') {
    const mov = t.dataHoraMovimento ? new Date(t.dataHoraMovimento) : null;
    const data = mov && !Number.isNaN(mov.getTime()) ? dateToBrYmd(mov) : null;
    const { baixadas } = await baixarContasDoPix(p.id, data);
    return NextResponse.json({ ok: true, status: 'PAGO', mensagem: `Pix pago (${statusInter}). Baixa feita em ${baixadas} conta(s).` });
  }
  if (nosso === 'ERRO') {
    const motivo = (t.erros ?? []).map((x) => x.descricaoErro ?? x.codigoErro).filter(Boolean).join('; ');
    await db
      .update(schema.pixPagamento)
      .set({ status: 'ERRO', erro: `Inter: ${statusInter}${motivo ? ` — ${motivo}` : ''}`, atualizadoEm: new Date() })
      .where(eq(schema.pixPagamento.id, p.id));
    return NextResponse.json({ ok: true, status: 'ERRO', mensagem: `O Pix não saiu (${statusInter}${motivo ? `: ${motivo}` : ''}). Contas liberadas.` });
  }
  return NextResponse.json({
    ok: true,
    status: p.status,
    mensagem: `Ainda não concluído no Inter (${statusInter || 'sem status'}). ${statusInter.includes('APROVA') ? 'Falta aprovar no app do Inter.' : ''}`.trim(),
  });
}
