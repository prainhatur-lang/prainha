// Água do Prainha — leitura do estado (caixas, bombas, avisos) pro servidor.
// A tela /agua e as rotas /api/agua leem por aqui; o navegador nunca fala com
// o banco (as tabelas agua_* têm RLS ligado sem política).

import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

export interface AguaLeitura {
  criadoEm: string;
  nivelTerrea: number | null;
  nivelIntermediaria: number | null;
  nivelSuperior: number | null;
  pressao1: number | null;
  pressao2: number | null;
  pressao3: number | null;
  correntes: Record<number, number | null>;
  v1Aberta: boolean | null;
  v2Aberta: boolean | null;
}

export interface AguaBomba {
  id: number;
  nome: string;
  fases: string | null;
  liberada: boolean;
  modo: string;
  falha: string | null;
  tentativas: number;
  /** Disjuntor inteligente já cadastrado (ID Tuya). */
  temDisjuntor: boolean;
}

export interface AguaAlarme {
  id: number;
  gravidade: string;
  titulo: string;
  detalhe: string | null;
  abertoEm: string;
}

/** O JSON do /api/estado da placa dos filtros, como a loja leu. */
export interface AguaPlacaEstado {
  reles: number[];
  nomes?: string[];
  rssi?: number | null;
  ip?: string;
  hora?: string;
  /** false = falha no acionamento dos relés (alarme grave). */
  chip?: boolean | null;
  ultima?: string;
  agenda?: string;
  ciclo: { ativo: boolean; teste: boolean; passo: number; total: number; nome: string; resta: number };
}

export interface AguaPlaca {
  /** null = a loja não conseguiu ler a placa no último envio. */
  estado: AguaPlacaEstado | null;
  lidoEm: string | null;
  erro: string | null;
  /** Quando a loja mandou essa cópia. */
  atualizadoEm: string;
}

export interface AguaRetrolavagem {
  id: number;
  iniciadoEm: string;
  terminadoEm: string | null;
  resultado: string | null;
  teste: boolean;
  origem: string | null;
  por: string | null;
}

export interface AguaComando {
  id: number;
  em: string;
  tipo: string;
  por: string | null;
  entregueEm: string | null;
  executadoEm: string | null;
  resultado: string | null;
  ok: boolean | null;
}

export interface AguaEstado {
  leitura: AguaLeitura | null;
  bombas: AguaBomba[];
  alarmes: AguaAlarme[];
  config: Record<string, number>;
  /** Placa dos filtros: null enquanto a loja nunca mandou o estado dela. */
  placa?: AguaPlaca | null;
  retrolavagens?: AguaRetrolavagem[];
  /** Pedidos feitos aqui no online (a loja busca e executa). */
  comandos?: AguaComando[];
}

/** O que o online pode pedir pra placa dos filtros (a loja executa). */
export const AGUA_TIPOS_PLACA = ['retrolavar', 'retro_parar', 'filtrar'] as const;
export type AguaTipoPlaca = (typeof AGUA_TIPOS_PLACA)[number];

/** Placa dos filtros, retrolavagens e pedidos. Vazio se a migration da placa não rodou. */
async function carregarPlaca(): Promise<Pick<AguaEstado, 'placa' | 'retrolavagens' | 'comandos'>> {
  try {
    const [placas, retros, comandos] = await Promise.all([
      db.select().from(schema.aguaPlaca).where(eq(schema.aguaPlaca.id, 1)),
      db.select().from(schema.aguaRetrolavagens).orderBy(desc(schema.aguaRetrolavagens.iniciadoEm)).limit(8),
      db
        .select()
        .from(schema.aguaComandos)
        .where(inArray(schema.aguaComandos.tipo, [...AGUA_TIPOS_PLACA]))
        .orderBy(desc(schema.aguaComandos.id))
        .limit(8),
    ]);
    const p = placas[0];
    return {
      placa: p
        ? {
            estado: (p.estado as AguaPlacaEstado | null) ?? null,
            lidoEm: p.lidoEm ? p.lidoEm.toISOString() : null,
            erro: p.erro,
            atualizadoEm: p.atualizadoEm.toISOString(),
          }
        : null,
      retrolavagens: retros.map((r) => ({
        id: r.id,
        iniciadoEm: r.iniciadoEm.toISOString(),
        terminadoEm: r.terminadoEm ? r.terminadoEm.toISOString() : null,
        resultado: r.resultado,
        teste: r.teste,
        origem: r.origem,
        por: r.pedidoPor,
      })),
      comandos: comandos.map((c) => ({
        id: c.id,
        em: c.criadoEm.toISOString(),
        tipo: c.tipo,
        por: c.solicitadoNome,
        entregueEm: c.entregueEm ? c.entregueEm.toISOString() : null,
        executadoEm: c.executadoEm ? c.executadoEm.toISOString() : null,
        resultado: c.resultado,
        ok: c.ok,
      })),
    };
  } catch (e) {
    console.error('[agua] placa dos filtros indisponível', e instanceof Error ? e.message : e);
    return { placa: null, retrolavagens: [], comandos: [] };
  }
}

/**
 * Registra um pedido pra placa dos filtros. Não executa nada: a loja busca no
 * próximo envio. Recusa se já há pedido igual esperando (dois toques no botão)
 * e, pra retrolavar, se a loja ainda não marcou as válvulas como instaladas.
 */
export async function pedirComandoPlaca(
  tipo: AguaTipoPlaca,
  userId: string,
  nome: string,
): Promise<{ ok: true; id: number } | { ok: false; erro: string }> {
  if (tipo === 'retrolavar') {
    const [cfg] = await db
      .select({ valor: schema.aguaConfig.valor })
      .from(schema.aguaConfig)
      .where(eq(schema.aguaConfig.chave, 'filtros_instalados'));
    if (Number(cfg?.valor) !== 1) {
      return {
        ok: false,
        erro: 'As válvulas dos filtros ainda não estão marcadas como instaladas. Isso se marca na tela Água da loja.',
      };
    }
  }
  const [esperando] = await db
    .select({ id: schema.aguaComandos.id })
    .from(schema.aguaComandos)
    .where(and(eq(schema.aguaComandos.tipo, tipo), isNull(schema.aguaComandos.executadoEm)))
    .limit(1);
  if (esperando) return { ok: false, erro: 'Esse pedido já está na fila, esperando a loja.' };
  const [novo] = await db
    .insert(schema.aguaComandos)
    .values({ tipo, solicitadoPor: userId, solicitadoNome: nome })
    .returning({ id: schema.aguaComandos.id });
  return { ok: true, id: novo.id };
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Minutos pro aviso em tela cheia voltar depois do "Estou ciente". */
export const AGUA_REAVISO_MIN_PADRAO = 30;

/**
 * Estado completo da água. Devolve null se as tabelas agua_* não existem
 * neste banco (instância dos clientes, ou migration ainda não rodada).
 */
export async function carregarEstadoAgua(): Promise<AguaEstado | null> {
  try {
    const [leituras, bombas, alarmes, config] = await Promise.all([
      db.select().from(schema.aguaLeituras).orderBy(desc(schema.aguaLeituras.criadoEm)).limit(1),
      db.select().from(schema.aguaBombas).orderBy(asc(schema.aguaBombas.id)),
      db
        .select()
        .from(schema.aguaAlarmes)
        .where(isNull(schema.aguaAlarmes.resolvidoEm))
        .orderBy(asc(schema.aguaAlarmes.abertoEm)),
      db.select().from(schema.aguaConfig),
    ]);
    const l = leituras[0];
    const daPlaca = await carregarPlaca();
    return {
      ...daPlaca,
      leitura: l
        ? {
            criadoEm: l.criadoEm.toISOString(),
            nivelTerrea: num(l.nivelTerrea),
            nivelIntermediaria: num(l.nivelIntermediaria),
            nivelSuperior: num(l.nivelSuperior),
            pressao1: num(l.pressao1),
            pressao2: num(l.pressao2),
            pressao3: num(l.pressao3),
            correntes: {
              1: num(l.corrente1),
              2: num(l.corrente2),
              3: num(l.corrente3),
              4: num(l.corrente4),
            },
            v1Aberta: l.v1Aberta,
            v2Aberta: l.v2Aberta,
          }
        : null,
      bombas: bombas.map((b) => ({
        id: b.id,
        nome: b.nome,
        fases: b.fases,
        liberada: b.liberada,
        modo: b.modo,
        falha: b.falha,
        tentativas: b.tentativas,
        temDisjuntor: !!b.tuyaDeviceId,
      })),
      alarmes: alarmes.map((a) => ({
        id: a.id,
        gravidade: a.gravidade,
        titulo: a.titulo,
        detalhe: a.detalhe,
        abertoEm: a.abertoEm.toISOString(),
      })),
      config: Object.fromEntries(config.map((c) => [c.chave, Number(c.valor)])),
    };
  } catch (e) {
    console.error('[agua] estado indisponível', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Alarmes críticos que pedem aviso em tela cheia: abertos e ainda não
 * confirmados, ou confirmados há mais que o reaviso.
 */
export async function alarmesParaAvisar(): Promise<AguaAlarme[]> {
  try {
    const [cfg] = await db
      .select({ valor: schema.aguaConfig.valor })
      .from(schema.aguaConfig)
      .where(eq(schema.aguaConfig.chave, 'reaviso_min'));
    const reavisoMin = Number(cfg?.valor) || AGUA_REAVISO_MIN_PADRAO;
    const limite = new Date(Date.now() - reavisoMin * 60_000);
    const rows = await db
      .select()
      .from(schema.aguaAlarmes)
      .where(
        and(
          eq(schema.aguaAlarmes.gravidade, 'critico'),
          isNull(schema.aguaAlarmes.resolvidoEm),
          or(isNull(schema.aguaAlarmes.vistoEm), lt(schema.aguaAlarmes.vistoEm, limite)),
        ),
      )
      .orderBy(asc(schema.aguaAlarmes.abertoEm));
    return rows.map((a) => ({
      id: a.id,
      gravidade: a.gravidade,
      titulo: a.titulo,
      detalhe: a.detalhe,
      abertoEm: a.abertoEm.toISOString(),
    }));
  } catch (e) {
    console.error('[agua] alarmes indisponíveis', e instanceof Error ? e.message : e);
    return [];
  }
}

/** "Estou ciente": marca quem viu e quando. O alarme segue aberto até resolver. */
export async function confirmarAlarmes(ids: number[], userId: string): Promise<number> {
  const limpos = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  if (limpos.length === 0) return 0;
  const feitos = await db
    .update(schema.aguaAlarmes)
    .set({ vistoEm: new Date(), vistoPor: userId })
    .where(and(inArray(schema.aguaAlarmes.id, limpos), isNull(schema.aguaAlarmes.resolvidoEm)))
    .returning({ id: schema.aguaAlarmes.id });
  return feitos.length;
}
