// BALANÇO DO DIA — a foto que o vendas-local manda (montarBalanco() na loja).
// Guardamos cada foto em balanco_loja; a última do dia é o balanço final.
import { db, schema } from '@concilia/db';
import { dateToBrYmd } from '@/lib/datas';

export interface BalancoHora {
  n: number;
  pes: number;
  valor: number;
}
export interface BalancoAcum {
  n: number;
  pes: number;
  valor: number;
}
export interface BalancoDados {
  agora: string;
  dia: string;
  versao?: string;
  online?: boolean;
  fonte?: 'local' | 'consumer';
  loja?: string;
  nuvem_ok?: boolean;
  mesas?: {
    total: number;
    ocupadas: number;
    livres: number;
    pct: number;
    pessoas: number;
    fechando: number;
    mapa: boolean;
    cartoes: number;
    cartoes_pessoas: number;
    areas: { nome: string; total: number; ocupadas: number; livres: number; pct: number; pessoas: number; fechando: number; fora: boolean }[];
  } | null;
  atrasos?: {
    entrega_min: number;
    total_atrasadas: number;
    total_criticas: number;
    passe_parados: number;
    areas: {
      codigo: number;
      nome: string;
      comandas: number;
      itens: number;
      atrasadas: number;
      criticas: number;
      maior_min: number;
      prazo_min: number | null;
      passe_n: number;
      passe_parados: number;
      passe_maior: number;
    }[];
    lista: { numero: number; area: string | null; espera_min: number; prazo_min: number; critico: boolean; itens: number }[];
  } | null;
  setores?: {
    hoje_total: number;
    hoje_itens: number;
    setores: {
      codigo: number;
      nome: string;
      a_produzir: number;
      pronto: number;
      itens: number;
      hoje_itens: number;
      hoje_qtd: number;
      hoje_valor: number;
      hoje_comandas: number;
    }[];
  } | null;
  fluxo?: {
    fonte: string;
    hora: number;
    hoje: BalancoHora[];
    ontem: BalancoHora[];
    semana: BalancoHora[];
    hoje_ate: BalancoAcum;
    ontem_ate: BalancoAcum;
    semana_ate: BalancoAcum;
    delta_ontem_pct: number;
    delta_semana_pct: number;
    delta_pessoas_semana_pct: number;
    ontem_total: BalancoAcum;
    semana_total: BalancoAcum;
    semana_dia: string;
  } | null;
  caixa?: {
    total: number;
    lancamentos: number;
    formas: { codigo: unknown; nome: string; valor: number; n: number }[];
    caixas_abertos: number;
    caixas: number;
  } | null;
  cancelamentos?: {
    n: number;
    valor: number;
    pedidos: number;
    produzidos: number;
    valor_produzidos: number;
    devolucoes: number;
    lista: {
      id: number;
      quando: string;
      login: string | null;
      gerente: string | null;
      numero: number | null;
      nome: string | null;
      valor: number | null;
      status_item: string | null;
      motivo: string | null;
    }[];
  };
  estornos?: {
    n: number;
    valor: number;
    lista: { id: number; quando: string; login: string | null; numero: number | null; forma: string | null; valor: number | null; motivo: string | null }[];
  };
  reaberturas?: { n: number; lista: { id: number; quando: string; login: string | null; numero: number | null; fechada_em: string | null }[] };
  liberacoes?: {
    pendentes: number;
    aprovadas: number;
    negadas: number;
    expiradas: number;
    pendentes_lista: { id: number; quando: string; login: string; numero: number; tipo: string; nome: string | null; valor: number | null; motivo: string | null; ha_min: number }[];
    lista: {
      id: number;
      quando: string;
      login: string;
      numero: number;
      tipo: string;
      nome: string | null;
      valor: number | null;
      motivo: string | null;
      status: string;
      decidido_em: string | null;
      decidido_por: string | null;
      resposta: string | null;
    }[];
  };
  reclamacoes?: {
    hoje: number;
    abertas: number;
    garcom: number;
    garcom_abertos: number;
    atendimento_min: number;
    abertas_lista: { id: number; mesa: number | null; tipo: string; nota: number | null; texto: string | null; assunto?: string | null; ha_min: number }[];
    lista: {
      id: number;
      mesa: number | null;
      tipo: string;
      origem: string | null;
      nota: number | null;
      texto: string | null;
      assunto: string | null;
      criado_em: string;
      atendido_em: string | null;
      atendido_por: string | null;
    }[];
  };
}

/** Sanidade mínima do que a loja mandou; o resto é jsonb livre. */
export function pareceBalanco(x: unknown): x is BalancoDados {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.agora === 'string' && !Number.isNaN(Date.parse(o.agora));
}

/** Grava uma foto. O dia é o BRT de `agora` (a loja está em Aracaju). */
export async function salvarBalanco(filialId: string, dados: BalancoDados): Promise<{ id: string; dia: string }> {
  const capturadoEm = new Date(dados.agora);
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(dados.dia ?? '') ? dados.dia : dateToBrYmd(capturadoEm);
  const [row] = await db
    .insert(schema.balancoLoja)
    .values({
      filialId,
      dia,
      capturadoEm,
      versao: typeof dados.versao === 'string' ? dados.versao.slice(0, 16) : null,
      dados,
    })
    .returning({ id: schema.balancoLoja.id });
  return { id: row.id, dia };
}
