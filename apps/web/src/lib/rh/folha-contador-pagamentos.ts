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
//   - Empresa da própria casa (Prainha Turismo no Bar): UMA conta por pessoa,
//     favorecido o funcionário (a casa paga direto).
// Não lança duas vezes: codigo_referencia `fc:<comp>:<cnpj>[:<cpf>]` na casa (coluna tem 50).
// Conta manual parecida (nome da pessoa + "mes MM" na casa) aparece como
// "parece já lançada" e fica fora por padrão.

import { db, schema } from '@concilia/db';
import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { EB_CNPJ } from '@/lib/eb/faturas';
import { LELIS_CNPJ, fornecedorPagadorNaCasa } from '@/lib/impostos/guia';
import { nossaFolhaDoMes } from '@/lib/rh/nossa-folha';

export interface ItemPagamentoFolha {
  ref: string;
  casaFilialId: string;
  empresa: string;
  cnpj: string;
  tipo: 'repasse_eb' | 'repasse_lelis' | 'direto';
  descricao: string;
  pessoas: { nome: string; cpf: string | null; liquido: number }[];
  valor: number;
  /** Conta já criada por este botão. */
  jaLancadaId: string | null;
  /** Conta manual que parece ser a mesma (não lança por padrão). */
  pareceLancada: string | null;
  /** Funcionário sem cadastro de favorecido (só no 'direto'). */
  semFavorecido: string[];
}

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

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

  const itens = new Map<string, ItemPagamentoFolha>();
  for (const l of linhas) {
    // sem empresa de registro = a própria casa paga
    const cnpj = digitos(l.cnpjRegistro) || casaCnpj;
    const empresa = l.empresaRegistro || casa?.nome || '';
    const liquido = l.liquido;
    if (!(liquido > 0)) continue;
    // saiu no mês → vai pela rescisão, não pela folha (senão paga em dobro)
    if (l.desligamento && l.desligamento.slice(0, 7) === comp) continue;
    const pessoa = { nome: l.nome, cpf: l.cpf, liquido };
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
    .select({ id: cp.id, ref: cp.codigoReferencia })
    .from(cp)
    .where(and(eq(cp.filialId, casaFilialId), inArray(cp.codigoReferencia, lista.map((i) => i.ref)), isNull(cp.dataDelete)));
  const porRef = new Map(ja.map((j) => [j.ref, j.id]));

  // lançamento manual parecido: nome da pessoa + "mes MM"/"mês MM" na casa
  const mm = comp.split('-')[1]!;
  for (const i of lista) {
    i.jaLancadaId = porRef.get(i.ref) ?? null;
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

/** Cria as contas escolhidas. Pula o que já foi lançado. */
export async function lancarPagamentosDaFolha(p: {
  casaFilialId: string;
  comp: string;
  refs: string[];
  vencimento: string;
  usuarioId: string;
}): Promise<{ criadas: number; puladas: number; total: number }> {
  const itens = await pagamentosDaFolha(p.casaFilialId, p.comp);
  const escolhidos = itens.filter((i) => p.refs.includes(i.ref) && !i.jaLancadaId);
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
        observacao: `Folha do sistema ${mmAaaa(p.comp)} — ${i.empresa} (líquido calculado pelo ponto + salário do cadastro). ${comoPagar}\n${linhasPessoas}`,
        competencia: p.comp,
        codigoReferencia: i.ref,
        origem: 'FOLHA',
        folhaSemanaId: null,
      });
      total += i.valor;
    }
  });
  return { criadas: escolhidos.length, puladas: p.refs.length - escolhidos.length, total: Math.round(total * 100) / 100 };
}
