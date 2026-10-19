// Faturas de mão de obra da E.B. Serviços pra cada casa (19/10/2026).
//
// Valor da nota = custo da folha da E.B. naquela casa (folha do contador,
// departamento da casa) + percentual de lucro. ISS retido pela casa na
// alíquota efetiva do Simples da E.B.; a casa paga à E.B. o serviço menos o
// ISS e recolhe o ISS na guia da prefeitura do lugar da casa (Bar em São
// Cristóvão, Tabuará e Mar em Aracaju). Horas e empregados vão de detalhe.
//
// A E.B. não está em usuario_filial (ver packages/db/src/schema/nfse.ts):
// quem entra aqui é quem tem folha_equipe.fechar, e as casas tomadoras são
// as do usuário.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { schema as S } from '@concilia/db';

type BaseFaturaServico = S.BaseFaturaServico;

export const EB_CNPJ = '05486249000172';

/** Município do ISS retido por casa (alvarás de 2026). */
export const MUNICIPIO_ISS: Record<string, string> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': 'São Cristóvão',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': 'Aracaju',
  'e899dae2-38bf-4f3f-9149-7effd059fab8': 'Aracaju',
};

/** Endereço do tomador na NFS-e quando o fiscal_config da casa não serve.
 *  Bar: o fiscal_config (NFC-e) diz Aracaju, mas o alvará é de São Cristóvão
 *  (inscrição mercantil 54823166) — e o ISS retido vai pra São Cristóvão. */
export const TOMADOR_FIXO: Record<
  string,
  { codigoMunicipio: string; cep: string; logradouro: string; numero: string; bairro: string }
> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': {
    codigoMunicipio: '2806701',
    cep: '49100000',
    logradouro: 'Estrada Acesso ao Povoado Matapuã',
    numero: 'S/N',
    bairro: 'Mosqueiro',
  },
};

export const ROTULO_BASE: Record<BaseFaturaServico, string> = {
  proventos_fgts: 'proventos + FGTS',
  proventos: 'só proventos (bruto)',
  liquido: 'líquido pago',
};

export interface ConfigEb {
  filialId: string;
  razaoSocial: string;
  percentualLucro: number;
  aliquotaIss: number | null;
  base: BaseFaturaServico;
  diaVencimento: number;
}

export async function configEb(): Promise<ConfigEb | null> {
  const [c] = await db
    .select()
    .from(schema.nfseConfig)
    .where(eq(schema.nfseConfig.cnpj, EB_CNPJ))
    .limit(1);
  if (!c) return null;
  return {
    filialId: c.filialId,
    razaoSocial: c.razaoSocial,
    percentualLucro: Number(c.percentualLucro),
    aliquotaIss: c.aliquotaIss === null ? null : Number(c.aliquotaIss),
    base: c.base,
    diaVencimento: c.diaVencimento,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PrevisaoFatura {
  tomadorFilialId: string;
  departamento: string;
  empregados: number;
  horas: number;
  proventos: number;
  fgts: number;
  liquidoFolha: number;
  valorBase: number;
  percentualLucro: number;
  valorLucro: number;
  valorServico: number;
  aliquotaIss: number;
  valorIss: number;
  valorLiquido: number;
  vencimento: string;
}

/** 'AAAA-MM' → vencimento no mês seguinte, no dia configurado. */
export function vencimentoDe(comp: string, dia: number): string {
  const [a, m] = comp.split('-').map(Number);
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

export function nomeCompetencia(comp: string): string {
  const [a, m] = comp.split('-');
  return `${m}/${a}`;
}

/** Calcula a fatura de cada casa a partir da folha do contador da E.B. */
export async function preverFaturas(comp: string, tomadores: string[], cfg: ConfigEb): Promise<PrevisaoFatura[]> {
  if (tomadores.length === 0) return [];
  const resumos = await db
    .select({
      filialId: schema.folhaContadorResumo.filialId,
      departamento: sql<string>`string_agg(${schema.folhaContadorResumo.departamento}, ', ')`,
      empregados: sql<number>`sum(${schema.folhaContadorResumo.empregados})::int`,
      proventos: sql<string>`sum(${schema.folhaContadorResumo.proventos})`,
      fgts: sql<string>`sum(${schema.folhaContadorResumo.fgts})`,
      liquido: sql<string>`sum(${schema.folhaContadorResumo.liquido})`,
    })
    .from(schema.folhaContadorResumo)
    .where(
      and(
        eq(schema.folhaContadorResumo.cnpj, EB_CNPJ),
        eq(schema.folhaContadorResumo.competencia, comp),
        inArray(schema.folhaContadorResumo.filialId, tomadores),
      ),
    )
    .groupBy(schema.folhaContadorResumo.filialId);

  const horas = await db
    .select({
      filialId: schema.folhaContador.filialId,
      horas: sql<string>`coalesce(sum(${schema.folhaContador.horasMes}), 0)`,
    })
    .from(schema.folhaContador)
    .where(and(eq(schema.folhaContador.cnpj, EB_CNPJ), eq(schema.folhaContador.competencia, comp)))
    .groupBy(schema.folhaContador.filialId);
  const horasPorCasa = new Map(horas.map((h) => [h.filialId, Number(h.horas)]));

  const aliquota = cfg.aliquotaIss ?? 0;
  return resumos.map((r) => {
    const proventos = Number(r.proventos);
    const fgts = Number(r.fgts);
    const liquidoFolha = Number(r.liquido);
    const valorBase = r2(
      cfg.base === 'proventos' ? proventos : cfg.base === 'liquido' ? liquidoFolha : proventos + fgts,
    );
    const valorLucro = r2((valorBase * cfg.percentualLucro) / 100);
    const valorServico = r2(valorBase + valorLucro);
    const valorIss = r2((valorServico * aliquota) / 100);
    return {
      tomadorFilialId: r.filialId,
      departamento: r.departamento,
      empregados: r.empregados,
      horas: horasPorCasa.get(r.filialId) ?? 0,
      proventos,
      fgts,
      liquidoFolha,
      valorBase,
      percentualLucro: cfg.percentualLucro,
      valorLucro,
      valorServico,
      aliquotaIss: aliquota,
      valorIss,
      valorLiquido: r2(valorServico - valorIss),
      vencimento: vencimentoDe(comp, cfg.diaVencimento),
    };
  });
}

export function discriminacao(p: PrevisaoFatura, comp: string, municipio: string): string {
  const horas = p.horas.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return (
    `Fornecimento de mão de obra — competência ${nomeCompetencia(comp)}: ` +
    `${p.empregados} empregados, ${horas} horas trabalhadas. ` +
    `ISS retido pelo tomador (LC 116/2003, art. 6º, §2º, II), recolhido em ${municipio}. ` +
    `Prestador optante pelo Simples Nacional — sem retenção de INSS, IR, PIS, COFINS e CSLL.`
  );
}
