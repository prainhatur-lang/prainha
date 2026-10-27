// POST /api/financeiro/pedidos-pix/pagar — manda o Pix pelo Inter e, se o
// banco processar na hora, dá a baixa na conta. Pedido do dono (20/10/2026).
// UM Pix POR CONTA (nota/pedido): o dono quer saber o que pagou o quê, então
// nada de juntar valores num Pix só.
//
// Segurança:
//  - quem manda dinheiro: podePagarPix (Admin ou conta_pagar.pagar_pix);
//  - valor e chave saem do servidor (saldo das contas + cadastro do
//    fornecedor); o valor digitado na confirmação tem que bater;
//  - a linha nasce ENVIANDO antes de chamar o banco, com trava por casa, e a
//    conta que já está num Pix sem desfecho é recusada (nada de pagar 2x);
//  - resposta perdida (rede/timeout/5xx) fica ENVIANDO: conferir no Inter;
//  - SALDO (pedido do dono 22/10/2026): dentro da mesma trava, antes de criar
//    a linha, lê o saldo de agora no Inter menos os Pix do sistema sem
//    desfecho. Faltou saldo → não manda (409). Não deu pra ler o saldo → não
//    manda (503). Só depois disso o Pix vai pro banco.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { consultarPagamentoPixInter, incluirPagamentoPixInter, InterPixRecusado, InterSaldoErro, resolverCredenciaisInterPagamentos } from '@/lib/inter';
import { conferirChavePix, recebedorBate } from '@/lib/pix-titular';
import { rescisoesDasContas } from '@/lib/rh/rescisao-pix';
import { baixarContasDoPix, lerSaldoParaPix, podePagarPix, sincronizarPixAbertos, type SaldoParaPix } from '@/lib/pix-pagamento';

export const dynamic = 'force-dynamic';
// 90: saldo (até ~12 s) + envio do Pix (até 45 s) + banco.
export const maxDuration = 90;

const ORIGENS_FORA = ['CONSUMER', 'FOLHA', 'TRANSFERENCIA', 'ENCONTRO_CONTAS'];

const Body = z.object({
  filialId: z.string().uuid(),
  fornecedorId: z.string().uuid(),
  contaIds: z.array(z.string().uuid()).length(1),
  valorConfirmado: z.number().positive(),
});

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) {
    return NextResponse.json({ error: 'Só o Admin pode mandar Pix pelo sistema.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { filialId, fornecedorId, valorConfirmado } = parsed.data;
  const contaIds = [...new Set(parsed.data.contaIds)];

  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });

  const cred = resolverCredenciaisInterPagamentos(filialId);
  if (!cred) {
    return NextResponse.json({ error: 'Esta casa não tem a integração de pagamentos do Inter configurada.' }, { status: 400 });
  }

  const [forn] = await db
    .select({
      nome: schema.fornecedor.nome,
      chave: schema.fornecedor.chavePix,
      favorecido: schema.fornecedor.pixFavorecido,
      doc: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!forn) return NextResponse.json({ error: 'Fornecedor não encontrado.' }, { status: 400 });
  // Rescisão (26/10/2026): conta ligada ao termo na ficha do funcionário. Sem
  // chave no cadastro, o Pix sai pelo CPF do próprio funcionário.
  const rescisoes = await rescisoesDasContas(contaIds);
  const cpfRescisao = contaIds.map((id) => rescisoes.get(id)?.cpf).find(Boolean) ?? null;
  const chave = forn.chave?.trim() || cpfRescisao;
  if (!chave) return NextResponse.json({ error: 'Fornecedor sem chave Pix cadastrada.' }, { status: 400 });
  // Documento pra conferir a chave: o do cadastro; na rescisão sem documento, o CPF do funcionário.
  const docConferir = forn.doc?.trim() || cpfRescisao;
  // Anti-fraude (pedido do dono 22/10/2026): chave CPF/CNPJ de OUTRA pessoa ou
  // empresa, sem "quem recebe" declarado no cadastro, não recebe Pix.
  const conf = conferirChavePix({ chave, docFornecedor: docConferir, favorecido: forn.favorecido });
  if (conf?.nivel === 'diverge') {
    return NextResponse.json(
      {
        error: `${conf.msg} O Pix NÃO foi enviado. Corrija a chave no cadastro do fornecedor, ou preencha "quem recebe" se o Pix cai mesmo nessa pessoa.`,
      },
      { status: 409 },
    );
  }

  const c = schema.contaPagar;
  const contas = await db
    .select({
      id: c.id,
      valor: c.valor,
      origem: c.origem,
      descricao: c.descricao,
      venc: sql<string>`to_char(${c.dataVencimento}, 'DD/MM')`,
      fornecedorId: c.fornecedorId,
      jaPago: sql<string>`coalesce((select sum(b.valor) from conta_pagar_baixa b where b.conta_pagar_id = ${c.id}), 0)::text`,
    })
    .from(c)
    .where(and(inArray(c.id, contaIds), eq(c.filialId, filialId), isNull(c.dataPagamento), isNull(c.dataDelete), isNull(c.borderoId)));
  if (contas.length !== contaIds.length) {
    return NextResponse.json({ error: 'Alguma conta já foi paga, excluída, está num borderô da folha ou não é desta casa. Recarregue a tela.' }, { status: 409 });
  }
  if (contas.some((x) => x.fornecedorId !== fornecedorId || (ORIGENS_FORA.includes(x.origem ?? '') && !rescisoes.has(x.id)))) {
    return NextResponse.json({ error: 'Conta de outro fornecedor ou que não se paga por aqui.' }, { status: 400 });
  }
  const itens = contas.map((x) => ({ id: x.id, valor: Math.round((Number(x.valor) - Number(x.jaPago)) * 100) / 100 }));
  if (itens.some((i) => i.valor <= 0)) {
    return NextResponse.json({ error: 'Conta sem saldo em aberto. Recarregue a tela.' }, { status: 409 });
  }
  const total = Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100;
  if (Math.abs(total - valorConfirmado) > 0.005) {
    return NextResponse.json(
      { error: `O valor em aberto é ${brl(total)}, não ${brl(valorConfirmado)}. Recarregue a tela.` },
      { status: 409 },
    );
  }

  // Trava por casa + confere conta presa + confere saldo + cria a linha
  // ENVIANDO, tudo junto. O saldo fica dentro da trava: dois Pix da mesma casa
  // ao mesmo tempo não passam os dois no mesmo saldo (o primeiro já entra no
  // comprometido do segundo).
  // Pix anteriores já resolvidos no Inter (aprovados no app) saem do
  // comprometido antes da conta do saldo (27/10/2026). Fora da trava: a baixa
  // é uma vez só (baixado_em) e não briga com outro pedido.
  await sincronizarPixAbertos(filialId, cred).catch(() => null);

  const conta0 = contas[0]!;
  const descricao = `${forn.nome} - ${conta0.descricao ?? 'pedido'} (venc ${conta0.venc})`.slice(0, 140);
  const resultado = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'pix_pagamento:' + filialId}))`);
    const presas = (await tx.execute(sql`
      SELECT p.id FROM pix_pagamento p, jsonb_array_elements(p.conta_ids) e
       WHERE p.filial_id = ${filialId}::uuid
         AND (p.status IN ('ENVIANDO','APROVACAO','AGENDADO') OR (p.status = 'PAGO' AND p.baixado_em IS NULL))
         AND e->>'id' IN (${sql.join(contaIds.map((id) => sql`${id}`), sql`, `)})
       LIMIT 1
    `)) as unknown as unknown[];
    if (presas.length > 0) return { tipo: 'presa' as const };

    let saldo: SaldoParaPix;
    try {
      saldo = await lerSaldoParaPix(filialId, cred, tx);
    } catch (e) {
      return { tipo: 'saldo_erro' as const, erro: e };
    }
    console.info('[pix-pagar] saldo', { filialId, total, ...saldo });
    if (Math.round(saldo.livre * 100) < Math.round(total * 100)) {
      return { tipo: 'sem_saldo' as const, saldo };
    }

    const [linha] = await tx
      .insert(schema.pixPagamento)
      .values({
        filialId,
        fornecedorId,
        favorecido: forn.favorecido ?? forn.nome,
        contaIds: itens,
        chave,
        valor: total.toFixed(2),
        descricao,
        status: 'ENVIANDO',
        usuarioId: user.id,
        usuarioEmail: user.email ?? null,
      })
      .returning({ id: schema.pixPagamento.id });
    return { tipo: 'criado' as const, linha: linha! };
  });
  if (resultado.tipo === 'presa') {
    return NextResponse.json(
      { error: 'Uma dessas contas já está num Pix enviado pelo sistema. Confira a lista "Pix enviados pelo sistema".' },
      { status: 409 },
    );
  }
  if (resultado.tipo === 'saldo_erro') {
    const e = resultado.erro;
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pix-pagar] saldo não lido — Pix NÃO enviado', { filialId, total, msg });
    const st = e instanceof InterSaldoErro ? e.status : 0;
    const semEscopo = st === 401 || st === 403 || /scope|escopo|invalid_client|unauthorized/i.test(msg);
    return NextResponse.json(
      {
        saldoErro: true,
        error: semEscopo
          ? 'Não deu pra conferir o saldo: a integração de pagamentos desta casa no Inter não tem a permissão "Consultar extrato e saldo". O Pix NÃO foi enviado — nenhum dinheiro saiu.'
          : `Não deu pra conferir o saldo da conta no Inter, então o Pix NÃO foi enviado — nenhum dinheiro saiu. Tente de novo em instantes. (${msg.slice(0, 200)})`,
      },
      { status: 503 },
    );
  }
  if (resultado.tipo === 'sem_saldo') {
    const s = resultado.saldo;
    const falta = Math.round((total - s.livre) * 100) / 100;
    const pendentes =
      s.qtdComprometidos > 0
        ? ` Já tem ${brl(s.comprometido)} em ${s.qtdComprometidos} Pix do sistema sem desfecho (esperando aprovação, agendado ou sem resposta do banco), então o livre é ${brl(s.livre)}. Se algum já saiu, clique em "Conferir no Inter" na lista "Pix enviados pelo sistema".`
        : '';
    return NextResponse.json(
      {
        semSaldo: true,
        saldo: s,
        valor: total,
        falta,
        error: `Sem saldo no Inter pra este Pix — ele NÃO foi enviado, nenhum dinheiro saiu. Saldo disponível agora: ${brl(s.disponivel)}.${pendentes} Este Pix: ${brl(total)}. Falta ${brl(falta)}.`,
      },
      { status: 409 },
    );
  }
  const criado = resultado.linha;

  const atualizar = (campos: Partial<typeof schema.pixPagamento.$inferInsert>) =>
    db
      .update(schema.pixPagamento)
      .set({ ...campos, atualizadoEm: new Date() })
      .where(eq(schema.pixPagamento.id, criado.id));

  let resp;
  try {
    resp = await incluirPagamentoPixInter(cred, { valor: total, chave, descricao, idempotencia: criado.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof InterPixRecusado) {
      await atualizar({ status: 'ERRO', erro: msg.slice(0, 1000), retorno: (e.detalhe ?? null) as object | null });
      const semEscopo = e.status === 401 || e.status === 403 || /scope|escopo|invalid_client|unauthorized/i.test(msg);
      return NextResponse.json(
        {
          error: semEscopo
            ? 'O Inter não deixou: a integração de pagamentos desta casa não tem a permissão "Pagamento Pix" (escrita e leitura). Ligue no Internet Banking do Inter → Integrações. Nenhum dinheiro saiu.'
            : `O Inter recusou o Pix. Nenhum dinheiro saiu. ${msg}`,
        },
        { status: 400 },
      );
    }
    await atualizar({ erro: msg.slice(0, 1000) });
    return NextResponse.json(
      {
        pendente: true,
        error:
          'O Inter não respondeu. O Pix PODE ter saído: confira no app do Inter antes de tentar de novo. As contas ficam travadas até você conferir na lista "Pix enviados pelo sistema".',
      },
      { status: 202 },
    );
  }

  const tipo = String(resp.tipoRetorno ?? '').toUpperCase();
  await atualizar({
    statusInter: tipo || null,
    codigoSolicitacao: resp.codigoSolicitacao ?? null,
    endToEndId: resp.endToEndId ?? null,
    retorno: resp as object,
    status: tipo === 'APROVACAO' ? 'APROVACAO' : tipo === 'AGENDADO' ? 'AGENDADO' : 'ENVIANDO',
  });

  if (tipo === 'PROCESSADO') {
    const { baixadas } = await baixarContasDoPix(criado.id, resp.dataPagamento ?? null);
    // Anti-fraude (22/10/2026): quem RECEBEU de fato. O Inter só diz na
    // consulta (CPF/CNPJ + nome). Fica no retorno pra lista "Pix enviados".
    // Melhor esforço: sem resposta em 8 s, segue sem a conferência.
    let aviso = '';
    if (resp.codigoSolicitacao) {
      try {
        const consulta = await Promise.race([
          consultarPagamentoPixInter(cred, resp.codigoSolicitacao),
          new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
        ]);
        const rec = consulta?.transacaoPix?.recebedor;
        if (consulta?.transacaoPix) {
          await atualizar({ retorno: { ...(resp as object), transacaoPix: consulta.transacaoPix } as object });
        }
        if (rec && recebedorBate({ recebedorDoc: rec.cpfCnpj, docFornecedor: docConferir }) === false) {
          aviso = ` ⚠ ATENÇÃO: quem recebeu foi ${rec.nome ?? '?'} (${rec.cpfCnpj ?? '?'}), que NÃO é o CPF/CNPJ do fornecedor.`;
          console.warn('[pix-pagar] recebedor diferente do fornecedor', { pix: criado.id, fornecedorId });
        }
      } catch (e) {
        console.warn('[pix-pagar] consulta do recebedor falhou', e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({
      ok: true,
      status: 'PAGO',
      mensagem: `Pix de ${brl(total)} enviado pra ${forn.favorecido ?? forn.nome}. Baixa feita em ${baixadas} conta(s).${aviso}`,
    });
  }
  if (tipo === 'APROVACAO') {
    return NextResponse.json({
      ok: true,
      status: 'APROVACAO',
      mensagem: `Pix de ${brl(total)} criado no Inter e esperando APROVAÇÃO no app do Inter. Depois de aprovar, clique em "Conferir no Inter" pra dar a baixa.`,
    });
  }
  if (tipo === 'AGENDADO') {
    return NextResponse.json({
      ok: true,
      status: 'AGENDADO',
      mensagem: `Pix de ${brl(total)} agendado no Inter. A baixa sai quando você conferir depois do pagamento.`,
    });
  }
  return NextResponse.json({
    ok: true,
    status: 'ENVIANDO',
    mensagem: `O Inter recebeu o Pix (retorno "${tipo || 'sem tipo'}"). Clique em "Conferir no Inter" pra confirmar e dar a baixa.`,
  });
}
