// Extrato de empresa que paga pessoal e não é uma das casas (E.B. Serviços) —
// busca na API do Inter e grava em `extrato_empresa`, e confere a folha do
// contador pessoa por pessoa contra os débitos desse extrato.
//
// Só leitura no banco (escopo extrato.read). Nada aqui dá baixa, gera conta
// ou mexe em `lancamento_banco`.

import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { buscarExtratoInter, credenciaisInterEmpresa, idTransacaoDeterministico } from '@/lib/inter';

/** Empresas com extrato próprio. A sigla vira o prefixo da env (`INTER_EB_*`). */
export const EMPRESAS_EXTRATO = {
  EB: { nome: 'E.B. Serviços', cnpj: '05486249000172' },
} as const;
export type SiglaEmpresa = keyof typeof EMPRESAS_EXTRATO;

export function extratoEmpresaConfigurado(sigla: SiglaEmpresa): boolean {
  return credenciaisInterEmpresa(sigla) !== null;
}

function somarDiasYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Busca o extrato da empresa de `inicio` a `fim` (YYYY-MM-DD) e grava o que
 * ainda não está. O Inter limita o período por consulta, então vai em janelas
 * de 30 dias. Idempotente: a mesma transação não entra duas vezes.
 */
export async function sincronizarExtratoEmpresa(
  sigla: SiglaEmpresa,
  inicio: string,
  fim: string,
): Promise<{ lidos: number; inseridos: number }> {
  const cred = credenciaisInterEmpresa(sigla);
  if (!cred) throw new Error(`Credencial INTER_${sigla}_* não configurada`);

  let lidos = 0;
  let inseridos = 0;
  for (let de = inicio; de <= fim; de = somarDiasYmd(de, 30)) {
    const ate = somarDiasYmd(de, 29) < fim ? somarDiasYmd(de, 29) : fim;
    const transacoes = await buscarExtratoInter(cred, de, ate);
    if (transacoes.length === 0) continue;
    lidos += transacoes.length;
    const ids = idTransacaoDeterministico(transacoes);
    const dados = transacoes.map((t, i) => ({
      empresa: sigla,
      dataMovimento: t.dataEntrada,
      tipo: t.tipoOperacao,
      valor: String(Number(t.valor)),
      codigoHistorico: (t.tipoTransacao || '').slice(0, 30) || null,
      titulo: t.titulo || null,
      descricao: t.descricao || null,
      idTransacao: ids[i]!,
    }));
    for (let i = 0; i < dados.length; i += 500) {
      const r = await db
        .insert(schema.extratoEmpresa)
        .values(dados.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ id: schema.extratoEmpresa.id });
      inseridos += r.length;
    }
  }
  return { lidos, inseridos };
}

export async function resumoExtratoEmpresa(sigla: SiglaEmpresa) {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      de: sql<string | null>`min(${schema.extratoEmpresa.dataMovimento})::text`,
      ate: sql<string | null>`max(${schema.extratoEmpresa.dataMovimento})::text`,
      importadoEm: sql<Date | null>`max(${schema.extratoEmpresa.importadoEm})`,
    })
    .from(schema.extratoEmpresa)
    .where(eq(schema.extratoEmpresa.empresa, sigla));
  return r ?? { total: 0, de: null, ate: null, importadoEm: null };
}

// ---------------------------------------------------------------------------
// Conferência: folha do contador × débitos do extrato
// ---------------------------------------------------------------------------

const SEM_PESO = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

export function normalizarNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O débito é dessa pessoa? Exige o primeiro nome e mais um sobrenome dela no
 * texto do lançamento (o banco corta e abrevia nomes, então não dá pra exigir
 * o nome inteiro). Nome de uma palavra só não casa por nome.
 */
export function debitoEhDaPessoa(nome: string, textoLancamento: string): boolean {
  const partes = normalizarNome(nome).split(' ').filter((p) => p.length > 1 && !SEM_PESO.has(p));
  if (partes.length < 2) return false;
  const palavras = new Set(normalizarNome(textoLancamento).split(' '));
  if (!palavras.has(partes[0]!)) return false;
  return partes.slice(1).some((p) => palavras.has(p));
}

export interface DebitoExtrato {
  id: string;
  dia: string;
  valor: number;
  historico: string | null;
  texto: string;
}

export type SituacaoPagamento = 'bate' | 'difere' | 'so_valor' | 'nao_achou' | 'sem_liquido';

export interface LinhaConferencia {
  folhaId: string;
  filialId: string;
  funcionarioId: string | null;
  nome: string;
  departamento: string | null;
  situacaoFolha: string | null;
  liquido: number;
  situacao: SituacaoPagamento;
  /** Débitos com o nome da pessoa (ou, em 'so_valor', o de valor igual sem nome). */
  debitos: DebitoExtrato[];
  pago: number;
}

/** Janela em que o líquido de uma competência costuma sair: do dia 20 do mês até o dia 20 do mês seguinte. */
export function janelaDaCompetencia(comp: string): { de: string; ate: string } {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { de: `${comp}-20`, ate: `${prox}-20` };
}

export async function conferirFolhaComExtrato(
  sigla: SiglaEmpresa,
  competencia: string,
  filialIds: string[],
): Promise<{ linhas: LinhaConferencia[]; debitosSemPessoa: DebitoExtrato[]; janela: { de: string; ate: string } }> {
  const janela = janelaDaCompetencia(competencia);
  const folha = (
    await db
      .select({
        id: schema.folhaContador.id,
        filialId: schema.folhaContador.filialId,
        funcionarioId: schema.folhaContador.funcionarioId,
        nome: schema.folhaContador.nome,
        departamento: schema.folhaContador.departamento,
        situacao: schema.folhaContador.situacao,
        liquido: schema.folhaContador.liquido,
      })
      .from(schema.folhaContador)
      .where(
        and(eq(schema.folhaContador.cnpj, EMPRESAS_EXTRATO[sigla].cnpj), eq(schema.folhaContador.competencia, competencia)),
      )
      .orderBy(asc(schema.folhaContador.nome))
  ).filter((f) => filialIds.includes(f.filialId));

  const debitos: DebitoExtrato[] = (
    await db
      .select({
        id: schema.extratoEmpresa.id,
        dia: sql<string>`${schema.extratoEmpresa.dataMovimento}::text`,
        valor: schema.extratoEmpresa.valor,
        historico: schema.extratoEmpresa.codigoHistorico,
        titulo: schema.extratoEmpresa.titulo,
        descricao: schema.extratoEmpresa.descricao,
      })
      .from(schema.extratoEmpresa)
      .where(
        and(
          eq(schema.extratoEmpresa.empresa, sigla),
          eq(schema.extratoEmpresa.tipo, 'D'),
          gte(schema.extratoEmpresa.dataMovimento, janela.de),
          lte(schema.extratoEmpresa.dataMovimento, janela.ate),
        ),
      )
      .orderBy(asc(schema.extratoEmpresa.dataMovimento))
  ).map((d) => ({
    id: d.id,
    dia: d.dia,
    valor: Number(d.valor),
    historico: d.historico,
    texto: [d.titulo, d.descricao].filter(Boolean).join(' — '),
  }));

  const usados = new Set<string>();
  const cent = (v: number) => Math.round(v * 100);
  const linhas: LinhaConferencia[] = folha.map((f) => {
    const liquido = Number(f.liquido);
    const doNome = debitos.filter((d) => debitoEhDaPessoa(f.nome, d.texto));
    doNome.forEach((d) => usados.add(d.id));
    const pago = doNome.reduce((s, d) => s + d.valor, 0);
    let situacao: SituacaoPagamento;
    if (liquido <= 0) situacao = 'sem_liquido';
    else if (doNome.length === 0) situacao = 'nao_achou';
    else if (cent(pago) === cent(liquido) || doNome.some((d) => cent(d.valor) === cent(liquido))) situacao = 'bate';
    else situacao = 'difere';
    return {
      folhaId: f.id,
      filialId: f.filialId,
      funcionarioId: f.funcionarioId,
      nome: f.nome,
      departamento: f.departamento,
      situacaoFolha: f.situacao,
      liquido,
      situacao,
      debitos: doNome,
      pago,
    };
  });

  // Quem ficou sem débito no nome: procura um débito de valor igual que não é de ninguém.
  for (const l of linhas) {
    if (l.situacao !== 'nao_achou') continue;
    const igual = debitos.find((d) => !usados.has(d.id) && cent(d.valor) === cent(l.liquido));
    if (igual) {
      usados.add(igual.id);
      l.situacao = 'so_valor';
      l.debitos = [igual];
    }
  }

  return { linhas, debitosSemPessoa: debitos.filter((d) => !usados.has(d.id)), janela };
}
