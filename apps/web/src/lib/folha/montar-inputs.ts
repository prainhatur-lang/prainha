// Monta os inputs pro motor de calculo (calcularFolha) a partir do banco:
// pessoas ativas da filial, horas da semana, ajustes manuais + bonus
// automatico injetado do cadastro (fornecedor_folha.bonusFixoSemanal/
// bonusPorDia). Extraido de preview/fechar/exportar, que tinham essa mesma
// logica copiada 3x (e ja tinha divergido — um usava `diasComHoras`, os
// outros recalculavam como `diasTrab`, mesmo resultado mas duplicado).

import { db, schema } from '@concilia/db';
import { and, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm';
import { minutosNoturnos } from '@/lib/rh/calcular-ponto';
import type { ConfigFolha, PessoaInput } from './calcular';
import { contasPorCpf, temConta } from '@/lib/rh/conta-da-pessoa';

export type AjusteTipo = 'desconto' | 'acrescimo' | 'premiacao';
export type AjustesMap = Map<string, Array<{ tipo: AjusteTipo; valor: number; descricao?: string }>>;

export interface InputsFolha {
  config: typeof schema.folhaConfig.$inferSelect;
  cfg: ConfigFolha;
  pessoasRows: Array<{
    fornecedorId: string;
    papel: string;
    gerenteModelo: string | null;
    gerenteValorFixoDia: string | null;
    diaristaTaxaHoraOverride: string | null;
    diaristaModelo: string | null;
    diaristaValorFixoDia: string | null;
    bonusFixoSemanal: string | null;
    bonusPorDia: string | null;
    nome: string | null;
    cpf?: string | null;
    bancoNome?: string | null;
    bancoAgencia?: string | null;
    bancoConta?: string | null;
    chavePix?: string | null;
    /** Conta/PIX veio do cadastro da pessoa em outra casa (nome da casa) —
     *  o desta casa estava vazio. */
    contaDeOutraCasa?: string | null;
  }>;
  pessoas: PessoaInput[];
  horasMap: Map<string, Record<string, number>>;
  ajustesMap: AjustesMap;
  /** Perdas/quebras da semana somadas por dia: { 'YYYY-MM-DD': valor }.
   *  Abatem o pote dos funcionarios daquele dia no motor. */
  perdasPorDia: Record<string, number>;
  /** Adicional noturno da semana por fornecedor: minutos noturnos reduzidos
   *  (ponto_dia.pares) + taxa/hora do intermitente. Vai pro motor. */
  noturno: Record<string, { fictoMin: number; taxaHora: number | null }>;
}

/** Carrega config+pessoas+horas+ajustes de uma folha e monta os inputs
 *  prontos pro motor — incluindo a injeção do bônus automático do cadastro
 *  como ajustes tipo='acrescimo'. Retorna null se a filial não tem
 *  folha_config (chamador decide como reportar). */
export async function montarInputsFolha(folhaSemanaId: string, filialId: string): Promise<InputsFolha | null> {
  const [config] = await db
    .select()
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, filialId))
    .limit(1);
  if (!config) return null;

  const pessoasRows = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      papel: schema.fornecedorFolha.papel,
      gerenteModelo: schema.fornecedorFolha.gerenteModelo,
      gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
      diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
      diaristaModelo: schema.fornecedorFolha.diaristaModelo,
      diaristaValorFixoDia: schema.fornecedorFolha.diaristaValorFixoDia,
      bonusFixoSemanal: schema.fornecedorFolha.bonusFixoSemanal,
      bonusPorDia: schema.fornecedorFolha.bonusPorDia,
      nome: schema.fornecedor.nome,
      cpf: schema.fornecedor.cnpjOuCpf,
      bancoNome: schema.fornecedor.bancoNome,
      bancoAgencia: schema.fornecedor.bancoAgencia,
      bancoConta: schema.fornecedor.bancoConta,
      chavePix: schema.fornecedor.chavePix,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId))
    .where(and(eq(schema.fornecedor.filialId, filialId), eq(schema.fornecedorFolha.ativo, true)));

  // Quem circula entre casas tem a conta digitada numa só: sem conta aqui,
  // paga na conta que a pessoa tem na outra casa (mesmo CPF).
  const semConta = pessoasRows.filter((p) => !temConta(p) && p.cpf);
  if (semConta.length > 0) {
    const contas = await contasPorCpf(semConta.map((p) => p.cpf as string), filialId);
    for (const p of semConta) {
      const c = contas.get((p.cpf as string).replace(/\D/g, ''));
      if (!c) continue;
      Object.assign(p, {
        chavePix: c.chavePix,
        bancoNome: c.bancoNome,
        bancoAgencia: c.bancoAgencia,
        bancoConta: c.bancoConta,
        contaDeOutraCasa: c.filialNome,
      });
    }
  }

  const horasRows = await db.select().from(schema.folhaHoras).where(eq(schema.folhaHoras.folhaSemanaId, folhaSemanaId));
  const ajustesRows = await db.select().from(schema.folhaAjuste).where(eq(schema.folhaAjuste.folhaSemanaId, folhaSemanaId));
  const perdasRows = await db.select().from(schema.folhaPerda).where(eq(schema.folhaPerda.folhaSemanaId, folhaSemanaId));

  const perdasPorDia: Record<string, number> = {};
  for (const pd of perdasRows) {
    perdasPorDia[pd.dia] = (perdasPorDia[pd.dia] ?? 0) + Number(pd.valor);
  }

  const horasMap = new Map<string, Record<string, number>>();
  for (const h of horasRows) {
    const cur = horasMap.get(h.fornecedorId) ?? {};
    cur[h.dia] = h.totalMin;
    horasMap.set(h.fornecedorId, cur);
  }

  const ajustesMap: AjustesMap = new Map();
  for (const a of ajustesRows) {
    const cur = ajustesMap.get(a.fornecedorId) ?? [];
    cur.push({ tipo: a.tipo as AjusteTipo, valor: Number(a.valor), descricao: a.descricao ?? undefined });
    ajustesMap.set(a.fornecedorId, cur);
  }

  // Injeta bônus fixo semanal e por dia como acréscimos automáticos (vem do
  // cadastro — sem precisar lançar manual a cada folha). SÓ se a pessoa
  // trabalhou na semana (>=1 dia com horas) — quem faltou a semana toda não
  // recebe. Calcula diasComHoras 1x (as 3 cópias antigas recalculavam pro
  // bônus por dia — mesmo resultado, mas redundante).
  //
  // GERENTE sem ponto: usa os dias com movimento da loja (10% > 0) como
  // fallback — mesma regra do pró-labore fixo_por_dia em calcular.ts.
  // Gerente normalmente não bate ponto, e sem esse fallback o bônus fixo do
  // cadastro era ignorado (Paulo sumiu da folha 07–13/09/2026 por isso).
  //
  // MAS gerente que BATE PONTO (tem horas em semana anterior desta filial)
  // sem horas na semana = faltou/trabalhou em outra casa — não ganha o
  // fallback (Cauã, chefe da Tabuará, passou 14–20/09/2026 na Prainha Bar e
  // a Tabuará ia pagar 7 dias "da loja"). Só quem NUNCA bateu ponto na
  // filial usa os dias com movimento.
  const [folhaRow] = await db
    .select({
      dezPctPorDia: schema.folhaSemana.dezPctPorDia,
      dataInicio: schema.folhaSemana.dataInicio,
      dataFim: schema.folhaSemana.dataFim,
    })
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, folhaSemanaId))
    .limit(1);
  const dezPctPorDia = (folhaRow?.dezPctPorDia as Record<string, number> | null) ?? {};
  const diasLoja = Object.values(dezPctPorDia).filter((v) => Number(v) > 0).length;
  const gerentesBatemPonto = await gerentesComPontoAnterior(
    filialId,
    folhaRow?.dataInicio ?? null,
    pessoasRows.filter((p) => p.papel === 'gerente').map((p) => p.fornecedorId),
  );

  for (const p of pessoasRows) {
    const porDia = horasMap.get(p.fornecedorId) ?? {};
    const diasComPonto = Object.values(porDia).filter((m) => m > 0).length;
    const usaDiasLoja = diasComPonto === 0 && p.papel === 'gerente' && !gerentesBatemPonto.has(p.fornecedorId);
    const diasComHoras = usaDiasLoja ? diasLoja : diasComPonto;
    if (diasComHoras === 0) continue;

    if (p.bonusFixoSemanal != null && Number(p.bonusFixoSemanal) > 0) {
      const cur = ajustesMap.get(p.fornecedorId) ?? [];
      cur.push({ tipo: 'acrescimo', valor: Number(p.bonusFixoSemanal), descricao: '💰 Bônus fixo semanal (cadastro)' });
      ajustesMap.set(p.fornecedorId, cur);
    }
    if (p.bonusPorDia != null && Number(p.bonusPorDia) > 0) {
      const valorDia = Number(p.bonusPorDia);
      const cur = ajustesMap.get(p.fornecedorId) ?? [];
      cur.push({
        tipo: 'acrescimo',
        valor: valorDia * diasComHoras,
        descricao: `🗓 Bônus por dia (${diasComHoras} × R$ ${valorDia.toFixed(2)})`,
      });
      ajustesMap.set(p.fornecedorId, cur);
    }
  }

  const cfg: ConfigFolha = {
    ppEmpresa: Number(config.ppEmpresa),
    ppGerente: Number(config.ppGerente),
    ppFuncionarios: Number(config.ppFuncionarios),
    taxaDiaristaHora: Number(config.taxaDiaristaHora),
    auxTransporteAtivo: config.auxTransporteAtivo,
    auxTransporteValorHora: config.auxTransporteValorHora ? Number(config.auxTransporteValorHora) : null,
    auxTransporteDias: (config.auxTransporteDias as Record<string, boolean> | null) ?? null,
  };

  const pessoas: PessoaInput[] = pessoasRows.map((p) => ({
    fornecedorId: p.fornecedorId,
    nome: p.nome ?? '(sem nome)',
    papel: p.papel as 'funcionario' | 'diarista' | 'gerente',
    gerenteModelo: p.gerenteModelo,
    gerenteValorFixoDia: p.gerenteValorFixoDia ? Number(p.gerenteValorFixoDia) : null,
    gerenteBatePonto: p.papel === 'gerente' && gerentesBatemPonto.has(p.fornecedorId),
    diaristaTaxaHoraOverride: p.diaristaTaxaHoraOverride ? Number(p.diaristaTaxaHoraOverride) : null,
    diaristaModelo: p.diaristaModelo ?? 'por_hora',
    diaristaValorFixoDia: p.diaristaValorFixoDia ? Number(p.diaristaValorFixoDia) : null,
  }));

  const noturno = folhaRow
    ? await noturnoDaSemana(filialId, folhaRow.dataInicio, folhaRow.dataFim, pessoasRows, horasMap)
    : {};

  return { config, cfg, pessoasRows, pessoas, horasMap, ajustesMap, perdasPorDia, noturno };
}

/** Minutos noturnos (22h–05h, hora reduzida) da semana por fornecedor, lidos
 *  dos pares do ponto (ponto_dia) da filial. Só conta dia que tem horas na
 *  folha (folha_horas > 0) — dia zerado/corrigido pra zero não paga noturno.
 *  Funcionário → fornecedor: FK direta, senão CPF (igual projetar-horas). */
async function noturnoDaSemana(
  filialId: string,
  de: string,
  ate: string,
  pessoasRows: InputsFolha['pessoasRows'],
  horasMap: Map<string, Record<string, number>>,
): Promise<InputsFolha['noturno']> {
  const rows = await db
    .select({
      dia: schema.pontoDia.dia,
      pares: schema.pontoDia.pares,
      funcFornecedorId: schema.funcionario.fornecedorId,
      cpf: schema.funcionario.cpf,
      regime: schema.funcionario.regimeSalarial,
      salarioBase: schema.funcionario.salarioBase,
    })
    .from(schema.pontoDia)
    .innerJoin(schema.funcionario, eq(schema.funcionario.id, schema.pontoDia.funcionarioId))
    .where(and(eq(schema.pontoDia.filialId, filialId), gte(schema.pontoDia.dia, de), lte(schema.pontoDia.dia, ate)));

  const ids = new Set(pessoasRows.map((p) => p.fornecedorId));
  const porCpf = new Map<string, string>();
  for (const p of pessoasRows) {
    const d = (p.cpf ?? '').replace(/\D/g, '');
    if (d) porCpf.set(d, p.fornecedorId);
  }

  const out: InputsFolha['noturno'] = {};
  for (const r of rows) {
    const fid =
      r.funcFornecedorId && ids.has(r.funcFornecedorId)
        ? r.funcFornecedorId
        : porCpf.get((r.cpf ?? '').replace(/\D/g, ''));
    if (!fid) continue;
    if (!((horasMap.get(fid)?.[r.dia] ?? 0) > 0)) continue;
    const pares = Array.isArray(r.pares) ? (r.pares as { entrada: string; saida: string }[]) : [];
    const { fictos } = minutosNoturnos(pares);
    const taxaHora = r.regime === 'intermitente_hora' && r.salarioBase ? Number(r.salarioBase) : null;
    const cur = out[fid] ?? { fictoMin: 0, taxaHora };
    cur.fictoMin += fictos;
    if (taxaHora) cur.taxaHora = taxaHora;
    out[fid] = cur;
  }
  return out;
}

/** Gerentes (fornecedorIds) que já tiveram horas (>0) em alguma folha
 *  ANTERIOR da mesma filial — ou seja, batem ponto. Pra esses, semana sem
 *  horas é falta, não "gerente que não registra ponto". */
async function gerentesComPontoAnterior(
  filialId: string,
  dataInicio: string | null,
  gerenteIds: string[],
): Promise<Set<string>> {
  if (gerenteIds.length === 0 || !dataInicio) return new Set();
  const rows = await db
    .selectDistinct({ fornecedorId: schema.folhaHoras.fornecedorId })
    .from(schema.folhaHoras)
    .innerJoin(schema.folhaSemana, eq(schema.folhaSemana.id, schema.folhaHoras.folhaSemanaId))
    .where(
      and(
        eq(schema.folhaSemana.filialId, filialId),
        lt(schema.folhaSemana.dataInicio, dataInicio),
        inArray(schema.folhaHoras.fornecedorId, gerenteIds),
        gt(schema.folhaHoras.totalMin, 0),
      ),
    );
  return new Set(rows.map((r) => r.fornecedorId));
}
