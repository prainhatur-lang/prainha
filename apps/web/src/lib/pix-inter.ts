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
// ao boleto. Desde 22/10/2026 (regra do dono) isso vale só pra Pix de antes
// da data; do dia em diante só o Admin baixa conta de outra casa por Pix —
// ver BLOQUEIO_ENTRE_CASAS_DESDE em lib/pagamento-entre-casas.ts.

import { db, schema } from '@concilia/db';
import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { consumerParado } from '@/lib/consumer-contas';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { RecusaTransf } from '@/lib/transferencia';
import { centavos, somaDias } from '@/lib/boletos-inter';
import { entreCasasBloqueado, MSG_BLOQUEIO_ENTRE_CASAS } from '@/lib/pagamento-entre-casas';
import { ehAdmin } from '@/lib/usuario-admin';

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
      // E.B. Serviços é intermediária: o Pix sai pra "E B SERVICOS LTDA" e a
      // conta é do recebedor final com "EB serviços" na descrição. "E", "B",
      // SERVICOS e LTDA não pontuam, então vira uma palavra só que pontua.
      .replace(/\bE\W{0,3}B\W{0,3}SERVIC/g, ' EBSERVICOS SERVIC')
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

/** Pix enviados pela conta do Inter da casa (ou das casas) no período. */
export async function pixDoExtrato(
  filialId: string | string[],
  dataIni: string,
  dataFim: string,
): Promise<PixExtrato[]> {
  const ids = Array.isArray(filialId) ? filialId : [filialId];
  if (!ids.length) return [];
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
        inArray(schema.lancamentoBanco.filialId, ids),
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

const NOMES_ORGAO_IMPOSTO = 'SECRETARIA FAZENDA PREFEITURA SEFAZ RECEITA';

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
      boletoStoragePath: schema.contaPagar.boletoStoragePath,
      baixado,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    // Conta no borderô não casa com Pix: quem saiu foi o Pix do intermediário.
    .where(and(isNull(schema.contaPagar.dataDelete), isNull(schema.contaPagar.borderoId), onde))
    .then((rows) =>
      rows.map((r) => ({
        ...r,
        saldo: Number(r.valor) - Number(r.baixado ?? 0),
        nomes: [
          r.fornecedorNome,
          r.razaoSocial,
          r.pixFavorecido,
          r.descricao,
          // Guia de imposto (tela /financeiro/impostos) não tem fornecedor: o Pix
          // sai pro órgão ("SECRETARIA MUNICIPAL DA FAZEND", DAM da Tabuará 27/10).
          r.boletoStoragePath?.startsWith('impostos/') ? NOMES_ORGAO_IMPOSTO : null,
        ],
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

export type FeitoPix = { contaPagarId: string; baixaId: string; outras?: string[] };

/** Baixas já feitas pelo Pix do extrato (Pix → conta). Pix que pagou várias
 *  contas (pix_conta_vinculo) vem com a primeira em contaPagarId e as demais
 *  em `outras`. */
export async function baixasPorPix(pixIds: string[]) {
  if (!pixIds.length) return new Map<string, FeitoPix>();
  const multi = await db
    .select({
      lancamentoBancoId: schema.pixContaVinculo.lancamentoBancoId,
      contaPagarId: schema.pixContaVinculo.contaPagarId,
      baixaId: schema.pixContaVinculo.contaPagarBaixaId,
    })
    .from(schema.pixContaVinculo)
    .where(inArray(schema.pixContaVinculo.lancamentoBancoId, pixIds))
    .orderBy(schema.pixContaVinculo.criadoEm);
  const out = new Map<string, FeitoPix>();
  for (const r of multi) {
    const f = out.get(r.lancamentoBancoId);
    if (!f) out.set(r.lancamentoBancoId, { contaPagarId: r.contaPagarId, baixaId: r.baixaId, outras: [] });
    else if (r.contaPagarId !== f.contaPagarId && !f.outras!.includes(r.contaPagarId)) f.outras!.push(r.contaPagarId);
  }
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
  for (const r of rows) if (!out.has(r.lancamentoBancoId!)) out.set(r.lancamentoBancoId!, { contaPagarId: r.contaPagarId, baixaId: r.baixaId });
  return out;
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

/** Várias contas do mesmo fornecedor, na casa do Pix, que somadas dão o Pix. */
export type ComboPix = { contas: ContaPix[]; soma: number; diferenca: number };

/** Diferença aceita entre a soma das contas e o Pix (centavos arredondados). */
export const TOLERANCIA_VARIAS = 1;

/** Quanto a conta entra na soma: em aberto = saldo; paga = o que foi pago. */
export const valorNaSoma = (c: ContaPix) => (c.dataPagamento ? Number(c.valorPago ?? c.valor) : c.saldo);

/** A conta pode fazer parte de um Pix que pagou várias: mesmo nome, mesma
 *  casa do Pix; em aberto com vencimento perto, ou paga até 3 dias do Pix. */
function cabeNaSoma(pix: PixExtrato, c: ContaPix) {
  if (c.filialId !== pix.filialId) return false;
  if (notaNome(pix.favorecido, c.nomes) < 1) return false;
  if (c.dataPagamento) return Math.abs(dias(pix.data, c.dataPagamento)) <= 3;
  if (c.saldo <= 0.005) return false;
  const dd = dias(pix.data, c.dataVencimento);
  return dd >= -45 && dd <= 30;
}

/** Procura 2 a 4 contas que somam o Pix (± TOLERANCIA_VARIAS). Menor
 *  diferença ganha; empate, menos contas. */
export function acharVarias(pix: PixExtrato, contas: ContaPix[], usadas: Set<string>): ComboPix | undefined {
  const cand = contas
    .filter((c) => !usadas.has(c.id) && cabeNaSoma(pix, c) && valorNaSoma(c) > 0 && valorNaSoma(c) < pix.valor + TOLERANCIA_VARIAS)
    .sort(
      (a, b) =>
        Math.abs(dias(pix.data, a.dataPagamento ?? a.dataVencimento)) -
        Math.abs(dias(pix.data, b.dataPagamento ?? b.dataVencimento)),
    )
    .slice(0, 16);
  const alvo = centavos(pix.valor);
  const tol = Math.round(TOLERANCIA_VARIAS * 100);
  let melhor: { idx: number[]; dif: number } | undefined;
  const v = cand.map((c) => centavos(valorNaSoma(c)));
  const busca = (ini: number, idx: number[], soma: number) => {
    if (idx.length >= 2) {
      const dif = Math.abs(soma - alvo);
      if (dif <= tol && (!melhor || dif < melhor.dif || (dif === melhor.dif && idx.length < melhor.idx.length))) {
        melhor = { idx: [...idx], dif };
      }
    }
    if (idx.length === 4) return;
    for (let i = ini; i < cand.length; i++) {
      if (soma + v[i]! > alvo + tol) continue;
      idx.push(i);
      busca(i + 1, idx, soma + v[i]!);
      idx.pop();
    }
  };
  busca(0, [], 0);
  if (!melhor) return undefined;
  const escolhidas = melhor.idx.map((i) => cand[i]!);
  const soma = escolhidas.reduce((s, c) => s + valorNaSoma(c), 0);
  return { contas: escolhidas, soma: Math.round(soma * 100) / 100, diferenca: Math.round((pix.valor - soma) * 100) / 100 };
}

export type ResultadoPix =
  | { tipo: 'baixado'; pix: PixExtrato; contaId: string; baixaId: string; outras?: string[] }
  | { tipo: 'casado'; pix: PixExtrato; conta: ContaPix; nota: number }
  | { tipo: 'ja_pago'; pix: PixExtrato; conta: ContaPix }
  | { tipo: 'sem_conta'; pix: PixExtrato; mesmoValor: ContaPix[]; varias?: ComboPix }
  | { tipo: 'casas'; pix: PixExtrato };

/** Casa cada Pix com UMA conta. Ordem de preferência: conta que já foi baixada
 *  por esse Pix; conta DA CASA DO PIX antes de conta de outra casa; dentro
 *  disso, conta já paga (mesmo valor, mesmo nome, pago até 3 dias do Pix — o
 *  Pix é dela e não paga outra), depois conta em aberto com o nome batendo
 *  (melhor nota, vencimento mais perto).
 *  O resto fica "sem conta", com as contas abertas de mesmo valor pra conferir.
 *
 *  Passe os Pix de TODAS as casas juntos: o mesmo fornecedor com o mesmo valor
 *  nas duas casas (duas caixas de peixe, uma pra cada) fazia o Pix da Mar de
 *  21/10/2026 pegar a conta da Bar já paga pelo Pix da própria Bar em 20/10 —
 *  cada tela só via os Pix da sua casa e a conta "trocava de casa". */
export function casarPix(
  pixes: PixExtrato[],
  contas: ContaPix[],
  feitos: Map<string, FeitoPix>,
  filialPagadoraId: string,
): ResultadoPix[] {
  const res = new Map<string, ResultadoPix>();
  const usadas = new Set<string>();
  for (const f of feitos.values()) {
    usadas.add(f.contaPagarId);
    for (const o of f.outras ?? []) usadas.add(o);
  }

  const livres = pixes.filter((p) => {
    const f = feitos.get(p.id);
    if (f) {
      res.set(p.id, { tipo: 'baixado', pix: p, contaId: f.contaPagarId, baixaId: f.baixaId, outras: f.outras });
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
  const daCasa = (x: Par) => x.conta.filialId === (x.pix.filialId || filialPagadoraId);
  pares.sort(
    (a, b) =>
      Number(daCasa(b)) - Number(daCasa(a)) ||
      Number(b.pago) - Number(a.pago) ||
      b.nota - a.nota ||
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
          Number(b.filialId === (p.filialId || filialPagadoraId)) -
            Number(a.filialId === (p.filialId || filialPagadoraId)) ||
          Math.abs(dias(p.data, a.dataVencimento)) - Math.abs(dias(p.data, b.dataVencimento)),
      )
      .slice(0, 3);
    // nada de uma conta só: tenta várias contas do mesmo fornecedor que somam o Pix
    const varias = mesmoValor.length ? undefined : acharVarias(p, contas, usadas);
    if (varias) for (const c of varias.contas) usadas.add(c.id);
    res.set(p.id, { tipo: 'sem_conta', pix: p, mesmoValor, varias });
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

  let admin: boolean | null = null; // só consulta se aparecer conta de outra casa
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
    if (outraCasa) {
      if (admin === null) admin = await ehAdmin(userId);
      if (entreCasasBloqueado(pix.data, admin)) {
        recusa(`conta da ${nome.get(c.filialId)} paga pelo Pix da ${nome.get(pix.filialId)}. ${MSG_BLOQUEIO_ENTRE_CASAS}`);
        continue;
      }
    }
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

/** Marca da baixa que já existia (paga à mão) e só foi ligada ao Pix. */
export const MARCA_VINCULO_PIX = ' · Pix confirmado pelo extrato';

/** "✓ é este Pix": a conta já foi paga à mão e o dono confirma QUAL Pix pagou.
 *  Liga a baixa existente ao Pix (lancamento_banco_id) — daí em diante o
 *  casamento não muda mais de casa nem de Pix. Só conta da mesma casa do Pix
 *  (conta de outra casa paga por Pix é encontro de contas, outro fluxo). */
export async function confirmarPixDaConta(userId: string, pixId: string, contaId: string) {
  const acesso = new Set((await filiaisDoUsuario(userId)).map((f) => f.id));
  const [pix] = await db
    .select({
      id: schema.lancamentoBanco.id,
      filialId: schema.lancamentoBanco.filialId,
      valor: schema.lancamentoBanco.valor,
      descricao: schema.lancamentoBanco.descricao,
      tipo: schema.lancamentoBanco.tipo,
    })
    .from(schema.lancamentoBanco)
    .where(eq(schema.lancamentoBanco.id, pixId));
  if (!pix || pix.tipo !== 'D' || !/^Pix enviado/i.test(pix.descricao ?? '')) {
    throw new RecusaTransf('Pix não encontrado no extrato');
  }
  if (!acesso.has(pix.filialId)) throw new RecusaTransf('sem acesso à casa do Pix');
  if ((await baixasPorPix([pixId])).has(pixId)) throw new RecusaTransf('esse Pix já está ligado a uma conta');
  const [c] = await db
    .select({ id: schema.contaPagar.id, filialId: schema.contaPagar.filialId, dataPagamento: schema.contaPagar.dataPagamento })
    .from(schema.contaPagar)
    .where(and(eq(schema.contaPagar.id, contaId), isNull(schema.contaPagar.dataDelete)));
  if (!c) throw new RecusaTransf('conta não encontrada');
  if (c.filialId !== pix.filialId) {
    throw new RecusaTransf('a conta é de outra casa: o Pix desta casa não confirma conta de outra');
  }
  if (!c.dataPagamento) throw new RecusaTransf('a conta está em aberto: use Baixar');
  const baixas = await db
    .select({ id: schema.contaPagarBaixa.id, valor: schema.contaPagarBaixa.valor, observacao: schema.contaPagarBaixa.observacao })
    .from(schema.contaPagarBaixa)
    .where(and(eq(schema.contaPagarBaixa.contaPagarId, c.id), isNull(schema.contaPagarBaixa.lancamentoBancoId)));
  const b = baixas.find((x) => centavos(Number(x.valor)) === centavos(Number(pix.valor)));
  if (!b) throw new RecusaTransf('a conta não tem pagamento desse valor sem Pix ligado');
  await db
    .update(schema.contaPagarBaixa)
    .set({ lancamentoBancoId: pix.id, observacao: `${b.observacao ?? ''}${MARCA_VINCULO_PIX}` })
    .where(and(eq(schema.contaPagarBaixa.id, b.id), isNull(schema.contaPagarBaixa.lancamentoBancoId)));
  return { pixId, contaId: c.id };
}

/** "✓ este Pix pagou estas contas": um Pix só para 2+ contas do mesmo
 *  fornecedor, todas da casa do Pix. Conta em aberto ganha baixa do saldo com
 *  a data do Pix; conta já paga à mão tem as baixas dela ligadas ao Pix. Tudo
 *  fica em pix_conta_vinculo — o Pix não casa mais com outra coisa. */
export async function pagarVariasPorPix(userId: string, pixId: string, contaIds: string[]) {
  const ids = [...new Set(contaIds)];
  if (ids.length < 2) throw new RecusaTransf('escolha pelo menos duas contas');
  const acesso = new Map((await filiaisDoUsuario(userId)).map((f) => [f.id, f.nome]));
  const [r] = await db
    .select({
      id: schema.lancamentoBanco.id,
      filialId: schema.lancamentoBanco.filialId,
      data: schema.lancamentoBanco.dataMovimento,
      valor: schema.lancamentoBanco.valor,
      descricao: schema.lancamentoBanco.descricao,
      tipo: schema.lancamentoBanco.tipo,
    })
    .from(schema.lancamentoBanco)
    .where(eq(schema.lancamentoBanco.id, pixId));
  if (!r || r.tipo !== 'D' || !/^Pix enviado/i.test(r.descricao ?? '')) throw new RecusaTransf('Pix não encontrado no extrato');
  if (!acesso.has(r.filialId)) throw new RecusaTransf('sem acesso à casa do Pix');
  if ((await baixasPorPix([pixId])).has(pixId)) throw new RecusaTransf('esse Pix já está ligado a conta');
  const pix: PixExtrato = { ...r, valor: Number(r.valor), descricao: r.descricao ?? '', favorecido: favorecidoDoPix(r.descricao) };

  const contas = await selecionarContas(inArray(schema.contaPagar.id, ids));
  if (contas.length !== ids.length) throw new RecusaTransf('conta não encontrada (apagada ou no borderô)');
  for (const c of contas) {
    if (c.filialId !== pix.filialId) throw new RecusaTransf('todas as contas têm que ser da casa do Pix');
    if (!c.dataPagamento && c.origem === 'CONSUMER' && !(await consumerParado(c.filialId))) {
      throw new RecusaTransf(`conta do Consumer (${c.fornecedorNome ?? c.descricao}): a baixa é feita no PDV`);
    }
  }
  // baixas sem Pix das contas já pagas
  const pagas = contas.filter((c) => c.dataPagamento).map((c) => c.id);
  const baixasLivres = pagas.length
    ? await db
        .select({ id: schema.contaPagarBaixa.id, contaPagarId: schema.contaPagarBaixa.contaPagarId, valor: schema.contaPagarBaixa.valor })
        .from(schema.contaPagarBaixa)
        .leftJoin(schema.pixContaVinculo, eq(schema.pixContaVinculo.contaPagarBaixaId, schema.contaPagarBaixa.id))
        .where(
          and(
            inArray(schema.contaPagarBaixa.contaPagarId, pagas),
            isNull(schema.contaPagarBaixa.lancamentoBancoId),
            isNull(schema.pixContaVinculo.id),
          ),
        )
    : [];
  let soma = 0;
  for (const c of contas) {
    if (c.dataPagamento) {
      const bs = baixasLivres.filter((b) => b.contaPagarId === c.id);
      if (!bs.length) throw new RecusaTransf(`a conta de ${dataBr(c.dataVencimento)} já está paga e ligada a outro pagamento`);
      soma += bs.reduce((x, b) => x + Number(b.valor), 0);
    } else {
      if (c.saldo <= 0.005) throw new RecusaTransf('conta sem saldo');
      soma += c.saldo;
    }
  }
  if (Math.abs(centavos(soma) - centavos(pix.valor)) > Math.round(TOLERANCIA_VARIAS * 100)) {
    throw new RecusaTransf(`as contas somam ${soma.toFixed(2)} e o Pix foi ${pix.valor.toFixed(2)}`);
  }

  const observacao = `Pix do Inter da ${acesso.get(pix.filialId)} em ${dataBr(pix.data)} (1 Pix pra ${contas.length} contas)${pix.favorecido ? ` — ${pix.favorecido}` : ''}`;
  await db.transaction(async (tx) => {
    for (const c of contas) {
      if (c.dataPagamento) {
        for (const b of baixasLivres.filter((x) => x.contaPagarId === c.id)) {
          await tx.insert(schema.pixContaVinculo).values({
            filialId: c.filialId,
            lancamentoBancoId: pix.id,
            contaPagarBaixaId: b.id,
            contaPagarId: c.id,
            criouBaixa: false,
            criadoPor: userId,
          });
        }
      } else {
        const [b] = await tx
          .insert(schema.contaPagarBaixa)
          .values({
            filialId: c.filialId,
            contaPagarId: c.id,
            data: pix.data,
            valor: c.saldo.toFixed(2),
            observacao,
            criadoPor: userId,
          })
          .returning({ id: schema.contaPagarBaixa.id });
        await recalcularAgregado(c.id, Number(c.valor), tx);
        await tx.insert(schema.pixContaVinculo).values({
          filialId: c.filialId,
          lancamentoBancoId: pix.id,
          contaPagarBaixaId: b!.id,
          contaPagarId: c.id,
          criouBaixa: true,
          criadoPor: userId,
        });
      }
    }
  });
  return { pixId, contas: contas.map((c) => c.id) };
}

/** Desfaz o "1 Pix pra várias contas": apaga as baixas que ele criou e só
 *  desliga as que já existiam. */
async function desfazerVarias(userId: string, pixId: string) {
  const vs = await db
    .select({
      id: schema.pixContaVinculo.id,
      filialId: schema.pixContaVinculo.filialId,
      baixaId: schema.pixContaVinculo.contaPagarBaixaId,
      contaPagarId: schema.pixContaVinculo.contaPagarId,
      criouBaixa: schema.pixContaVinculo.criouBaixa,
      valorConta: schema.contaPagar.valor,
    })
    .from(schema.pixContaVinculo)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.pixContaVinculo.contaPagarId))
    .where(eq(schema.pixContaVinculo.lancamentoBancoId, pixId));
  if (!vs.length) return null;
  const acesso = new Set((await filiaisDoUsuario(userId)).map((f) => f.id));
  if (vs.some((v) => !acesso.has(v.filialId))) throw new RecusaTransf('sem acesso à casa');
  await db.transaction(async (tx) => {
    for (const v of vs) {
      if (v.criouBaixa) {
        await tx.delete(schema.contaPagarBaixa).where(eq(schema.contaPagarBaixa.id, v.baixaId)); // vínculo vai junto (cascade)
        await recalcularAgregado(v.contaPagarId, Number(v.valorConta), tx);
      } else {
        await tx.delete(schema.pixContaVinculo).where(eq(schema.pixContaVinculo.id, v.id));
      }
    }
  });
  return { pixId, contaId: vs[0]!.contaPagarId };
}

/** Desfaz a baixa feita por um Pix (e o encontro, se a conta era de outra
 *  casa) — só enquanto o encontro do mês não fechou. Se a baixa só tinha sido
 *  LIGADA ao Pix (conta paga à mão, "✓ é este Pix"), desfaz só a ligação. */
export async function desfazerBaixaPix(userId: string, pixId: string) {
  const varias = await desfazerVarias(userId, pixId);
  if (varias) return varias;
  const [b] = await db
    .select({
      id: schema.contaPagarBaixa.id,
      contaPagarId: schema.contaPagarBaixa.contaPagarId,
      filialId: schema.contaPagarBaixa.filialId,
      valorConta: schema.contaPagar.valor,
      observacao: schema.contaPagarBaixa.observacao,
    })
    .from(schema.contaPagarBaixa)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.contaPagarBaixa.contaPagarId))
    .where(eq(schema.contaPagarBaixa.lancamentoBancoId, pixId));
  if (!b) throw new RecusaTransf('esse Pix não baixou nenhuma conta');
  if (b.observacao?.endsWith(MARCA_VINCULO_PIX)) {
    const acessoV = new Set((await filiaisDoUsuario(userId)).map((f) => f.id));
    if (!acessoV.has(b.filialId)) throw new RecusaTransf('sem acesso à casa');
    const obs = b.observacao.slice(0, -MARCA_VINCULO_PIX.length);
    await db
      .update(schema.contaPagarBaixa)
      .set({ lancamentoBancoId: null, observacao: obs || null })
      .where(eq(schema.contaPagarBaixa.id, b.id));
    return { pixId, contaId: b.contaPagarId };
  }
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
