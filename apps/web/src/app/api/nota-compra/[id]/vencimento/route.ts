// POST /api/nota-compra/[id]/vencimento
// Pedido sem nota (PEDIDO_FOTO) ou nota de serviço (NFSE_PDF) cujo papel não
// trazia vencimento: a entrada grava a parcela na data do pedido/nota. Aqui quem
// deu a entrada diz o dia certo do pagamento.
//
// Body: { dataVencimento: 'YYYY-MM-DD' }
//
// Só vale pra entrada de UMA parcela. Troca o vencimento da parcela e, se a
// conta a pagar já nasceu DESSA entrada e ainda está em aberto (sem baixa, fora
// de borderô), troca o dela também. Conta que já existia digitada na mão e foi
// só aproveitada não é mexida — o aviso diz isso.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data invalida'),
});

const brData = (ymd: string) => ymd.split('-').reverse().join('/');

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'informe a data do vencimento' }, { status: 400 });
  const { dataVencimento } = parsed.data;
  const [a, m, d] = dataVencimento.split('-').map(Number);
  const conf = new Date(Date.UTC(a!, m! - 1, d!));
  if (conf.getUTCFullYear() !== a || conf.getUTCMonth() !== m! - 1 || conf.getUTCDate() !== d || a! < 2020 || a! > 2100) {
    return NextResponse.json({ error: 'data do vencimento inválida' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      origemImportacao: schema.notaCompra.origemImportacao,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, nota.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (nota.origemImportacao !== 'PEDIDO_FOTO' && nota.origemImportacao !== 'NFSE_PDF') {
    return NextResponse.json(
      { error: 'só vale pra pedido sem nota e nota de serviço — NF-e usa o vencimento da própria nota' },
      { status: 400 },
    );
  }

  const duplicatas = await db
    .select({ id: schema.notaCompraDuplicata.id, contaPagarId: schema.notaCompraDuplicata.contaPagarId })
    .from(schema.notaCompraDuplicata)
    .where(eq(schema.notaCompraDuplicata.notaCompraId, id));
  if (duplicatas.length !== 1) {
    return NextResponse.json(
      {
        error:
          duplicatas.length === 0
            ? 'esta entrada não tem parcela gravada'
            : 'esta entrada tem mais de uma parcela — ajuste o vencimento de cada conta no financeiro',
      },
      { status: 409 },
    );
  }
  const dup = duplicatas[0]!;

  await db.update(schema.notaCompraDuplicata).set({ dataVencimento }).where(eq(schema.notaCompraDuplicata.id, dup.id));

  let contaAtualizada = false;
  let aviso: string | null = null;
  if (dup.contaPagarId) {
    const [conta] = await db
      .select({
        id: schema.contaPagar.id,
        notaCompraId: schema.contaPagar.notaCompraId,
        dataPagamento: schema.contaPagar.dataPagamento,
        valorPago: schema.contaPagar.valorPago,
        borderoId: schema.contaPagar.borderoId,
        dataDelete: schema.contaPagar.dataDelete,
      })
      .from(schema.contaPagar)
      .where(eq(schema.contaPagar.id, dup.contaPagarId))
      .limit(1);
    if (!conta || conta.dataDelete) {
      aviso = 'a conta a pagar desta entrada não existe mais';
    } else if (conta.notaCompraId !== id) {
      aviso = 'a conta a pagar já existia digitada na mão — o vencimento dela não foi mexido, confira no financeiro';
    } else if (conta.dataPagamento || Number(conta.valorPago ?? 0) > 0) {
      aviso = 'a conta a pagar já tem baixa — o vencimento dela não foi mexido';
    } else if (conta.borderoId) {
      aviso = 'a conta a pagar já está num borderô — o vencimento dela não foi mexido';
    } else {
      await db.update(schema.contaPagar).set({ dataVencimento }).where(eq(schema.contaPagar.id, conta.id));
      contaAtualizada = true;
    }
  }

  const mensagem = contaAtualizada
    ? `vencimento salvo: ${brData(dataVencimento)} (conta a pagar atualizada)`
    : aviso
      ? `vencimento ${brData(dataVencimento)} salvo na entrada — ${aviso}`
      : `vencimento salvo: ${brData(dataVencimento)} — a conta a pagar nasce com esse dia quando a entrada for lançada`;

  return NextResponse.json({ ok: true, dataVencimento, contaAtualizada, aviso, mensagem });
}
