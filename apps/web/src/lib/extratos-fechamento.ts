// Extratos bancários do fechamento do mês: de quais contas o extrato é pedido,
// o que já foi enviado e quem enxerga o quê. Ver o schema em
// packages/db/src/schema/extrato-fechamento.ts.
//
// Quem enxerga:
//   - conta de uma casa → quem tem aquela casa em usuario_filial;
//   - conta de empresa do grupo que não é uma das casas (Leles, E.B.) → só quem
//     enxerga TODAS as casas que têm conta na lista (o dono, o financeiro do
//     grupo, o contador). O gerente de uma casa só não vê o extrato da E.B.
//
// Permissão: ver e baixar = quem já vê o Fechamento do mês (relatorio.read);
// enviar, tirar arquivo e mexer na lista de contas = quem fecha o mês
// (conciliacao.fechar).

import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

export const BUCKET_EXTRATOS = 'extratos-fechamento';
export const PERM_EXTRATO_VER = 'relatorio.read';
export const PERM_EXTRATO_ENVIAR = 'conciliacao.fechar';
export const EXTRATO_TAMANHO_MAX = 50 * 1024 * 1024;
export const EXTRATO_EXTENSOES = ['pdf', 'ofx', 'csv', 'xls', 'xlsx', 'txt', 'ret', 'png', 'jpg', 'jpeg', 'zip'];

export interface ContaExtrato {
  id: string;
  organizacaoId: string;
  filialId: string | null;
  /** Nome da casa ou da empresa dona da conta. */
  titular: string;
  banco: string;
  apelido: string | null;
  ativo: boolean;
}

export interface ArquivoExtrato {
  id: string;
  contaId: string;
  nome: string;
  tamanhoBytes: number | null;
  enviadoEm: string;
  enviadoPor: string | null;
}

export interface ContaExtratoDoMes extends ContaExtrato {
  arquivos: ArquivoExtrato[];
}

interface AcessoExtratos {
  filiais: Array<{ id: string; nome: string; organizacaoId: string }>;
  contas: ContaExtrato[];
  /** Organizações em que o usuário enxerga as contas de empresa (sem casa). */
  orgsComEmpresas: Set<string>;
}

async function acessoExtratos(userId: string): Promise<AcessoExtratos> {
  const filiais = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome, organizacaoId: schema.filial.organizacaoId })
    .from(schema.usuarioFilial)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.usuarioFilial.filialId))
    .where(eq(schema.usuarioFilial.usuarioId, userId))
    .orderBy(asc(schema.filial.cnpj));
  const orgIds = [...new Set(filiais.map((f) => f.organizacaoId))];
  if (orgIds.length === 0) return { filiais, contas: [], orgsComEmpresas: new Set() };

  const linhas = await db
    .select({
      id: schema.extratoConta.id,
      organizacaoId: schema.extratoConta.organizacaoId,
      filialId: schema.extratoConta.filialId,
      empresa: schema.extratoConta.empresa,
      filialNome: schema.filial.nome,
      banco: schema.extratoConta.banco,
      apelido: schema.extratoConta.apelido,
      ativo: schema.extratoConta.ativo,
    })
    .from(schema.extratoConta)
    .leftJoin(schema.filial, eq(schema.filial.id, schema.extratoConta.filialId))
    .where(inArray(schema.extratoConta.organizacaoId, orgIds))
    .orderBy(asc(schema.extratoConta.ordem), asc(schema.extratoConta.criadoEm));

  const minhas = new Set(filiais.map((f) => f.id));
  const orgsComEmpresas = new Set<string>();
  for (const orgId of orgIds) {
    const casasDaLista = new Set(
      linhas.filter((l) => l.organizacaoId === orgId && l.filialId).map((l) => l.filialId as string),
    );
    if ([...casasDaLista].every((id) => minhas.has(id))) orgsComEmpresas.add(orgId);
  }

  const contas: ContaExtrato[] = linhas
    .filter((l) => (l.filialId ? minhas.has(l.filialId) : orgsComEmpresas.has(l.organizacaoId)))
    .map((l) => ({
      id: l.id,
      organizacaoId: l.organizacaoId,
      filialId: l.filialId,
      titular: l.filialId ? (l.filialNome ?? 'Casa') : (l.empresa ?? 'Outra empresa'),
      banco: l.banco,
      apelido: l.apelido,
      ativo: l.ativo,
    }));
  return { filiais, contas, orgsComEmpresas };
}

/** Contas de que o extrato é pedido e que este usuário enxerga. */
export async function contasExtratoVisiveis(userId: string): Promise<ContaExtrato[]> {
  return (await acessoExtratos(userId)).contas;
}

/** A conta, se o usuário enxerga; senão null. */
export async function contaExtratoVisivel(userId: string, contaId: string): Promise<ContaExtrato | null> {
  const contas = await contasExtratoVisiveis(userId);
  return contas.find((c) => c.id === contaId) ?? null;
}

/** Onde este usuário pode cadastrar conta: nas casas dele e, se enxerga o grupo todo, em empresa avulsa. */
export async function destinosNovaContaExtrato(userId: string): Promise<{
  filiais: Array<{ id: string; nome: string; organizacaoId: string }>;
  organizacaoEmpresas: string | null;
}> {
  const a = await acessoExtratos(userId);
  return { filiais: a.filiais, organizacaoEmpresas: [...a.orgsComEmpresas][0] ?? null };
}

/**
 * Lista do mês: cada conta com os arquivos enviados. Vem também a conta
 * desligada — a tela só a mostra no mês em que tem arquivo, e à parte pra poder
 * voltar a pedir.
 */
export async function extratosDoMes(userId: string, ano: number, mes: number): Promise<ContaExtratoDoMes[]> {
  const contas = await contasExtratoVisiveis(userId);
  if (contas.length === 0) return [];
  const linhas = await db
    .select({
      id: schema.extratoArquivo.id,
      contaId: schema.extratoArquivo.contaId,
      nome: schema.extratoArquivo.nomeOriginal,
      tamanhoBytes: schema.extratoArquivo.tamanhoBytes,
      enviadoEm: schema.extratoArquivo.enviadoEm,
      usuarioNome: schema.usuario.nome,
      usuarioEmail: schema.usuario.email,
    })
    .from(schema.extratoArquivo)
    .leftJoin(schema.usuario, eq(schema.usuario.id, schema.extratoArquivo.enviadoPor))
    .where(
      and(
        inArray(schema.extratoArquivo.contaId, contas.map((c) => c.id)),
        eq(schema.extratoArquivo.ano, ano),
        eq(schema.extratoArquivo.mes, mes),
        isNull(schema.extratoArquivo.excluidoEm),
      ),
    )
    .orderBy(asc(schema.extratoArquivo.enviadoEm));

  const porConta = new Map<string, ArquivoExtrato[]>();
  for (const l of linhas) {
    const lista = porConta.get(l.contaId) ?? [];
    lista.push({
      id: l.id,
      contaId: l.contaId,
      nome: l.nome,
      tamanhoBytes: l.tamanhoBytes,
      enviadoEm: l.enviadoEm.toISOString(),
      enviadoPor: l.usuarioNome || l.usuarioEmail || null,
    });
    porConta.set(l.contaId, lista);
  }
  return contas.map((c) => ({ ...c, arquivos: porConta.get(c.id) ?? [] }));
}

export function periodoExtratoValido(ano: number, mes: number): boolean {
  return Number.isInteger(ano) && Number.isInteger(mes) && ano >= 2015 && ano <= 2100 && mes >= 1 && mes <= 12;
}

export function extensaoExtrato(nome: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(nome.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** Pasta da conta no mês dentro do bucket. O caminho do arquivo sempre começa por ela. */
export function pastaExtrato(contaId: string, ano: number, mes: number): string {
  return `${contaId}/${ano}-${String(mes).padStart(2, '0')}`;
}

/**
 * Nome com que o extrato é baixado: mês, dono da conta e banco na frente do
 * nome original, pra o contador saber de quem é cada arquivo. Só letra, número,
 * ponto, espaço e traço — o bucket devolve acento e parêntese embaralhados
 * ("Ita%C3%BA", "%28").
 */
export function nomeDownloadExtrato(
  conta: { titular: string; banco: string; apelido: string | null },
  ano: number,
  mes: number,
  nomeOriginal: string,
): string {
  const limpo = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  const dono = [conta.titular, conta.banco, conta.apelido].filter(Boolean).join(' ');
  return `${ano}-${String(mes).padStart(2, '0')} ${limpo(dono)} - ${limpo(nomeOriginal)}`;
}
