// POST /api/financeiro/conta-consumo/pagar — paga pelo Inter a conta de
// consumo (energia, água, gás…) ou boleto que não chega no DDA: pelo código
// de barras / linha digitável (API de pagamento de boleto) ou pelo Pix
// copia-e-cola do QR da conta. Pedido do dono 23/11/2026.
//
// Segurança (mesmo molde do "💸 Pagar" Pix, rota pedidos-pix/pagar):
//  - só quem manda Pix pelo sistema (podePagarPix — Admin);
//  - o código é lido de novo AQUI (dígitos verificadores / CRC do Pix); o
//    valor confirmado na tela tem que bater com o do código;
//  - nada de pagar 2x: o mesmo código já pago ou saindo por esta tela é
//    recusado; boleto: antes de mandar, procura no Inter se esse código de
//    barras já foi pago/agendado (por esta tela, pelo app ou pelo borderô);
//    conta a pagar ligada tem que estar em aberto;
//  - mesma trava por casa do Pix (pix_pagamento:<casa>) e o saldo livre
//    desconta os Pix e as contas de consumo sem desfecho;
//  - a linha nasce ENVIANDO antes de chamar o banco; o id é a idempotência;
//    resposta perdida fica ENVIANDO (conferir no Inter).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import {
  buscarPagamentoBoletoInter,
  classificarStatusBoletoInter,
  incluirPagamentoBoletoInter,
  incluirPagamentoPixCopiaColaInter,
  InterPixRecusado,
  InterSaldoErro,
  resolverCredenciaisInterPagamentos,
} from '@/lib/inter';
import { lerSaldoParaPix, podePagarPix, sincronizarPixAbertos } from '@/lib/pix-pagamento';
import { baixarContaConsumo, consumoComprometido, pagamentoDoMesmoCodigo, sincronizarContasConsumo } from '@/lib/conta-consumo-pagamento';
import { lerCodigoConta } from '@/lib/conta-consumo';
import { diasAtrasBr, hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const Body = z.object({
  filialId: z.string().uuid(),
  codigo: z.string().min(20).max(600),
  valorConfirmado: z.number().positive(),
  dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contaPagarId: z.string().uuid().nullable().optional(),
  descricao: z.string().max(140).optional(),
});

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) {
    return NextResponse.json({ error: 'Só o Admin pode pagar conta pelo sistema.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { filialId, valorConfirmado } = parsed.data;
  const contaPagarId = parsed.data.contaPagarId ?? null;
  const hoje = hojeBr();
  const dataPagamento = parsed.data.dataPagamento ?? hoje;
  if (dataPagamento < hoje) return NextResponse.json({ error: 'Data de pagamento no passado.' }, { status: 400 });

  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, filialId))) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });

  const cred = resolverCredenciaisInterPagamentos(filialId);
  if (!cred) return NextResponse.json({ error: 'Esta casa não tem a integração de pagamentos do Inter configurada.' }, { status: 400 });

  const lido = lerCodigoConta(parsed.data.codigo);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const dado = lido.dado;
  if (dado.tipo === 'PIX' && dataPagamento !== hoje) {
    return NextResponse.json({ error: 'Pix copia-e-cola sai na hora — não dá pra agendar.' }, { status: 400 });
  }
  // Valor: o do código manda. Código sem valor (Pix dinâmico, convênio sem
  // valor) usa o digitado.
  const valor = Math.round((dado.valor ?? valorConfirmado) * 100) / 100;
  if (Math.abs(valor - valorConfirmado) > 0.005) {
    return NextResponse.json({ error: `O código é de ${brl(valor)}, não ${brl(valorConfirmado)}.` }, { status: 409 });
  }
  const chaveDobro = dado.tipo === 'BOLETO' ? dado.codigoBarras : dado.codigo;

  // Conta a pagar ligada: desta casa, em aberto.
  let descricaoConta: string | null = null;
  if (contaPagarId) {
    const [conta] = await db
      .select({ id: schema.contaPagar.id, descricao: schema.contaPagar.descricao })
      .from(schema.contaPagar)
      .where(
        and(
          eq(schema.contaPagar.id, contaPagarId),
          eq(schema.contaPagar.filialId, filialId),
          isNull(schema.contaPagar.dataPagamento),
          isNull(schema.contaPagar.dataDelete),
        ),
      )
      .limit(1);
    if (!conta) return NextResponse.json({ error: 'A conta a pagar escolhida já foi paga, excluída ou não é desta casa.' }, { status: 409 });
    descricaoConta = conta.descricao;
  }

  // Desfecho dos anteriores antes do saldo (o que já saiu não fica no comprometido).
  await sincronizarPixAbertos(filialId, cred).catch(() => null);
  await sincronizarContasConsumo(filialId, cred, 6_000).catch(() => null);

  // Boleto: já pago no Inter por outro caminho (app, borderô, outra tela)?
  if (dado.tipo === 'BOLETO') {
    try {
      const ja = await buscarPagamentoBoletoInter(cred, {
        dataInicio: diasAtrasBr(90),
        dataFim: diasAtrasBr(-60),
        codigoBarras: dado.codigoBarras,
      });
      const vivo = ja.find((p) => {
        const c = classificarStatusBoletoInter(p.statusPagamento);
        return c !== 'ERRO' && (p.codigoBarra ?? '').replace(/\D/g, '') === dado.codigoBarras;
      });
      if (vivo) {
        return NextResponse.json(
          {
            error: `Esse código de barras já está no Inter (${vivo.statusPagamento ?? 'pago'}${vivo.dataPagamento ? ` em ${vivo.dataPagamento.slice(0, 10).split('-').reverse().join('/')}` : ''}). NÃO foi pago de novo.`,
          },
          { status: 409 },
        );
      }
    } catch (e) {
      // sem conseguir conferir, não paga (pode ser a 2ª vez)
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Não deu pra conferir no Inter se esse boleto já foi pago, então NÃO foi pago. ${/scope|escopo|401|403/i.test(msg) ? 'A integração desta casa precisa da permissão "Pagamento de boleto" (leitura e escrita).' : msg.slice(0, 200)}` },
        { status: 503 },
      );
    }
  }

  const favorecido =
    dado.tipo === 'PIX' ? dado.favorecido : dado.especie === 'CONVENIO' ? (dado.segmento ?? 'Conta de consumo') : 'Boleto';
  const descricao = (parsed.data.descricao?.trim() || descricaoConta || `${favorecido ?? 'Conta'} ${brl(valor)}`).slice(0, 140);

  const resultado = await db.transaction(async (tx) => {
    // mesma trava do Pix: os dois saem do mesmo saldo
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'pix_pagamento:' + filialId}))`);
    const dobro = await pagamentoDoMesmoCodigo(filialId, dado.tipo, chaveDobro, tx);
    if (dobro) return { tipo: 'dobro' as const, dobro };
    if (contaPagarId) {
      const presa = (await tx.execute(sql`
        SELECT id FROM conta_consumo_pagamento
         WHERE conta_pagar_id = ${contaPagarId}::uuid
           AND (status IN ('ENVIANDO','APROVACAO','AGENDADO') OR (status = 'PAGO' AND baixado_em IS NULL))
         LIMIT 1`)) as unknown as unknown[];
      if (presa.length) return { tipo: 'presa' as const };
    }
    let livre: number;
    let disponivel: number;
    let comp: { valor: number; qtd: number };
    try {
      const s = await lerSaldoParaPix(filialId, cred, tx);
      comp = await consumoComprometido(filialId, tx);
      disponivel = s.disponivel;
      livre = Math.round((s.livre - comp.valor) * 100) / 100;
    } catch (e) {
      return { tipo: 'saldo_erro' as const, erro: e };
    }
    // agendado pra outro dia não precisa do saldo de hoje
    if (dataPagamento === hoje && Math.round(livre * 100) < Math.round(valor * 100)) {
      return { tipo: 'sem_saldo' as const, livre, disponivel };
    }
    const [linha] = await tx
      .insert(schema.contaConsumoPagamento)
      .values({
        filialId,
        tipo: dado.tipo,
        codigo: dado.codigo,
        codigoBarras: dado.tipo === 'BOLETO' ? dado.codigoBarras : null,
        favorecido: favorecido ?? null,
        valor: valor.toFixed(2),
        dataVencimento: dado.tipo === 'BOLETO' ? dado.vencimento : null,
        dataPagamento,
        contaPagarId,
        descricao,
        status: 'ENVIANDO',
        usuarioId: user.id,
        usuarioEmail: user.email ?? null,
      })
      .returning({ id: schema.contaConsumoPagamento.id });
    return { tipo: 'criado' as const, id: linha!.id };
  });

  if (resultado.tipo === 'dobro') {
    return NextResponse.json(
      { error: `Esse código já foi ${resultado.dobro.status === 'PAGO' ? 'PAGO' : 'mandado'} por esta tela (${resultado.dobro.criado_em.slice(0, 16).replace('T', ' ')}). NÃO foi pago de novo. Confira a lista abaixo.` },
      { status: 409 },
    );
  }
  if (resultado.tipo === 'presa') {
    return NextResponse.json({ error: 'Essa conta a pagar já está num pagamento sem desfecho. Confira a lista abaixo.' }, { status: 409 });
  }
  if (resultado.tipo === 'saldo_erro') {
    const e = resultado.erro;
    const msg = e instanceof Error ? e.message : String(e);
    const st = e instanceof InterSaldoErro ? e.status : 0;
    const semEscopo = st === 401 || st === 403 || /scope|escopo|invalid_client|unauthorized/i.test(msg);
    return NextResponse.json(
      {
        error: semEscopo
          ? 'Não deu pra conferir o saldo: a integração de pagamentos desta casa no Inter não tem a permissão "Consultar extrato e saldo". NADA foi pago.'
          : `Não deu pra conferir o saldo no Inter, então NADA foi pago. Tente de novo. (${msg.slice(0, 200)})`,
      },
      { status: 503 },
    );
  }
  if (resultado.tipo === 'sem_saldo') {
    return NextResponse.json(
      {
        error: `Sem saldo livre no Inter — NADA foi pago. Disponível: ${brl(resultado.disponivel)}; livre (tirando Pix e contas ainda sem desfecho): ${brl(resultado.livre)}. Esta conta: ${brl(valor)}.`,
      },
      { status: 409 },
    );
  }
  const id = resultado.id;
  const atualizar = (campos: Partial<typeof schema.contaConsumoPagamento.$inferInsert>) =>
    db
      .update(schema.contaConsumoPagamento)
      .set({ ...campos, atualizadoEm: new Date() })
      .where(eq(schema.contaConsumoPagamento.id, id));

  try {
    if (dado.tipo === 'BOLETO') {
      const resp = await incluirPagamentoBoletoInter(cred, {
        codigo: dado.codigo,
        valor,
        dataPagamento,
        dataVencimento: dado.vencimento ?? (dado.especie === 'CONVENIO' ? dataPagamento : null),
        idempotencia: id,
      });
      const st = String(resp.statusPagamento ?? '').toUpperCase();
      const nosso = classificarStatusBoletoInter(st);
      await atualizar({
        statusInter: st || null,
        codigoInter: resp.codigoTransacao ?? null,
        retorno: resp as object,
        status: nosso === 'APROVACAO' ? 'APROVACAO' : nosso === 'AGENDADO' || dataPagamento > hoje ? 'AGENDADO' : 'ENVIANDO',
      });
      if (nosso === 'PAGO' && dataPagamento === hoje) {
        const { baixada } = await baixarContaConsumo(id, hoje);
        return NextResponse.json({ ok: true, status: 'PAGO', mensagem: `Pago no Inter: ${brl(valor)}.${baixada ? ' Baixa feita na conta a pagar.' : ''}` });
      }
      if (nosso === 'APROVACAO') {
        return NextResponse.json({ ok: true, status: 'APROVACAO', mensagem: `Pagamento de ${brl(valor)} criado no Inter, esperando APROVAÇÃO no app do Inter. Depois clique em "Conferir no Inter".` });
      }
      if (dataPagamento > hoje || nosso === 'AGENDADO') {
        return NextResponse.json({ ok: true, status: 'AGENDADO', mensagem: `Agendado no Inter pra ${dataPagamento.split('-').reverse().join('/')}: ${brl(valor)}.` });
      }
      return NextResponse.json({ ok: true, status: 'ENVIANDO', mensagem: `O Inter recebeu (status "${st || 'sem status'}"). Clique em "Conferir no Inter" pra confirmar e dar a baixa.` });
    }
    const resp = await incluirPagamentoPixCopiaColaInter(cred, { valor, pixCopiaECola: dado.codigo, descricao, idempotencia: id });
    const tipo = String(resp.tipoRetorno ?? '').toUpperCase();
    await atualizar({
      statusInter: tipo || null,
      codigoInter: resp.codigoSolicitacao ?? null,
      endToEndId: resp.endToEndId ?? null,
      retorno: resp as object,
      status: tipo === 'APROVACAO' ? 'APROVACAO' : tipo === 'AGENDADO' ? 'AGENDADO' : 'ENVIANDO',
    });
    if (tipo === 'PROCESSADO') {
      const { baixada } = await baixarContaConsumo(id, resp.dataPagamento ?? hoje);
      return NextResponse.json({ ok: true, status: 'PAGO', mensagem: `Pix de ${brl(valor)} pago pra ${favorecido ?? 'o favorecido'}.${baixada ? ' Baixa feita na conta a pagar.' : ''}` });
    }
    if (tipo === 'APROVACAO') {
      return NextResponse.json({ ok: true, status: 'APROVACAO', mensagem: `Pix de ${brl(valor)} criado no Inter, esperando APROVAÇÃO no app do Inter. Depois clique em "Conferir no Inter".` });
    }
    return NextResponse.json({ ok: true, status: 'ENVIANDO', mensagem: `O Inter recebeu o Pix (retorno "${tipo || 'sem tipo'}"). Clique em "Conferir no Inter".` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof InterPixRecusado) {
      await atualizar({ status: 'ERRO', erro: msg.slice(0, 1000), retorno: (e.detalhe ?? null) as object | null });
      const semEscopo = e.status === 401 || e.status === 403 || /scope|escopo|invalid_client|unauthorized/i.test(msg);
      return NextResponse.json(
        {
          error: semEscopo
            ? `O Inter não deixou: a integração de pagamentos desta casa não tem a permissão "${dado.tipo === 'BOLETO' ? 'Pagamento de boleto' : 'Pagamento Pix'}" (escrita e leitura). Ligue no Internet Banking do Inter → Integrações. Nenhum dinheiro saiu.`
            : `O Inter recusou. Nenhum dinheiro saiu. ${msg}`,
        },
        { status: 400 },
      );
    }
    await atualizar({ erro: msg.slice(0, 1000) });
    return NextResponse.json(
      { pendente: true, error: 'O Inter não respondeu. PODE ter sido pago: confira no app do Inter antes de tentar de novo (esse código fica travado até conferir na lista abaixo).' },
      { status: 202 },
    );
  }
}
