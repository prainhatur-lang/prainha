// Drenador da fila CDC: le CONCILIA_SYNC_QUEUE, busca registros completos
// das tabelas correspondentes, envia pro endpoint generico /api/concilia/sync
// e marca como processado. Tolerante a tabela inexistente (filial sem CDC
// instalado nao quebra).

import Firebird from 'node-firebird';
import type { Config } from './config';
import { log } from './logger';

interface FilaItem {
  id: number;
  tabela: string;
  chavePk: string;
  operacao: 'I' | 'U' | 'D';
}

export interface RegistroSync {
  tabela: string;
  operacao: 'I' | 'U' | 'D';
  chavePk: string;
  dados: Record<string, unknown> | null; // null pra DELETE
}

// ---------- Helpers FB ----------

function attachFb(cfg: Config): Promise<Firebird.Database> {
  return new Promise((resolve, reject) => {
    Firebird.attach(
      {
        host: cfg.firebird.host,
        port: cfg.firebird.port,
        database: cfg.firebird.database,
        user: cfg.firebird.user,
        password: cfg.firebird.password,
        lowercase_keys: false,
        pageSize: 4096,
      },
      (e: Error | null, db: Firebird.Database) => (e ? reject(e) : resolve(db)),
    );
  });
}

function detachFb(db: Firebird.Database): Promise<void> {
  return new Promise((resolve) => {
    try {
      db.detach(() => resolve());
    } catch {
      resolve();
    }
  });
}

// IMPORTANTE: usa transaction explicita com commit, igual ao cdc.ts exec().
// db.query() direto em node-firebird FB4 pode nao enxergar dados commitados
// por triggers de outras conexoes (bug observado em 22/05/2026 — drenador
// ficava com lerFila qtd=0 mesmo com 1.4M itens na fila).
function query<T = Record<string, unknown>>(
  db: Firebird.Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.transaction(Firebird.ISOLATION_READ_COMMITTED, (e, tx) => {
      if (e) return reject(e);
      tx.query(sql, params, (e2: Error | null, r: T[]) => {
        if (e2) {
          tx.rollback(() => reject(e2));
          return;
        }
        tx.commit((e3) => (e3 ? reject(e3) : resolve(r ?? [])));
      });
    });
  });
}

function execWrite(db: Firebird.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction(Firebird.ISOLATION_READ_COMMITTED, (e, tx) => {
      if (e) return reject(e);
      tx.query(sql, [], (e2: Error | null) => {
        if (e2) {
          tx.rollback(() => reject(e2));
          return;
        }
        tx.commit((e3) => (e3 ? reject(e3) : resolve()));
      });
    });
  });
}

// Mapa tabela -> coluna PK pra buscar o registro completo (mesma lista de cdc.ts)
const PK_POR_TABELA: Record<string, string> = {
  DELIVERY: 'CODIGOPEDIDO',
  PEDIDOGRUPOENTREGA: 'CODIGOPEDIDO',
  IFOODPEDIDO: 'CODIGOPEDIDOIFOOD',
  ORDERINTEGRATION: 'ID',
  ORDERSHIPPING: 'ID',
  MENUDINOPEDIDO: 'CODIGOPEDIDOMENUDINO',
};
const PK_DEFAULT = 'CODIGO';

function pkOf(tabela: string): string {
  return PK_POR_TABELA[tabela] ?? PK_DEFAULT;
}

// Escape de valor pra IN (...). Aceita numero ou string.
function escapeLiteral(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'";
}

// ---------- Drenagem ----------

async function lerFila(db: Firebird.Database, limite: number): Promise<FilaItem[]> {
  const rows = await query<{
    ID: number;
    TABELA: string;
    CHAVE_PK: string;
    OPERACAO: string;
  }>(
    db,
    `SELECT FIRST ${limite} ID, TABELA, CHAVE_PK, OPERACAO
     FROM CONCILIA_SYNC_QUEUE
     WHERE PROCESSADO = 0
     ORDER BY ID`,
  );
  return rows.map((r) => ({
    id: r.ID,
    // FB retorna CHAR(N) com padding de espacos — trim em todos os strings
    tabela: r.TABELA.trim(),
    chavePk: r.CHAVE_PK.trim(),
    operacao: r.OPERACAO.trim() as 'I' | 'U' | 'D',
  }));
}

/** Algumas tabelas precisam SELECT customizado pra trazer dados resolvidos
 *  via JOIN (ex: ITENSPEDIDO precisa do CODIGOPRODUTO via PRODUTODETALHE).
 *  Quando nao listada aqui, o drenador usa SELECT * FROM tabela. */
const SELECT_ESPECIAL: Record<string, (inList: string, pk: string) => string> = {
  ITENSPEDIDO: (inList, pk) =>
    `SELECT i.*, ` +
    `       COALESCE(i.CODIGOPRODUTO, pd.CODIGOPRODUTO) AS CODIGOPRODUTORESOLVIDO ` +
    `FROM ITENSPEDIDO i ` +
    `LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO = i.CODIGOPRODUTODETALHE ` +
    `WHERE i.${pk} IN (${inList})`,
  // PAGAMENTOS precisa resolver a FORMA de pagamento via JOIN — sem isso o CDC
  // grava forma_pagamento NULL (so o CODIGOFORMAPAGAMENTO vem no SELECT *).
  PAGAMENTOS: (inList, pk) =>
    `SELECT p.*, ` +
    `       TRIM(fp.DESCRICAO) AS FORMA ` +
    `FROM PAGAMENTOS p ` +
    `LEFT JOIN FORMASPAGAMENTO fp ON fp.CODIGO = p.CODIGOFORMAPAGAMENTO ` +
    `WHERE p.${pk} IN (${inList})`,
};

async function buscarRegistros(
  db: Firebird.Database,
  tabela: string,
  chaves: string[],
): Promise<Record<string, Record<string, unknown>>> {
  if (chaves.length === 0) return {};
  const pk = pkOf(tabela);
  // Detecta se PK eh numerica via heuristica (todas as chaves sao integers)
  const todasNumericas = chaves.every((c) => /^-?\d+$/.test(c));
  const inList = todasNumericas
    ? chaves.join(',')
    : chaves.map(escapeLiteral).join(',');
  const especial = SELECT_ESPECIAL[tabela];
  const sql = especial ? especial(inList, pk) : `SELECT * FROM ${tabela} WHERE ${pk} IN (${inList})`;
  const rows = await query<Record<string, unknown>>(db, sql);
  const map: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const v = row[pk];
    if (v !== null && v !== undefined) {
      map[String(v)] = row;
    }
  }
  return map;
}

async function marcarProcessado(db: Firebird.Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const sql = `UPDATE CONCILIA_SYNC_QUEUE
               SET PROCESSADO = 1, PROCESSADO_EM = CURRENT_TIMESTAMP
               WHERE ID IN (${ids.join(',')})`;
  await execWrite(db, sql);
}

async function marcarErro(
  db: Firebird.Database,
  ids: number[],
  erro: string,
): Promise<void> {
  if (ids.length === 0) return;
  const erroTrunc = erro.slice(0, 500).replace(/'/g, "''");
  const sql = `UPDATE CONCILIA_SYNC_QUEUE
               SET TENTATIVAS = TENTATIVAS + 1, ULTIMO_ERRO = '${erroTrunc}'
               WHERE ID IN (${ids.join(',')})`;
  await execWrite(db, sql);
}

export async function enviarSync(
  cfg: Config,
  registros: RegistroSync[],
): Promise<{ recebidos: number; erros: string[] }> {
  const url = cfg.api.url.replace(/\/$/, '') + '/api/concilia/sync';
  const body = JSON.stringify({ registros });
  const t0 = Date.now();
  // Timeout de 90s no fetch. Sem isso, drenador trava pra sempre se a conexao
  // ficar pendurada (bug observado em prod 22/05/2026 — ciclo drenador
  // estourava timeout 600s e matava o processo). 90s da folga pro endpoint
  // processar 500 regs em serverless (Vercel cold start + latencia BR→US).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api.token}`,
      },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = (e as Error).name === 'AbortError'
      ? `timeout 90s em POST /api/concilia/sync (payload ${body.length}B, ${registros.length} regs)`
      : (e as Error).message;
    throw new Error(msg);
  }
  clearTimeout(timer);
  const dur = Date.now() - t0;
  log.info('drenador: POST /sync', { ms: dur, regs: registros.length, bytes: body.length, http: r.status });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} - ${txt.slice(0, 300)}`);
  }
  return (await r.json()) as { recebidos: number; erros: string[] };
}

// Testa se a fila existe (CDC instalado)
async function filaExiste(db: Firebird.Database): Promise<boolean> {
  try {
    const r = await query(
      db,
      "SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'CONCILIA_SYNC_QUEUE'",
    );
    return r.length > 0;
  } catch {
    return false;
  }
}

// ---------- Ciclo principal ----------

export async function cicloDrenador(cfg: Config): Promise<void> {
  // Cap em 500 — payloads > 500 regs estouravam timeout 45s no endpoint
  // (config.json da 0001 tava com 1000, payload ~640KB, processamento
  // serverless levava > 45s). Math.min protege mesmo com config velho.
  const BATCH = Math.min(cfg.batchSize ?? 200, 500);
  const MAX_ITER = 200; // protecao contra loop infinito (200 × 500 = 100k itens/ciclo)
  let db: Firebird.Database | null = null;
  let totalEnviado = 0;
  let totalErro = 0;

  log.info('drenador: ciclo iniciado');
  try {
    db = await attachFb(cfg);
    const temFila = await filaExiste(db);
    log.info('drenador: filaExiste', { temFila });
    if (!temFila) {
      // CDC ainda nao instalado nessa filial — no-op
      return;
    }

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const pendentes = await lerFila(db, BATCH);
      log.info('drenador: lerFila resultado', { iter, qtd: pendentes.length });
      if (pendentes.length === 0) break;

      // Agrupa por tabela pra fazer SELECT IN (...) eficiente
      const porTabela = new Map<string, FilaItem[]>();
      for (const p of pendentes) {
        const arr = porTabela.get(p.tabela);
        if (arr) arr.push(p);
        else porTabela.set(p.tabela, [p]);
      }

      const registros: RegistroSync[] = [];
      const idsOk: number[] = [];
      const idsErr: number[] = [];

      for (const [tabela, items] of porTabela) {
        // DELETE nao precisa buscar (linha ja foi removida)
        const naoDeletes = items.filter((i) => i.operacao !== 'D');
        const deletes = items.filter((i) => i.operacao === 'D');

        let mapaDados: Record<string, Record<string, unknown>> = {};
        if (naoDeletes.length > 0) {
          try {
            const chaves = [...new Set(naoDeletes.map((i) => i.chavePk))];
            mapaDados = await buscarRegistros(db, tabela, chaves);
          } catch (e) {
            log.warn('drenador: buscarRegistros falhou', {
              tabela,
              err: (e as Error).message,
            });
            // Marca os items como erro mas nao para o ciclo
            for (const i of naoDeletes) idsErr.push(i.id);
            continue;
          }
        }

        for (const item of items) {
          if (item.operacao === 'D') {
            registros.push({
              tabela: item.tabela,
              operacao: 'D',
              chavePk: item.chavePk,
              dados: null,
            });
            idsOk.push(item.id);
            continue;
          }
          const dados = mapaDados[item.chavePk];
          if (!dados) {
            // Registro foi deletado entre o INSERT e o sync — trata como DELETE
            registros.push({
              tabela: item.tabela,
              operacao: 'D',
              chavePk: item.chavePk,
              dados: null,
            });
            idsOk.push(item.id);
            continue;
          }
          registros.push({
            tabela: item.tabela,
            operacao: item.operacao,
            chavePk: item.chavePk,
            dados,
          });
          idsOk.push(item.id);
        }

        for (const d of deletes) idsOk.push(d.id); // ja incluido acima
      }

      // Envia pro servidor
      if (registros.length === 0) {
        if (idsErr.length > 0) await marcarErro(db, idsErr, 'sem registros pra enviar');
        break;
      }

      try {
        const resp = await enviarSync(cfg, registros);
        await marcarProcessado(db, idsOk);
        totalEnviado += resp.recebidos;
        if (resp.erros && resp.erros.length > 0) {
          log.warn('drenador: servidor reportou erros parciais', {
            erros: resp.erros.slice(0, 5),
            total: resp.erros.length,
          });
        }
      } catch (e) {
        const msg = (e as Error).message;
        log.warn('drenador: envio falhou — vai tentar de novo no proximo ciclo', {
          err: msg,
          qtd: registros.length,
        });
        await marcarErro(db, idsOk, msg);
        totalErro += idsOk.length;
        break; // para o ciclo — servidor pode estar offline
      }

      if (idsErr.length > 0) {
        await marcarErro(db, idsErr, 'falha ao buscar registros no FB');
      }

      // Curta pausa entre batches pra nao saturar
      await new Promise((r) => setTimeout(r, 100));
    }

    log.info('drenador: ciclo concluido', { totalEnviado, totalErro });

    // Housekeeping: limpa registros processados > 7 dias atras (evita fila
    // crescer infinita).
    try {
      await execWrite(
        db,
        `DELETE FROM CONCILIA_SYNC_QUEUE
         WHERE PROCESSADO = 1 AND PROCESSADO_EM < DATEADD(-7 DAY TO CURRENT_TIMESTAMP)
         ROWS 5000`,
      );
    } catch (e) {
      log.warn('drenador: housekeeping falhou', { err: (e as Error).message });
    }
  } finally {
    if (db) await detachFb(db);
  }
}
