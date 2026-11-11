// Pagamentos da folha → contas a pagar (pedido do dono 05/11/2026: "Sim, fazer
// o botão"; mesmo dia: "vamos lançar pela nossa folha do sistema").
//
// Pro mês e pra casa, a folha calculada pelo sistema (lib/rh/nossa-folha.ts,
// funcionários com cadastro na casa) vira conta, pela empresa de registro:
//   - E.B. Serviços: UMA conta "Repasse E.B. — Folha MM/AAAA" com a soma dos
//     líquidos da casa, favorecido E.B. (a casa faz um Pix pra E.B., que paga
//     as pessoas — igual à rescisão).
//   - Lelis: UMA conta por pessoa "Repasse Lelis — Folha MM/AAAA — Fulano",
//     favorecido Lelis, na casa do cadastro da pessoa (era o lançamento manual
//     "pix para Lelis ref. ao pagamento de Claudio…" do Bar).
//     Na filial da E.B. sai UMA conta por pessoa "Salário MM/AAAA — Fulano",
//     favorecido o funcionário (pedido do dono 06/11/2026: "se EB pagou a folha,
//     não deveria aparecer no contas a pagar de EB, pagamentos individuais, tipo
//     Álvaro"). codigo_referencia `fe:<comp>:<casa 8>:<cpf>` na E.B.
//   - Empresa da própria casa (Prainha Turismo no Bar): UMA conta por pessoa,
//     favorecido o funcionário (a casa paga direto).
// Não lança duas vezes: codigo_referencia `fc:<comp>:<cnpj>[:<cpf>]` na casa (coluna tem 50).
// Conta manual parecida (nome da pessoa + "mes MM" na casa) aparece como
// "parece já lançada" e fica fora por padrão.

import { db, schema } from '@concilia/db';
import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { EB_CNPJ } from '@/lib/eb/faturas';
import { LELIS_CNPJ, filialDoCnpj, fornecedorPagadorNaCasa } from '@/lib/impostos/guia';
import { fornecedorFuncionarioNaEb, type Tx } from '@/lib/rh/rescisao-empregador';
import { nossaFolhaDoMes } from '@/lib/rh/nossa-folha';
import { contasEmPixAberto } from '@/lib/pix-pagamento';
import { registrarExclusao, resumoConta } from '@/lib/registro-exclusao';

export interface ItemPagamentoFolha {
  ref: string;
  casaFilialId: string;
  empresa: string;
  cnpj: string;
  tipo: 'repasse_eb' | 'repasse_lelis' | 'direto';
  descricao: string;
  pessoas: { nome: string; cpf: string | null; liquido: number; fornecedorId?: string | null }[];
  valor: number;
  /** Conta já criada por este botão. */
  jaLancadaId: string | null;
  /** Valor da conta já lançada (pra mostrar "valor mudou" e oferecer Relançar). */
  valorLancado?: number | null;
  /** Conta manual que parece ser a mesma (não lança por padrão). */
  pareceLancada: string | null;
  /** Funcionário sem cadastro de favorecido (só no 'direto'). */
  semFavorecido: string[];
}

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

// Diarista não entra na folha (regra do dono 05/11/2026: "enquanto ele está
// diarista, ele não pode entrar na folha. Ele vai receber só por diária. A partir
// do momento que ele for registrado, aí ele entra na folha").
// Quem decide é o NOSSO sistema, não o contador (dono 09/11/2026: "esquece o
// contador"): diarista = papel 'diarista' na folha semanal (fornecedor_folha),
// ou papel funcionário com "diária até" (diarista_ate) cobrindo o mês inteiro.
// Registrado no meio do mês (diária até antes do fim) entra na folha — a
// admissão do cadastro já proporcionaliza. Antes a regra olhava a folha do
// contador e tirou José e Anthony (Mar, out/2026), registrados na E.B. pelo
// nosso cadastro desde 05/10.
export interface RegistroNoMes {
  /** funcionarioId → nome de quem fica fora por ser diarista no nosso sistema. */
  diaristas: Map<string, string>;
  /** Mantido pela tela/rota; com a regra pelo nosso sistema fica sempre vazio. */
  semExtrato: string[];
}

export async function registroNoMes(
  casaFilialId: string,
  comp: string,
  linhas: {
    funcionarioId: string;
    nome: string;
    cpf: string | null;
    cnpjRegistro: string | null;
    empresaRegistro: string | null;
    fornecedorId?: string | null;
    desligamento: string | null;
    liquido: number;
  }[],
  _casaCnpj: string,
): Promise<RegistroNoMes> {
  void casaFilialId;
  const [a, m] = comp.split('-').map(Number);
  const fimMes = `${comp}-${String(new Date(Date.UTC(a!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
  const fids = [...new Set(linhas.map((l) => l.fornecedorId).filter((x): x is string => !!x))];
  const papeis = fids.length
    ? await db
        .select({
          fornecedorId: schema.fornecedorFolha.fornecedorId,
          papel: schema.fornecedorFolha.papel,
          diaristaAte: schema.fornecedorFolha.diaristaAte,
        })
        .from(schema.fornecedorFolha)
        .where(inArray(schema.fornecedorFolha.fornecedorId, fids))
    : [];
  const porFornecedor = new Map(papeis.map((p) => [p.fornecedorId, p]));
  const diaristas = new Map<string, string>();
  for (const l of linhas) {
    // só quem a folha pagaria (líquido > 0 e não saiu no mês)
    if (!(l.liquido > 0) || (l.desligamento && l.desligamento.slice(0, 7) === comp)) continue;
    const p = l.fornecedorId ? porFornecedor.get(l.fornecedorId) : undefined;
    if (!p) continue;
    if (p.papel === 'diarista' || (p.diaristaAte && p.diaristaAte >= fimMes)) diaristas.set(l.funcionarioId, l.nome);
  }
  return { diaristas, semExtrato: [] };
}

/** Quem fica fora da folha do mês por não ser registrado (pra tela). */
export async function diaristasForaDaFolha(casaFilialId: string, comp: string): Promise<{ diaristas: string[]; semExtrato: string[] }> {
  const [casa] = await db.select({ cnpj: schema.filial.cnpj }).from(schema.filial).where(eq(schema.filial.id, casaFilialId)).limit(1);
  const linhas = await nossaFolhaDoMes(casaFilialId, comp);
  const r = await registroNoMes(casaFilialId, comp, linhas, digitos(casa?.cnpj));
  return { diaristas: [...r.diaristas.values()].sort((a, b) => a.localeCompare(b)), semExtrato: r.semExtrato };
}

/**
 * Quem a E.B. paga pela NOSSA folha numa casa e mês — o mesmo grupo do
 * "Repasse E.B." do Lançar pagamentos: cadastro na casa, registro na E.B.,
 * líquido > 0, não saiu no mês (vai pela rescisão) e não é diarista.
 * Base da fatura da E.B. e da conferência do extrato (dono 05/11/2026: "vou
 * pagar pela nossa folha, não pela do contador").
 */
export async function folhaEbDaCasa(casaFilialId: string, comp: string) {
  const [casa] = await db.select({ cnpj: schema.filial.cnpj }).from(schema.filial).where(eq(schema.filial.id, casaFilialId)).limit(1);
  const casaCnpj = digitos(casa?.cnpj);
  const linhas = await nossaFolhaDoMes(casaFilialId, comp);
  const registro = await registroNoMes(casaFilialId, comp, linhas, casaCnpj);
  return linhas.filter(
    (l) =>
      (digitos(l.cnpjRegistro) || casaCnpj) === EB_CNPJ &&
      l.liquido > 0 &&
      !(l.desligamento && l.desligamento.slice(0, 7) === comp) &&
      !registro.diaristas.has(l.funcionarioId),
  );
}

/**
 * Mesmo filtro da folhaEbDaCasa, mas pra qualquer empresa pela RAIZ do CNPJ
 * (8 dígitos) — a Prainha Turismo registra com a matriz (…0001-66) gente que
 * trabalha na Mar. Sem empresa no cadastro = a própria casa registra.
 */
export async function folhaDaEmpresaNaCasa(casaFilialId: string, comp: string, raizCnpj: string) {
  const [casa] = await db.select({ cnpj: schema.filial.cnpj }).from(schema.filial).where(eq(schema.filial.id, casaFilialId)).limit(1);
  const casaCnpj = digitos(casa?.cnpj);
  const linhas = await nossaFolhaDoMes(casaFilialId, comp);
  const registro = await registroNoMes(casaFilialId, comp, linhas, casaCnpj);
  return linhas.filter(
    (l) =>
      (digitos(l.cnpjRegistro) || casaCnpj).slice(0, 8) === raizCnpj &&
      l.liquido > 0 &&
      !(l.desligamento && l.desligamento.slice(0, 7) === comp) &&
      !registro.diaristas.has(l.funcionarioId),
  );
}

function mmAaaa(comp: string): string {
  const [a, m] = comp.split('-');
  return `${m}/${a}`;
}

const FERIADOS_MMDD = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']);

/** 5º dia útil (seg–sex, sem feriado nacional) do mês seguinte à competência. */
export function quintoDiaUtil(comp: string): string {
  const [a, m] = comp.split('-').map(Number);
  const ano = m === 12 ? a! + 1 : a!;
  const mes = m === 12 ? 1 : m! + 1;
  let uteis = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(ano, mes - 1, d));
    if (dt.getUTCMonth() !== mes - 1) break;
    const dow = dt.getUTCDay();
    const mmdd = `${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (dow === 0 || dow === 6 || FERIADOS_MMDD.has(mmdd)) continue;
    uteis++;
    if (uteis === 5) return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return `${ano}-${String(mes).padStart(2, '0')}-05`;
}

/** O que a casa tem pra pagar da NOSSA folha (calculada pelo sistema) daquele mês. */
export async function pagamentosDaFolha(casaFilialId: string, comp: string): Promise<ItemPagamentoFolha[]> {
  const [casa] = await db
    .select({ cnpj: schema.filial.cnpj, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, casaFilialId))
    .limit(1);
  const casaCnpj = digitos(casa?.cnpj);
  const linhas = await nossaFolhaDoMes(casaFilialId, comp);
  const registro = await registroNoMes(casaFilialId, comp, linhas, casaCnpj);

  const itens = new Map<string, ItemPagamentoFolha>();
  for (const l of linhas) {
    // sem empresa de registro = a própria casa paga
    const cnpj = digitos(l.cnpjRegistro) || casaCnpj;
    const empresa = l.empresaRegistro || casa?.nome || '';
    const liquido = l.liquido;
    if (!(liquido > 0)) continue;
    // saiu no mês → vai pela rescisão, não pela folha (senão paga em dobro)
    if (l.desligamento && l.desligamento.slice(0, 7) === comp) continue;
    // diarista (fora do extrato do contador) → recebe pela diária, não pela folha
    if (registro.diaristas.has(l.funcionarioId)) continue;
    const pessoa = { nome: l.nome, cpf: l.cpf, liquido, fornecedorId: l.fornecedorId };
    const refPessoa = `fc:${comp}:${cnpj}:${digitos(l.cpf) || l.nome}`.slice(0, 50);
    if (cnpj === LELIS_CNPJ) {
      itens.set(refPessoa, {
        ref: refPessoa,
        casaFilialId,
        empresa,
        cnpj,
        tipo: 'repasse_lelis',
        descricao: `Repasse Lelis — Folha ${mmAaaa(comp)} — ${l.nome}`,
        pessoas: [pessoa],
        valor: liquido,
        jaLancadaId: null,
        pareceLancada: null,
        semFavorecido: [],
      });
      continue;
    }
    if (cnpj === EB_CNPJ) {
      const ref = `fc:${comp}:${cnpj}`;
      const it = itens.get(ref) ?? {
        ref,
        casaFilialId,
        empresa,
        cnpj,
        tipo: 'repasse_eb' as const,
        descricao: `Repasse E.B. — Folha ${mmAaaa(comp)}`,
        pessoas: [],
        valor: 0,
        jaLancadaId: null,
        pareceLancada: null,
        semFavorecido: [],
      };
      it.pessoas.push(pessoa);
      it.valor += liquido;
      itens.set(ref, it);
      continue;
    }
    if (cnpj === casaCnpj) {
      itens.set(refPessoa, {
        ref: refPessoa,
        casaFilialId,
        empresa,
        cnpj,
        tipo: 'direto',
        descricao: `Salário ${mmAaaa(comp)} — ${l.nome}`,
        pessoas: [pessoa],
        valor: liquido,
        jaLancadaId: null,
        pareceLancada: null,
        semFavorecido: l.fornecedorId ? [] : [l.nome],
      });
    }
    // outra empresa que não é E.B./Lelis/da casa: fica fora (não tem regra de quem paga)
  }

  const lista = [...itens.values()].map((i) => ({ ...i, valor: Math.round(i.valor * 100) / 100 }));
  if (!lista.length) return lista;

  // já lançadas por este botão
  const cp = schema.contaPagar;
  const ja = await db
    .select({ id: cp.id, ref: cp.codigoReferencia, valor: cp.valor })
    .from(cp)
    .where(and(eq(cp.filialId, casaFilialId), inArray(cp.codigoReferencia, lista.map((i) => i.ref)), isNull(cp.dataDelete)));
  const porRef = new Map(ja.map((j) => [j.ref, j.id]));
  const valorPorRef = new Map(ja.map((j) => [j.ref, Number(j.valor)]));

  // lançamento manual parecido: nome da pessoa + "mes MM"/"mês MM" na casa
  const mm = comp.split('-')[1]!;
  for (const i of lista) {
    i.jaLancadaId = porRef.get(i.ref) ?? null;
    i.valorLancado = valorPorRef.get(i.ref) ?? null;
    if (i.jaLancadaId || i.tipo === 'repasse_eb') continue;
    const nome = i.pessoas[0]!.nome.split(/\s+/).slice(0, 2).join(' ');
    const [man] = await db
      .select({ descricao: cp.descricao, valor: cp.valor })
      .from(cp)
      .where(
        and(
          eq(cp.filialId, casaFilialId),
          isNull(cp.dataDelete),
          ilike(cp.descricao, `%${nome}%`),
          sql`${cp.descricao} ~* ${`m[eê]s\\s*${mm}\\y`}`,
          sql`${cp.descricao} !~* '13'`,
        ),
      )
      .limit(1);
    if (man) i.pareceLancada = `${man.descricao} (R$ ${Number(man.valor).toFixed(2).replace('.', ',')})`;
  }
  const ordem = { repasse_eb: 0, repasse_lelis: 1, direto: 2 } as const;
  return lista.sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || a.descricao.localeCompare(b.descricao));
}

async function categoriaSalario(filialId: string): Promise<string | null> {
  const c = schema.categoriaConta;
  const cats = await db
    .select({ id: c.id, descricao: c.descricao })
    .from(c)
    .where(and(eq(c.filialId, filialId), isNull(c.excluidaEm), ilike(c.descricao, '%sal%rio%')));
  const limpa = (s: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const exata = cats.find((x) => ['salarios', 'salario'].includes(limpa(x.descricao)));
  if (exata) return exata.id;
  const outra = cats.find((x) => !limpa(x.descricao).includes('13') && !limpa(x.descricao).includes('orla'));
  return outra?.id ?? null;
}

/** Chave de uma pessoa da folha: CPF só dígitos, ou o nome. */
export function chavePessoa(x: { cpf: string | null; nome: string }): string {
  return digitos(x.cpf) || x.nome;
}

/** Prefixo do codigo_referencia das contas por pessoa na filial da E.B. (casa + mês). */
export function prefixoContaEb(casaFilialId: string, comp: string): string {
  return `fe:${comp}:${casaFilialId.slice(0, 8)}:`;
}

/**
 * Na filial da E.B., uma conta por pessoa do repasse da folha ("Salário MM/AAAA —
 * Fulano", favorecido o funcionário). A conta do repasse na casa não muda.
 * Pula quem já tem conta (mesmo codigo_referencia). Devolve quantas criou.
 */
export async function lancarContasEbDaFolha(
  tx: Tx,
  p: {
    ebFilialId: string;
    casaFilialId: string;
    casaNome: string;
    comp: string;
    vencimento: string;
    usuarioId: string;
    pessoas: ItemPagamentoFolha['pessoas'];
    /** Já pago (retroativo): grava data_pagamento/valor_pago e a baixa. */
    pagoEm?: string | null;
    obsBaixa?: string | null;
    /** Empresa que paga a pessoa. Padrão E.B.; 'Lelis' lança na filial da Lelis (11/11/2026). */
    empresa?: 'E.B.' | 'Lelis';
  },
): Promise<number> {
  const emp = p.empresa ?? 'E.B.';
  const cp = schema.contaPagar;
  const pref = prefixoContaEb(p.casaFilialId, p.comp);
  const ja = await tx
    .select({ ref: cp.codigoReferencia })
    .from(cp)
    .where(and(eq(cp.filialId, p.ebFilialId), ilike(cp.codigoReferencia, `${pref}%`), isNull(cp.dataDelete)));
  const jaRefs = new Set(ja.map((j) => j.ref));
  const categoriaId = await categoriaSalario(p.ebFilialId);
  let criadas = 0;
  for (const x of p.pessoas) {
    if (!(x.liquido > 0)) continue;
    const ref = `${pref}${digitos(x.cpf) || x.nome}`.slice(0, 50);
    if (jaRefs.has(ref)) continue;
    const fornecedorId = await fornecedorFuncionarioNaEb(tx, p.ebFilialId, x.nome, x.cpf, x.fornecedorId ?? null);
    const valor = x.liquido.toFixed(2);
    const [nova] = await tx.insert(cp).values({
      filialId: p.ebFilialId,
      criadoPor: p.usuarioId,
      criadoEm: new Date(),
      codigoExterno: null,
      fornecedorId,
      categoriaId,
      dataVencimento: p.vencimento,
      valor,
      descricao: `Salário ${mmAaaa(p.comp)} — ${x.nome}`,
      observacao: `Folha do sistema ${mmAaaa(p.comp)} — empregado da ${emp} lotado na ${p.casaNome}. A ${emp} paga a pessoa com o "Repasse ${emp} — Folha ${mmAaaa(p.comp)}" da casa.`,
      competencia: p.comp,
      codigoReferencia: ref,
      origem: 'FOLHA',
      folhaSemanaId: null,
      ...(p.pagoEm ? { dataPagamento: p.pagoEm, valorPago: valor } : {}),
    }).returning({ id: cp.id });
    if (p.pagoEm && nova) {
      await tx.insert(schema.contaPagarBaixa).values({
        filialId: p.ebFilialId,
        contaPagarId: nova.id,
        data: p.pagoEm,
        valor,
        observacao: p.obsBaixa ?? null,
        criadoPor: p.usuarioId,
      });
    }
    jaRefs.add(ref);
    criadas++;
  }
  return criadas;
}

/** Cria as contas escolhidas. Pula o que já foi lançado. */
export async function lancarPagamentosDaFolha(p: {
  casaFilialId: string;
  comp: string;
  refs: string[];
  vencimento: string;
  usuarioId: string;
  /** chave da pessoa (CPF só dígitos, ou nome) tirada do repasse da E.B. — ex.: admitido no fim do mês que o contador só paga no mês seguinte */
  fora?: string[];
}): Promise<{ criadas: number; puladas: number; total: number }> {
  const itens = await pagamentosDaFolha(p.casaFilialId, p.comp);
  const fora = new Set(p.fora ?? []);
  const tiradas = new Map<string, string[]>();
  for (const i of itens) {
    if (i.tipo !== 'repasse_eb' || !fora.size) continue;
    const sai = i.pessoas.filter((x) => fora.has(chavePessoa(x)));
    if (!sai.length) continue;
    tiradas.set(i.ref, sai.map((x) => x.nome));
    i.pessoas = i.pessoas.filter((x) => !fora.has(chavePessoa(x)));
    i.valor = Math.round(i.pessoas.reduce((t, x) => t + x.liquido, 0) * 100) / 100;
  }
  const escolhidos = itens.filter((i) => p.refs.includes(i.ref) && !i.jaLancadaId && i.valor > 0);
  if (!escolhidos.length) return { criadas: 0, puladas: p.refs.length, total: 0 };

  const categoriaId = await categoriaSalario(p.casaFilialId);
  const fornEb = escolhidos.some((i) => i.tipo === 'repasse_eb') ? await fornecedorPagadorNaCasa(p.casaFilialId, EB_CNPJ) : null;
  const fornLelis = escolhidos.some((i) => i.tipo === 'repasse_lelis')
    ? await fornecedorPagadorNaCasa(p.casaFilialId, LELIS_CNPJ)
    : null;

  // favorecido de quem a casa paga direto: o fornecedor do cadastro do funcionário
  const cpfsDiretos = escolhidos.filter((i) => i.tipo === 'direto').map((i) => digitos(i.pessoas[0]!.cpf)).filter((c) => c.length === 11);
  const fornPorCpf = new Map<string, string>();
  if (cpfsDiretos.length) {
    const f = schema.funcionario;
    const rows = await db
      .select({ cpf: f.cpf, fornecedorId: f.fornecedorId })
      .from(f)
      .where(and(eq(f.filialId, p.casaFilialId), sql`regexp_replace(coalesce(${f.cpf}, ''), '\\D', '', 'g') = any(${sql.raw(`array[${cpfsDiretos.map((c) => `'${c}'`).join(',')}]`)})`));
    for (const r of rows) if (r.fornecedorId) fornPorCpf.set(digitos(r.cpf), r.fornecedorId);
  }

  const ebFilial = escolhidos.some((i) => i.tipo === 'repasse_eb') ? await filialDoCnpj(EB_CNPJ) : null;
  const lelisFilial = escolhidos.some((i) => i.tipo === 'repasse_lelis') ? await filialDoCnpj(LELIS_CNPJ) : null;
  const [casaRow] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.casaFilialId))
    .limit(1);

  let total = 0;
  await db.transaction(async (tx) => {
    for (const i of escolhidos) {
      const fornecedorId =
        i.tipo === 'repasse_eb' ? fornEb : i.tipo === 'repasse_lelis' ? fornLelis : fornPorCpf.get(digitos(i.pessoas[0]!.cpf)) ?? null;
      const linhasPessoas = i.pessoas
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((x) => `${x.nome}: R$ ${x.liquido.toFixed(2).replace('.', ',')}`)
        .join('\n');
      const comoPagar =
        i.tipo === 'repasse_eb'
          ? 'Pix pra E.B. Serviços, que paga cada pessoa. Não pagar os funcionários direto.'
          : i.tipo === 'repasse_lelis'
            ? 'Pix pra Lelis, que paga o funcionário. Não pagar o funcionário direto.'
            : 'A casa paga o funcionário direto.';
      await tx.insert(schema.contaPagar).values({
        filialId: p.casaFilialId,
        criadoPor: p.usuarioId,
        criadoEm: new Date(),
        codigoExterno: null,
        fornecedorId,
        categoriaId,
        dataVencimento: p.vencimento,
        valor: i.valor.toFixed(2),
        descricao: i.descricao,
        observacao: `Folha do sistema ${mmAaaa(p.comp)} — ${i.empresa} (líquido calculado pelo ponto + salário do cadastro). ${comoPagar}\n${linhasPessoas}${
          tiradas.get(i.ref)?.length ? `\nFora deste lançamento: ${tiradas.get(i.ref)!.join(', ')}` : ''
        }`,
        competencia: p.comp,
        codigoReferencia: i.ref,
        origem: 'FOLHA',
        folhaSemanaId: null,
      });
      if (i.tipo === 'repasse_eb' && ebFilial) {
        await lancarContasEbDaFolha(tx, {
          ebFilialId: ebFilial.id,
          casaFilialId: p.casaFilialId,
          casaNome: casaRow?.nome ?? '',
          comp: p.comp,
          vencimento: p.vencimento,
          usuarioId: p.usuarioId,
          pessoas: i.pessoas,
        });
      }
      // Lelis: a mesma conta por pessoa, na filial da Lelis (dono 11/11/2026: "não
      // apareceu na lelis para poder mandar para claudio"). O repasse na casa não muda.
      if (i.tipo === 'repasse_lelis' && lelisFilial) {
        await lancarContasEbDaFolha(tx, {
          ebFilialId: lelisFilial.id,
          casaFilialId: p.casaFilialId,
          casaNome: casaRow?.nome ?? '',
          comp: p.comp,
          vencimento: p.vencimento,
          usuarioId: p.usuarioId,
          pessoas: i.pessoas,
          empresa: 'Lelis',
        });
      }
      total += i.valor;
    }
  });
  return { criadas: escolhidos.length, puladas: p.refs.length - escolhidos.length, total: Math.round(total * 100) / 100 };
}

/**
 * Relançar (pedido do dono 05/11/2026: "alterei a hora do Rivaldo" / "como
 * relançar tudo?"). Exclui as contas já lançadas pelo botão (soft delete, com
 * registro de exclusão: quem, quando, motivo e a foto da conta) e lança de novo
 * com o valor de agora. Só mexe em conta SEM pagamento: paga, com baixa, presa
 * num Pix do sistema ou num borderô → recusa tudo e não apaga nada.
 */
export async function relancarPagamentosDaFolha(p: {
  casaFilialId: string;
  comp: string;
  refs: string[];
  vencimento: string;
  usuarioId: string;
  fora?: string[];
  motivo?: string | null;
}): Promise<{ excluidas: number; criadas: number; puladas: number; total: number }> {
  const itens = await pagamentosDaFolha(p.casaFilialId, p.comp);
  const ids = itens.filter((i) => p.refs.includes(i.ref) && i.jaLancadaId).map((i) => i.jaLancadaId!);
  if (ids.length) {
    const cp = schema.contaPagar;
    const contas = await db
      .select({
        id: cp.id,
        descricao: cp.descricao,
        valor: cp.valor,
        venc: cp.dataVencimento,
        dataPagamento: cp.dataPagamento,
        borderoId: cp.borderoId,
        fornecedorId: cp.fornecedorId,
        observacao: cp.observacao,
        codigoReferencia: cp.codigoReferencia,
        baixas: sql<string>`(select count(*) from conta_pagar_baixa b where b.conta_pagar_id = ${cp.id})::text`,
      })
      .from(cp)
      .where(and(eq(cp.filialId, p.casaFilialId), inArray(cp.id, ids), isNull(cp.dataDelete)));
    const emPix = await contasEmPixAberto(p.casaFilialId);
    const presas = contas.filter((c) => c.dataPagamento || Number(c.baixas) > 0 || c.borderoId || emPix.has(c.id));
    if (presas.length) {
      throw new Error(
        `Não dá pra relançar: já tem pagamento (pago, baixa, Pix do sistema ou borderô) em ${presas.map((c) => c.descricao).join('; ')}. Desmarque essas e relance o resto.`,
      );
    }
    for (const c of contas) {
      await registrarExclusao({
        tabela: 'conta_pagar',
        registroId: c.id,
        filialId: p.casaFilialId,
        usuarioId: p.usuarioId,
        resumo: resumoConta(c.descricao, c.venc, c.valor),
        motivo: `Relançar folha ${mmAaaa(p.comp)}${p.motivo ? `: ${p.motivo}` : ' (valor recalculado)'}`,
        dados: c,
      });
      await db.update(cp).set({ dataDelete: new Date() }).where(and(eq(cp.id, c.id), isNull(cp.dataPagamento)));
    }
    // contas por pessoa na E.B. do repasse relançado: saem junto (só as sem pagamento)
    const repasseEb = itens.find((i) => p.refs.includes(i.ref) && i.tipo === 'repasse_eb' && i.jaLancadaId);
    const ebFilial = repasseEb ? await filialDoCnpj(EB_CNPJ) : null;
    if (ebFilial) {
      const doEb = await db
        .select({
          id: cp.id,
          descricao: cp.descricao,
          valor: cp.valor,
          venc: cp.dataVencimento,
          dataPagamento: cp.dataPagamento,
          borderoId: cp.borderoId,
          codigoReferencia: cp.codigoReferencia,
          baixas: sql<string>`(select count(*) from conta_pagar_baixa b where b.conta_pagar_id = ${cp.id})::text`,
        })
        .from(cp)
        .where(
          and(
            eq(cp.filialId, ebFilial.id),
            ilike(cp.codigoReferencia, `${prefixoContaEb(p.casaFilialId, p.comp)}%`),
            isNull(cp.dataDelete),
          ),
        );
      const emPixEb = await contasEmPixAberto(ebFilial.id);
      for (const c of doEb) {
        if (c.dataPagamento || Number(c.baixas) > 0 || c.borderoId || emPixEb.has(c.id)) continue;
        await registrarExclusao({
          tabela: 'conta_pagar',
          registroId: c.id,
          filialId: ebFilial.id,
          usuarioId: p.usuarioId,
          resumo: resumoConta(c.descricao, c.venc, c.valor),
          motivo: `Relançar folha ${mmAaaa(p.comp)}${p.motivo ? `: ${p.motivo}` : ' (valor recalculado)'}`,
          dados: c,
        });
        await db.update(cp).set({ dataDelete: new Date() }).where(and(eq(cp.id, c.id), isNull(cp.dataPagamento)));
      }
    }
    // contas por pessoa na Lelis dos repasses relançados: saem junto (só as sem pagamento)
    const repassesLelis = itens.filter((i) => p.refs.includes(i.ref) && i.tipo === 'repasse_lelis' && i.jaLancadaId);
    const lelisFilial = repassesLelis.length ? await filialDoCnpj(LELIS_CNPJ) : null;
    if (lelisFilial) {
      const pref = prefixoContaEb(p.casaFilialId, p.comp);
      const refsLelis = repassesLelis.flatMap((i) => i.pessoas.map((x) => `${pref}${digitos(x.cpf) || x.nome}`.slice(0, 50)));
      const daLelis = refsLelis.length
        ? await db
            .select({
              id: cp.id,
              descricao: cp.descricao,
              valor: cp.valor,
              venc: cp.dataVencimento,
              dataPagamento: cp.dataPagamento,
              borderoId: cp.borderoId,
              codigoReferencia: cp.codigoReferencia,
              baixas: sql<string>`(select count(*) from conta_pagar_baixa b where b.conta_pagar_id = ${cp.id})::text`,
            })
            .from(cp)
            .where(and(eq(cp.filialId, lelisFilial.id), inArray(cp.codigoReferencia, refsLelis), isNull(cp.dataDelete)))
        : [];
      const emPixLelis = await contasEmPixAberto(lelisFilial.id);
      for (const c of daLelis) {
        if (c.dataPagamento || Number(c.baixas) > 0 || c.borderoId || emPixLelis.has(c.id)) continue;
        await registrarExclusao({
          tabela: 'conta_pagar',
          registroId: c.id,
          filialId: lelisFilial.id,
          usuarioId: p.usuarioId,
          resumo: resumoConta(c.descricao, c.venc, c.valor),
          motivo: `Relançar folha ${mmAaaa(p.comp)}${p.motivo ? `: ${p.motivo}` : ' (valor recalculado)'}`,
          dados: c,
        });
        await db.update(cp).set({ dataDelete: new Date() }).where(and(eq(cp.id, c.id), isNull(cp.dataPagamento)));
      }
    }
  }
  const r = await lancarPagamentosDaFolha({
    casaFilialId: p.casaFilialId,
    comp: p.comp,
    refs: p.refs,
    vencimento: p.vencimento,
    usuarioId: p.usuarioId,
    fora: p.fora,
  });
  return { excluidas: ids.length, ...r };
}
