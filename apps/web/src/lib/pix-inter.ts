// Pix pagos pela conta do Inter × Contas a pagar. A API de pagamentos do Inter
// só traz boleto (tela /financeiro/boletos-inter); o Pix só aparece no extrato
// (lancamento_banco). Conta paga por Pix ficava "em aberto" pra sempre — caso
// da Prainha Mar, 14/10/2026. Esta lib casa cada Pix enviado com UMA conta a
// pagar em aberto, de qualquer casa: mesmo valor do saldo E nome do favorecido
// batendo com o fornecedor. Só valor não basta (o Pix de R$ 6.300 pro
// "Instituto de Tecnologia" casava com a ENERGISA) — esses aparecem como
// "mesmo valor, confira".
//
// Conta de OUTRA casa paga pelo Pix desta: baixa na casa da conta e a dívida
// vai pro encontro de contas (pagamento_entre_casas, origem INTER_PIX), igual
// ao boleto.

import { db, schema } from '@concilia/db';
import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { consumerParado } from '@/lib/consumer-contas';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { RecusaTransf } from '@/lib/transferencia';
import { centavos, somaDias } from '@/lib/boletos-inter';

/** Pix com descrição de pagamento entre as próprias casas (transferência) */
const PIX_CASAS = /PRAINHA/i;

export interface PixExtrato {
  id: string;
  filialId: string;
  data: string;
  valor: number;
  descricao: string;
  favorecido: string | null;
}

/** Nome de quem recebeu o Pix, tirado da descrição do extrato do Inter:
 *  "Pix enviado  - PIX ENVIADO - Cp :18236120-Fulano de Tal" ou
 *  "Pix enviado  - PIX ENVIADO INTERNO - 00019 123 FULANO DE TAL". */
export function favorecidoDoPix(descricao: string | null | undefined): string | null {
  const d = descricao ?? '';
  const m = d.match(/Cp\s*:\s*\d+-(.+)$/i) ?? d.match(/INTERNO\s*-\s*\d+\s+\d+\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

// Palavra que não diz quem é (forma jurídica, preposição, ramo genérico)
const VAZIAS = new Set(
  'LTDA ME EPP EIRELI SA DE DA DO DOS DAS EM COM COMERCIO IND INDUSTRIA SERVICOS SERVICO PRODUTOS ALIMENTOS ALIMENTICIOS DISTRIBUIDORA DISTRIBUICAO PIX MARKETPLACE'.split(
    ' ',
  ),
);
// Nome e sobrenome comuns: sozinhos não bastam pra dizer que é a mesma pessoa
// ("Glaedson Andrade dos Santos" não é a "Crislayne Carvalho Santos")
const COMUNS = new Set(
  'SANTOS SILVA OLIVEIRA SOUZA SOUSA JESUS LIMA PEREIRA COSTA FERREIRA ALVES RODRIGUES NASCIMENTO MARIA JOSE ANA JOAO GOMES BARBOSA RIBEIRO CARVALHO MELO ARAUJO MENEZES ANDRADE BATISTA CRUZ FILHO JUNIOR NETO SANTANA'.split(
    ' ',
  ),
);

function palavras(...textos: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const t of textos) {
    for (const p of (t ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)) {
      if (p.length >= 3 && !VAZIAS.has(p) && !/^\d+$/.test(p)) out.add(p);
    }
  }
  return out;
}

/** Quanto o favorecido do Pix bate com o nome da conta: palavra rara vale 1,
 *  nome/sobrenome comum vale meio. 1 ou mais = mesmo favorecido. */
export function notaNome(favorecido: string | null, nomesConta: Array<string | null | undefined>): number {
  if (!favorecido) return 0;
  const conta = palavras(...nomesConta);
  let nota = 0;
  for (const p of palavras(favorecido)) if (conta.has(p)) nota += COMUNS.has(p) ? 0.5 : 1;
  return nota;
}

const dias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/** Pix enviados pela conta do Inter da casa no período. */
export async function pixDoExtrato(filialId: string, dataIni: string, dataFim: string): Promise<PixExtrato[]> {
  const rows = await db
    .select({
      id: schema.lancamentoBanco.id,
      filialId: schema.lancamentoBanco.filialId,
      data: schema.lancamentoBanco.dataMovimento,
      valor: schema.lancamentoBanco.valor,
      descricao: schema.lancamentoBanco.descricao,
    })
    .from(schema.lancamentoBanco)
    .where(
      and(
        eq(schema.lancamentoBanco.filialId, filialId),
        eq(schema.lancamentoBanco.tipo, 'D'),
        gte(schema.lancamentoBanco.dataMovimento, dataIni),
        lte(schema.lancamentoBanco.dataMovimento, dataFim),
        ilike(schema.lancamentoBanco.descricao, 'Pix enviado%'),
      ),
    )
    .orderBy(schema.lancamentoBanco.dataMovimento);
  return rows.map((r) => ({
    ...r,
    valor: Number(r.valor),
    descricao: r.descricao ?? '',
    favorecido: favorecidoDoPix(r.descricao),
  }));
}

function selecionarContas(onde: SQL | undefined) {
  const baixado = sql<string>`(SELECT COALESCE(SUM(b.valor), 0) FROM conta_pagar_baixa b WHERE b.conta_pagar_id = ${schema.contaPagar.id})`;
  return db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      dataVencimento: schema.contaPagar.dataVencimento,
      dataPagamento: schema.contaPagar.dataPagamento,
      valorPago: schema.contaPagar.valorPago,
      origem: schema.contaPagar.origem,
      descricao: schema.contaPagar.descricao,
      fornecedorNome: schema.fornecedor.nome,
      razaoSocial: schema.fornecedor.razaoSocial,
      pixFavorecido: schema.fornecedor.pixFavorecido,
      baixado,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(and(isNull(schema.contaPagar.dataDelete), onde))
    .then((rows) =>
      rows.map((r) => ({
        ...r,
        saldo: Number(r.valor) - Number(r.baixado ?? 0),
        nomes: [r.fornecedorNome, r.razaoSocial, r.pixFavorecido, r.descricao],
      })),
    );
}

/** Contas a pagar das casas numa janela em volta do período, com o que já foi
 *  baixado na nuvem (saldo = valor − baixas). */
export async function contasParaPix(filialIds: string[], dataIni: string, dataFim: string) {
  if (!filialIds.length) return [];
  return selecionarContas(
    and(
      inArray(schema.contaPagar.filialId, filialIds),
      gte(schema.contaPagar.dataVencimento, somaDias(dataIni, -60)),
      lte(schema.contaPagar.dataVencimento, somaDias(dataFim, 60)),
    ),
  );
}

export type ContaPix = Awaited<ReturnType<typeof contasParaPix>>[number];

/** Baixas já feitas pelo Pix do extrato (Pix → conta). */
export async function baixasPorPix(pixIds: string[]) {
  if (!pixIds.length) return new Map<string, { contaPagarId: string; baixaId: string }>();
  const rows = await db
    .select({
      lancamentoBancoId: schema.contaPagarBaixa.lancamentoBancoId,
      contaPagarId: schema.contaPagarBaixa.contaPagarId,
      baixaId: schema.contaPagarBaixa.id,
    })
    .from(schema.contaPagarBaixa)
    .where(
      and(
        isNotNull(schema.contaPagarBaixa.lancamentoBancoId),
        inArray(schema.contaPagarBaixa.lancamentoBancoId, pixIds),
      ),
    );
  return new Map(rows.map((r) => [r.lancamentoBancoId!, { contaPagarId: r.contaPagarId, baixaId: r.baixaId }]));
}

/** Lançamentos no encontro de contas feitos a partir do Pix (não cancelados). */
export async function encontrosPorPix(filialPagadoraId: string, pixIds: string[]) {
  if (!pixIds.length) return new Map<string, { id: string; status: string }>();
  const rows = await db
    .select({
      id: schema.pagamentoEntreCasas.id,
      codigo: schema.pagamentoEntreCasas.codigoExterno,
      status: schema.pagamentoEntreCasas.status,
    })
    .from(schema.pagamentoEntreCasas)
    .where(
      and(
        eq(schema.pagamentoEntreCasas.filialPagadoraId, filialPagadoraId),
        inArray(schema.pagamentoEntreCasas.codigoExterno, pixIds),
        ne(schema.pagamentoEntreCasas.status, 'CANCELADO'),
      ),
    );
  return new Map(rows.map((r) => [r.codigo!, { id: r.id, status: r.status }]));
}

/** A conta pode receber a baixa desse Pix: em aberto, saldo igual ao Pix e
 *  vencimento numa janela razoável (pago até 45 dias antes ou 30 depois). */
export function contaCabeNoPix(pix: PixExtrato, c: ContaPix) {
  if (c.dataPagamento) return false;
  if (centavos(c.saldo) !== centavos(pix.valor)) return false;
  const dd = dias(pix.data, c.dataVencimento);
  return dd >= -45 && dd <= 30;
}

export type ResultadoPix =
  | { tipo: 'baixado'; pix: PixExtrato; contaId: string; baixaId: string }
  | { tipo: 'casado'; pix: PixExtrato; conta: ContaPix; nota: number }
  | { tipo: 'ja_pago'; pix: PixExtrato; conta: ContaPix }
  | { tipo: 'sem_conta'; pix: PixExtrato; mesmoValor: ContaPix[] }
  | { tipo: 'casas'; pix: PixExtrato };

/** Casa cada Pix com UMA conta. Ordem de preferência: conta que já foi baixada
 *  por esse Pix; conta já paga (mesmo valor, mesmo nome, pago até 3 dias do
 *  Pix — o Pix é dela e não paga outra); conta em aberto com o nome batendo
 *  (melhor nota, depois a da própria casa, depois vencimento mais perto).
 *  O resto fica "sem conta", com as contas abertas de mesmo valor pra conferir. */
export function casarPix(
  pixes: PixExtrato[],
  contas: ContaPix[],
  feitos: Map<string, { contaPagarId: string; baixaId: string }>,
  filialPagadoraId: string,
): ResultadoPix[] {
  const res = new Map<string, ResultadoPix>();
  const usadas = new Set<string>();
  for (const f of feitos.values()) usadas.add(f.contaPagarId);

  const livres = pixes.filter((p) => {
    const f = feitos.get(p.id);
    if (f) {
      res.set(p.id, { tipo: 'baixado', pix: p, contaId: f.contaPagarId, baixaId: f.baixaId });
      return false;
    }
    if (p.favorecido && PIX_CASAS.test(p.favorecido)) {
      res.set(p.id, { tipo: 'casas', pix: p });
      return false;
    }
    return true;
  });

  // pares possíveis, escolhidos do melhor pro pior, um pra um
  type Par = { pix: PixExtrato; conta: ContaPix; nota: number; pago: boolean; dd: number };
  const pares: Par[] = [];
  for (const p of livres) {
    for (const c of contas) {
      const nota = notaNome(p.favorecido, c.nomes);
      if (nota < 1) continue;
      if (c.dataPagamento) {
        const pagoMesmoValor = [centavos(c.valor), centavos(c.valorPago)].includes(centavos(p.valor));
        const dd = dias(p.data, c.dataPagamento);
        if (pagoMesmoValor && Math.abs(dd) <= 3) pares.push({ pix: p, conta: c, nota, pago: true, dd });
      } else if (contaCabeNoPix(p, c)) {
        pares.push({ pix: p, conta: c, nota, pago: false, dd: dias(p.data, c.dataVencimento) });
      }
    }
  }
  pares.sort(
    (a, b) =>
      Number(b.pago) - Number(a.pago) ||
      b.nota - a.nota ||
      Number(b.conta.filialId === filialPagadoraId) - Number(a.conta.filialId === filialPagadoraId) ||
      Math.abs(a.dd) - Math.abs(b.dd),
  );
  for (const x of pares) {
    if (res.has(x.pix.id) || usadas.has(x.conta.id)) continue;
    usadas.add(x.conta.id);
    res.set(
      x.pix.id,
      x.pago ? { tipo: 'ja_pago', pix: x.pix, conta: x.conta } : { tipo: 'casado', pix: x.pix, conta: x.conta, nota: x.nota },
    );
  }

  for (const p of livres) {
    if (res.has(p.id)) continue;
    const mesmoValor = contas
      .filter((c) => !usadas.has(c.id) && contaCabeNoPix(p, c))
      .sort(
        (a, b) =>
          Number(b.filialId === filialPagadoraId) - Number(a.filialId === filialPagadoraId) ||
          Math.abs(dias(p.data, a.dataVencimento)) - Math.abs(dias(p.data, b.dataVencimento)),
      )
      .slice(0, 3);
    res.set(p.id, { tipo: 'sem_conta', pix: p, mesmoValor });
  }
  return pixes.map((p) => res.get(p.id)!);
}

const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');

/** Baixa as contas pelos Pix do extrato. Confere tudo de novo: o Pix tem que
 *  ser débito "Pix enviado" de uma casa que o usuário acessa e ainda não ter
 *  baixado nada; a conta tem que estar em aberto numa casa que ele acessa,
 *  com saldo igual ao Pix (conta do Consumer só quando a casa saiu do
 *  Consumer). Conta de outra casa: entra também no encontro de contas. */
export async function baixarPorPix(opts: { userId: string; itens: Array<{ pixId: string; contaId: string }> }) {
  const { userId } = opts;
  const nome = new Map((await filiaisDoUsuario(userId)).map((f) => [f.id, f.nome]));
  const pixIds = [...new Set(opts.itens.map((i) => i.pixId))];
  const pixes = new Map(
    (
      await db
        .select({
          id: schema.lancamentoBanco.id,
          filialId: schema.lancamentoBanco.filialId,
          data: schema.lancamentoBanco.dataMovimento,
          valor: schema.lancamentoBanco.valor,
          descricao: schema.lancamentoBanco.descricao,
          tipo: schema.lancamentoBanco.tipo,
        })
        .from(schema.lancamentoBanco)
        .where(inArray(schema.lancamentoBanco.id, pixIds))
    ).map((r) => [r.id, r]),
  );
  const contas = new Map(
    (await selecionarContas(inArray(schema.contaPagar.id, [...new Set(opts.itens.map((i) => i.contaId))]))).map(
      (c) => [c.id, c],
    ),
  );
  const feitos = await baixasPorPix(pixIds);

  const baixados: string[] = [];
  const recusados: Array<{ pixId: string; motivo: string }> = [];
  const usados = new Set<string>();
  for (const it of opts.itens) {
    const recusa = (motivo: string) => recusados.push({ pixId: it.pixId, motivo });
    const r = pixes.get(it.pixId);
    const c = contas.get(it.contaId);
    if (!r || r.tipo !== 'D' || !/^Pix enviado/i.test(r.descricao ?? '')) { recusa('Pix não encontrado no extrato'); continue; }
    if (!nome.has(r.filialId)) { recusa('sem acesso à casa do Pix'); continue; }
    if (feitos.has(r.id) || usados.has(r.id)) { recusa('esse Pix já baixou uma conta'); continue; }
    if (!c) { recusa('conta não encontrada'); continue; }
    if (!nome.has(c.filialId)) { recusa('sem acesso à casa da conta'); continue; }
    const pix: PixExtrato = { ...r, valor: Number(r.valor), descricao: r.descricao ?? '', favorecido: favorecidoDoPix(r.descricao) };
    if (c.dataPagamento) { recusa('a conta já está paga'); continue; }
    if (!contaCabeNoPix(pix, c)) { recusa('o saldo da conta não bate com o Pix (ou o vencimento está longe demais)'); continue; }
    if (c.origem === 'CONSUMER' && !(await consumerParado(c.filialId))) {
      recusa('conta do Consumer: a baixa é feita no PDV');
      continue;
    }

    const outraCasa = c.filialId !== pix.filialId;
    const observacao = `Pix do Inter da ${nome.get(pix.filialId)} em ${dataBr(pix.data)}${pix.favorecido ? ` — ${pix.favorecido}` : ''}`;
    await db.transaction(async (tx) => {
      await tx.insert(schema.contaPagarBaixa).values({
        filialId: c.filialId,
        contaPagarId: c.id,
        data: pix.data,
        valor: pix.valor.toFixed(2),
        observacao,
        criadoPor: userId,
        lancamentoBancoId: pix.id,
      });
      await recalcularAgregado(c.id, Number(c.valor), tx);
      if (outraCasa) {
        const valores = {
          filialPagadoraId: pix.filialId,
          filialDevedoraId: c.filialId,
          contaPagarId: c.id,
          origem: 'INTER_PIX',
          codigoExterno: pix.id,
          data: pix.data,
          competencia: pix.data.slice(0, 7),
          valor: pix.valor.toFixed(2),
          descricao: `${c.fornecedorNome ?? c.descricao ?? 'Conta'} — venc. ${dataBr(c.dataVencimento)}, Pix do Inter da ${nome.get(pix.filialId)}`,
          status: 'ABERTO',
          criadoPor: userId,
        };
        await tx
          .insert(schema.pagamentoEntreCasas)
          .values(valores)
          .onConflictDoUpdate({
            target: [schema.pagamentoEntreCasas.filialPagadoraId, schema.pagamentoEntreCasas.codigoExterno],
            set: { ...valores, criadoEm: new Date(), canceladoPor: null, canceladoEm: null, encontroId: null },
            setWhere: sql`${schema.pagamentoEntreCasas.status} = 'CANCELADO'`,
          });
      }
    });
    usados.add(pix.id);
    baixados.push(it.pixId);
  }
  return { baixados, recusados };
}

/** Desfaz a baixa feita por um Pix (e o encontro, se a conta era de outra
 *  casa) — só enquanto o encontro do mês não fechou. */
export async function desfazerBaixaPix(userId: string, pixId: string) {
  const [b] = await db
    .select({
      id: schema.contaPagarBaixa.id,
      contaPagarId: schema.contaPagarBaixa.contaPagarId,
      filialId: schema.contaPagarBaixa.filialId,
      valorConta: schema.contaPagar.valor,
    })
    .from(schema.contaPagarBaixa)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.contaPagarBaixa.contaPagarId))
    .where(eq(schema.contaPagarBaixa.lancamentoBancoId, pixId));
  if (!b) throw new RecusaTransf('esse Pix não baixou nenhuma conta');
  const [pix] = await db
    .select({ filialId: schema.lancamentoBanco.filialId })
    .from(schema.lancamentoBanco)
    .where(eq(schema.lancamentoBanco.id, pixId));
  const acesso = new Set((await filiaisDoUsuario(userId)).map((f) => f.id));
  if (!acesso.has(b.filialId) || (pix && !acesso.has(pix.filialId))) throw new RecusaTransf('sem acesso às casas');
  const encontro = pix ? (await encontrosPorPix(pix.filialId, [pixId])).get(pixId) : undefined;
  if (encontro?.status === 'COMPENSADO') throw new RecusaTransf('já entrou num encontro de contas fechado');

  await db.transaction(async (tx) => {
    await tx.delete(schema.contaPagarBaixa).where(eq(schema.contaPagarBaixa.id, b.id));
    await recalcularAgregado(b.contaPagarId, Number(b.valorConta), tx);
    if (encontro) {
      await tx
        .update(schema.pagamentoEntreCasas)
        .set({ status: 'CANCELADO', canceladoPor: userId, canceladoEm: new Date() })
        .where(and(eq(schema.pagamentoEntreCasas.id, encontro.id), eq(schema.pagamentoEntreCasas.status, 'ABERTO')));
    }
  });
  return { pixId, contaId: b.contaPagarId };
}
