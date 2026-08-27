// Monta os inputs pro motor de calculo (calcularFolha) a partir do banco:
// pessoas ativas da filial, horas da semana, ajustes manuais + bonus
// automatico injetado do cadastro (fornecedor_folha.bonusFixoSemanal/
// bonusPorDia). Extraido de preview/fechar/exportar, que tinham essa mesma
// logica copiada 3x (e ja tinha divergido — um usava `diasComHoras`, os
// outros recalculavam como `diasTrab`, mesmo resultado mas duplicado).

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import type { ConfigFolha, PessoaInput } from './calcular';

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
  }>;
  pessoas: PessoaInput[];
  horasMap: Map<string, Record<string, number>>;
  ajustesMap: AjustesMap;
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

  const horasRows = await db.select().from(schema.folhaHoras).where(eq(schema.folhaHoras.folhaSemanaId, folhaSemanaId));
  const ajustesRows = await db.select().from(schema.folhaAjuste).where(eq(schema.folhaAjuste.folhaSemanaId, folhaSemanaId));

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
  for (const p of pessoasRows) {
    const porDia = horasMap.get(p.fornecedorId) ?? {};
    const diasComHoras = Object.values(porDia).filter((m) => m > 0).length;
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
    diaristaTaxaHoraOverride: p.diaristaTaxaHoraOverride ? Number(p.diaristaTaxaHoraOverride) : null,
    diaristaModelo: p.diaristaModelo ?? 'por_hora',
    diaristaValorFixoDia: p.diaristaValorFixoDia ? Number(p.diaristaValorFixoDia) : null,
  }));

  return { config, cfg, pessoasRows, pessoas, horasMap, ajustesMap };
}
