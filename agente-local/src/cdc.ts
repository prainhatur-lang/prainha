// CDC (Change Data Capture) — instalacao e desinstalacao da camada de captura
// no Firebird do Consumer. Equivalente ao install-cdc.js standalone, mas
// embutido no agente pra ser executado via comando do dashboard.

import Firebird from 'node-firebird';
import type { Config } from './config';
import { log } from './logger';

// Lista FINAL de 55 tabelas a capturar (decisoes D1-D10 fechadas em 19/05/2026).
// Ver memory/consumer_decisoes_finais_cdc.md.
const TABELAS_CDC: ReadonlyArray<readonly [string, string]> = [
  // [tabela, coluna_pk]
  // Catalogo (8)
  ['PRODUTOTIPO', 'CODIGO'],
  ['UNIDADECOMERCIALIZACAO', 'CODIGO'],
  ['PRODUTOSTAMANHOS', 'CODIGO'],
  ['PRODUTOTAMANHO', 'CODIGO'],
  ['PRODUTOS', 'CODIGO'],
  ['PRODUTODETALHE', 'CODIGO'],
  ['PRODUTOFICHA', 'CODIGO'],
  ['PRODUTODETALHECOMPLEMENTO', 'CODIGO'],
  // Vendas (5)
  ['ITEMPEDIDOTIPO', 'CODIGO'],
  ['PEDIDOORIGEM', 'CODIGO'],
  ['PEDIDOS', 'CODIGO'],
  ['ITENSPEDIDO', 'CODIGO'],
  ['ITEMPEDIDOFICHA', 'CODIGO'],
  // Pagamento (3)
  ['MEIOPAGAMENTO', 'CODIGO'],
  ['FORMASPAGAMENTO', 'CODIGO'],
  ['PAGAMENTOS', 'CODIGO'],
  // Cartao (3)
  ['CREDENCIADORACARTAO', 'CODIGO'],
  ['OPERADORACARTAO', 'CODIGO'],
  ['TEFADQUIRENTE', 'CODIGO'],
  // Financeiro (5)
  ['GRUPODRE', 'CODIGO'],
  ['CATEGORIACONTAS', 'CODIGO'],
  ['CONTASBANCARIAS', 'CODIGO'],
  ['CONTACORRENTE', 'CODIGO'],
  ['CONTASPAGAR', 'CODIGO'],
  // NF (4)
  ['NFE', 'CODIGO'],
  ['NFCE', 'CODIGO'],
  ['NFITEM', 'CODIGO'],
  ['NFPAGAMENTO', 'CODIGO'],
  // NF lookups (10)
  ['CFOP', 'CODIGO'],
  ['SITUACAOTRIBUTARIA', 'CODIGO'],
  ['SITUACAOTRIBUTARIAPIS', 'CODIGO'],
  ['SITUACAOTRIBUTARIACOFINS', 'CODIGO'],
  ['MODALIDADEBCICMS', 'CODIGO'],
  ['ORIGEMMERCADORIA', 'CODIGO'],
  ['REGIMETRIBUTARIO', 'CODIGO'],
  ['TIPODOCUMENTODESTINATARIO', 'CODIGO'],
  ['NFTIPO', 'CODIGO'],
  ['NFSERIE', 'CODIGO'],
  // Contatos (2)
  ['CONTATOS', 'CODIGO'],
  ['FORNECEDORES', 'CODIGO'],
  // Delivery (7)
  ['TIPOENTREGA', 'CODIGO'],
  ['TAXAENTREGA', 'CODIGO'],
  ['TAXAENTREGACEP', 'CODIGO'],
  ['GRUPOENTREGA', 'CODIGO'],
  ['ENDERECO', 'CODIGO'],
  ['DELIVERY', 'CODIGOPEDIDO'],
  ['PEDIDOGRUPOENTREGA', 'CODIGOPEDIDO'],
  // iFood / Integration (4)
  ['IFOODPEDIDO', 'CODIGOPEDIDOIFOOD'],
  ['ORDERINTEGRATION', 'ID'],
  ['ORDERSHIPPING', 'ID'],
  ['MENUDINOPEDIDO', 'CODIGOPEDIDOMENUDINO'],
  // Caixa (2)
  ['CAIXA', 'CODIGO'],
  ['CAIXAOPERACAO', 'CODIGO'],
  // Estoque (2)
  ['ESTOQUE', 'CODIGO'],
  ['ESTOQUEMOVIMENTACAO', 'CODIGO'],
];

type BackfillTipo =
  | 'all'
  | 'data'
  | 'join_pedidos'
  | 'join_pedidos_via_codigopedido'
  | 'join_itens'
  | 'join_nfe';

interface BackfillStrategy {
  tipo: BackfillTipo;
  coluna?: string;
}

const BACKFILL_STRATEGY: Record<string, BackfillStrategy> = {
  // Lookups (all)
  PRODUTOTIPO: { tipo: 'all' },
  UNIDADECOMERCIALIZACAO: { tipo: 'all' },
  PRODUTOSTAMANHOS: { tipo: 'all' },
  ITEMPEDIDOTIPO: { tipo: 'all' },
  PEDIDOORIGEM: { tipo: 'all' },
  MEIOPAGAMENTO: { tipo: 'all' },
  FORMASPAGAMENTO: { tipo: 'all' },
  CREDENCIADORACARTAO: { tipo: 'all' },
  OPERADORACARTAO: { tipo: 'all' },
  TEFADQUIRENTE: { tipo: 'all' },
  GRUPODRE: { tipo: 'all' },
  CFOP: { tipo: 'all' },
  SITUACAOTRIBUTARIA: { tipo: 'all' },
  SITUACAOTRIBUTARIAPIS: { tipo: 'all' },
  SITUACAOTRIBUTARIACOFINS: { tipo: 'all' },
  MODALIDADEBCICMS: { tipo: 'all' },
  ORIGEMMERCADORIA: { tipo: 'all' },
  REGIMETRIBUTARIO: { tipo: 'all' },
  TIPODOCUMENTODESTINATARIO: { tipo: 'all' },
  NFTIPO: { tipo: 'all' },
  NFSERIE: { tipo: 'all' },
  TIPOENTREGA: { tipo: 'all' },
  // Catalogo (all)
  PRODUTOTAMANHO: { tipo: 'all' },
  PRODUTOS: { tipo: 'all' },
  PRODUTODETALHE: { tipo: 'all' },
  PRODUTOFICHA: { tipo: 'all' },
  PRODUTODETALHECOMPLEMENTO: { tipo: 'all' },
  // Cadastros (all)
  CATEGORIACONTAS: { tipo: 'all' },
  FORNECEDORES: { tipo: 'all' },
  CONTASBANCARIAS: { tipo: 'all' },
  CONTATOS: { tipo: 'all' },
  TAXAENTREGA: { tipo: 'all' },
  TAXAENTREGACEP: { tipo: 'all' },
  GRUPOENTREGA: { tipo: 'all' },
  ENDERECO: { tipo: 'all' },
  ESTOQUE: { tipo: 'all' },
  // Transacionais (data ou join)
  PEDIDOS: { tipo: 'data', coluna: 'DATAABERTURA' },
  ITENSPEDIDO: { tipo: 'join_pedidos' },
  ITEMPEDIDOFICHA: { tipo: 'join_itens' },
  PAGAMENTOS: { tipo: 'data', coluna: 'DATAPAGAMENTO' },
  CONTACORRENTE: { tipo: 'data', coluna: 'DATAHORA' },
  CONTASPAGAR: { tipo: 'data', coluna: 'DATACADASTRO' },
  NFE: { tipo: 'data', coluna: 'DATAHORAEMISSAO' },
  NFCE: { tipo: 'data', coluna: 'DATAHORAEMISSAO' },
  NFITEM: { tipo: 'join_nfe' },
  NFPAGAMENTO: { tipo: 'join_nfe' },
  DELIVERY: { tipo: 'join_pedidos_via_codigopedido' },
  PEDIDOGRUPOENTREGA: { tipo: 'join_pedidos_via_codigopedido' },
  IFOODPEDIDO: { tipo: 'data', coluna: 'DATAINSERT' },
  MENUDINOPEDIDO: { tipo: 'data', coluna: 'DATAINSERT' },
  ORDERINTEGRATION: { tipo: 'data', coluna: 'INSERTEDAT' },
  ORDERSHIPPING: { tipo: 'data', coluna: 'INSERTEDAT' },
  CAIXA: { tipo: 'data', coluna: 'DATAABERTURA' },
  CAIXAOPERACAO: { tipo: 'data', coluna: 'DATAOPERACAO' },
  ESTOQUEMOVIMENTACAO: { tipo: 'data', coluna: 'DATAINSERT' },
};

// ---------- Helpers de FB ----------

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

// Roda DDL/DML/SELECT em transacao explicita. Necessario pra DDL no Firebird
// pra que o proximo CREATE enxergue o objeto recem-criado.
function exec<T = unknown>(db: Firebird.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.transaction(Firebird.ISOLATION_READ_COMMITTED, (e, tx) => {
      if (e) return reject(e);
      tx.query(sql, [], (e2: Error | null, r: T[]) => {
        if (e2) {
          tx.rollback(() => reject(e2));
          return;
        }
        tx.commit((e3) => (e3 ? reject(e3) : resolve(r ?? [])));
      });
    });
  });
}

async function existe(
  db: Firebird.Database,
  tipo: 'TABLE' | 'TRIGGER' | 'GENERATOR' | 'INDEX',
  nome: string,
): Promise<boolean> {
  const sqlMap = {
    TABLE: `SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = '${nome}'`,
    TRIGGER: `SELECT 1 FROM RDB$TRIGGERS WHERE RDB$TRIGGER_NAME = '${nome}'`,
    GENERATOR: `SELECT 1 FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME = '${nome}'`,
    INDEX: `SELECT 1 FROM RDB$INDICES WHERE RDB$INDEX_NAME = '${nome}'`,
  };
  const r = await exec(db, sqlMap[tipo]);
  return r.length > 0;
}

// ---------- DDL ----------

const CREATE_TABLE_SQL = `
  CREATE TABLE CONCILIA_SYNC_QUEUE (
    ID            INTEGER NOT NULL PRIMARY KEY,
    TABELA        VARCHAR(50) NOT NULL,
    CHAVE_PK      VARCHAR(100) NOT NULL,
    OPERACAO      CHAR(1) NOT NULL,
    CRIADO_EM     TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PROCESSADO    SMALLINT DEFAULT 0 NOT NULL,
    PROCESSADO_EM TIMESTAMP,
    TENTATIVAS    INTEGER DEFAULT 0 NOT NULL,
    ULTIMO_ERRO   VARCHAR(500)
  )
`;

function triggerSql(tabela: string, pk: string): string {
  return `
    CREATE TRIGGER TR_CONCILIA_${tabela} FOR ${tabela}
    ACTIVE AFTER INSERT OR UPDATE OR DELETE POSITION 100
    AS
    BEGIN
      INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
      VALUES (
        GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1),
        '${tabela}',
        CAST(COALESCE(NEW.${pk}, OLD.${pk}) AS VARCHAR(100)),
        CASE WHEN DELETING THEN 'D' WHEN INSERTING THEN 'I' ELSE 'U' END
      );
      WHEN ANY DO
        BEGIN
          /* swallow: trigger CDC nunca bloqueia o Consumer */
        END
    END
  `;
}

function backfillSql(tabela: string, pk: string, dias: number): string {
  const s = BACKFILL_STRATEGY[tabela];
  if (!s) throw new Error(`sem strategy pra ${tabela}`);
  const limit = `DATEADD(${-dias} DAY TO CURRENT_TIMESTAMP)`;

  if (s.tipo === 'all') {
    return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
            SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                   CAST(${pk} AS VARCHAR(100)), 'I'
            FROM ${tabela}`;
  }
  if (s.tipo === 'data') {
    return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
            SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                   CAST(${pk} AS VARCHAR(100)), 'I'
            FROM ${tabela}
            WHERE ${s.coluna} >= ${limit}`;
  }
  if (s.tipo === 'join_pedidos') {
    return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
            SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                   CAST(i.${pk} AS VARCHAR(100)), 'I'
            FROM ${tabela} i
            JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
            WHERE p.DATAABERTURA >= ${limit}`;
  }
  if (s.tipo === 'join_pedidos_via_codigopedido') {
    return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
            SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                   CAST(i.${pk} AS VARCHAR(100)), 'I'
            FROM ${tabela} i
            JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
            WHERE p.DATAABERTURA >= ${limit}`;
  }
  if (s.tipo === 'join_itens') {
    return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
            SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                   CAST(f.${pk} AS VARCHAR(100)), 'I'
            FROM ${tabela} f
            JOIN ITENSPEDIDO i ON i.CODIGO = f.CODIGOITEMPEDIDO
            JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
            WHERE p.DATAABERTURA >= ${limit}`;
  }
  if (s.tipo === 'join_nfe') {
    if (tabela === 'NFITEM') {
      return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
              SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                     CAST(ni.${pk} AS VARCHAR(100)), 'I'
              FROM ${tabela} ni
              LEFT JOIN ITENSPEDIDO i ON i.CODIGO = ni.CODITEMPEDIDO
              LEFT JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
              WHERE p.DATAABERTURA >= ${limit} OR p.CODIGO IS NULL`;
    }
    if (tabela === 'NFPAGAMENTO') {
      return `INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
              SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}',
                     CAST(nf.${pk} AS VARCHAR(100)), 'I'
              FROM ${tabela} nf
              LEFT JOIN PAGAMENTOS pg ON pg.CODIGO = nf.CODPAGAMENTO
              WHERE pg.DATAPAGAMENTO >= ${limit} OR pg.CODIGO IS NULL`;
    }
  }
  throw new Error(`estrategia desconhecida pra ${tabela}: ${s.tipo}`);
}

// ---------- API publica ----------

export interface ResultadoInstalacao {
  estruturasCriadas: number;
  estruturasJaExistiam: number;
  triggersCriados: number;
  triggersJaExistiam: number;
  tabelasNaoEncontradas: string[];
  backfillEnfileirado: number;
  totalNaFila: number;
  dias: number;
}

export async function instalarCdc(
  cfg: Config,
  dias: number = 365,
): Promise<ResultadoInstalacao> {
  log.info('cdc: iniciando instalacao', { dias });
  const db = await attachFb(cfg);
  const res: ResultadoInstalacao = {
    estruturasCriadas: 0,
    estruturasJaExistiam: 0,
    triggersCriados: 0,
    triggersJaExistiam: 0,
    tabelasNaoEncontradas: [],
    backfillEnfileirado: 0,
    totalNaFila: 0,
    dias,
  };
  try {
    // Estrutura
    if (!(await existe(db, 'TABLE', 'CONCILIA_SYNC_QUEUE'))) {
      await exec(db, CREATE_TABLE_SQL);
      res.estruturasCriadas++;
    } else {
      res.estruturasJaExistiam++;
    }
    if (!(await existe(db, 'GENERATOR', 'GEN_CONCILIA_SYNC_QUEUE'))) {
      await exec(db, 'CREATE GENERATOR GEN_CONCILIA_SYNC_QUEUE');
      res.estruturasCriadas++;
    } else {
      res.estruturasJaExistiam++;
    }
    if (!(await existe(db, 'INDEX', 'IDX_CONCILIA_QUEUE_PEND'))) {
      await exec(
        db,
        'CREATE INDEX IDX_CONCILIA_QUEUE_PEND ON CONCILIA_SYNC_QUEUE (PROCESSADO, ID)',
      );
      res.estruturasCriadas++;
    } else {
      res.estruturasJaExistiam++;
    }
    if (!(await existe(db, 'INDEX', 'IDX_CONCILIA_QUEUE_DEDUP'))) {
      await exec(
        db,
        'CREATE INDEX IDX_CONCILIA_QUEUE_DEDUP ON CONCILIA_SYNC_QUEUE (TABELA, CHAVE_PK, PROCESSADO)',
      );
      res.estruturasCriadas++;
    } else {
      res.estruturasJaExistiam++;
    }

    // Triggers
    for (const [tabela, pk] of TABELAS_CDC) {
      const trigName = `TR_CONCILIA_${tabela}`;
      if (await existe(db, 'TRIGGER', trigName)) {
        res.triggersJaExistiam++;
        continue;
      }
      if (!(await existe(db, 'TABLE', tabela))) {
        res.tabelasNaoEncontradas.push(tabela);
        continue;
      }
      await exec(db, triggerSql(tabela, pk));
      res.triggersCriados++;
    }

    // Backfill (so se dias > 0)
    if (dias > 0) {
      for (const [tabela, pk] of TABELAS_CDC) {
        if (!(await existe(db, 'TABLE', tabela))) continue;
        try {
          await exec(db, backfillSql(tabela, pk, dias));
        } catch (e) {
          log.warn('cdc: backfill falhou pra tabela', {
            tabela,
            err: (e as Error).message,
          });
        }
      }
      const r = await exec<{ N: number }>(
        db,
        'SELECT count(*) AS N FROM CONCILIA_SYNC_QUEUE WHERE PROCESSADO = 0',
      );
      res.backfillEnfileirado = Number(r[0]?.N ?? 0);
    }

    const total = await exec<{ N: number }>(
      db,
      'SELECT count(*) AS N FROM CONCILIA_SYNC_QUEUE',
    );
    res.totalNaFila = Number(total[0]?.N ?? 0);

    log.info('cdc: instalacao concluida', res);
    return res;
  } finally {
    await detachFb(db);
  }
}

export interface ResultadoDesinstalacao {
  triggersRemovidos: number;
  estruturasRemovidas: number;
}

export async function desinstalarCdc(cfg: Config): Promise<ResultadoDesinstalacao> {
  log.info('cdc: iniciando desinstalacao');
  const db = await attachFb(cfg);
  const res: ResultadoDesinstalacao = { triggersRemovidos: 0, estruturasRemovidas: 0 };
  try {
    for (const [tabela] of TABELAS_CDC) {
      const trigName = `TR_CONCILIA_${tabela}`;
      try {
        await exec(db, `DROP TRIGGER ${trigName}`);
        res.triggersRemovidos++;
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (!/not defined|does not exist|unknown/i.test(msg)) {
          log.warn('cdc: drop trigger falhou', { trigName, msg });
        }
      }
    }
    for (const objeto of [
      'INDEX IDX_CONCILIA_QUEUE_PEND',
      'INDEX IDX_CONCILIA_QUEUE_DEDUP',
      'TABLE CONCILIA_SYNC_QUEUE',
      'GENERATOR GEN_CONCILIA_SYNC_QUEUE',
    ]) {
      try {
        await exec(db, `DROP ${objeto}`);
        res.estruturasRemovidas++;
      } catch {
        /* ignora se nao existe */
      }
    }
    log.info('cdc: desinstalacao concluida', res);
    return res;
  } finally {
    await detachFb(db);
  }
}

export interface StatusCdc {
  instalado: boolean;
  triggersInstalados: number;
  pendentes: number;
  totalNaFila: number;
  ultimaCriacao: string | null;
  ultimoProcessado: string | null;
  comErro: number;
  tentativasMax: number;
  exemploErros: Array<{ tabela: string; tentativas: number; erro: string | null }>;
}

export async function statusCdc(cfg: Config): Promise<StatusCdc> {
  const db = await attachFb(cfg);
  try {
    const temTabela = await existe(db, 'TABLE', 'CONCILIA_SYNC_QUEUE');
    if (!temTabela) {
      return {
        instalado: false,
        triggersInstalados: 0,
        pendentes: 0,
        totalNaFila: 0,
        ultimaCriacao: null,
        ultimoProcessado: null,
        comErro: 0,
        tentativasMax: 0,
        exemploErros: [],
      };
    }
    const trigs = await exec<{ N: number }>(
      db,
      "SELECT count(*) AS N FROM RDB$TRIGGERS " +
        "WHERE RDB$TRIGGER_NAME STARTING WITH 'TR_CONCILIA'",
    );
    const stats = await exec<{
      PENDENTES: number;
      TOTAL: number;
      ULT_CRIACAO: Date | null;
      ULT_PROC: Date | null;
    }>(
      db,
      `SELECT
         count(*) FILTER (WHERE PROCESSADO = 0) AS PENDENTES,
         count(*) AS TOTAL,
         MAX(CRIADO_EM) AS ULT_CRIACAO,
         MAX(PROCESSADO_EM) AS ULT_PROC
       FROM CONCILIA_SYNC_QUEUE`,
    );
    // Diagnostico: quantos com erro + amostras
    const erroStats = await exec<{ COM_ERRO: number; MAX_TENT: number }>(
      db,
      `SELECT count(*) AS COM_ERRO, COALESCE(MAX(TENTATIVAS), 0) AS MAX_TENT
       FROM CONCILIA_SYNC_QUEUE
       WHERE TENTATIVAS > 0 AND PROCESSADO = 0`,
    );
    const exemplos = await exec<{
      TABELA: string;
      TENTATIVAS: number;
      ULTIMO_ERRO: string | null;
    }>(
      db,
      `SELECT FIRST 5 TABELA, TENTATIVAS, ULTIMO_ERRO
       FROM CONCILIA_SYNC_QUEUE
       WHERE TENTATIVAS > 0 AND PROCESSADO = 0
       ORDER BY TENTATIVAS DESC`,
    );
    return {
      instalado: true,
      triggersInstalados: Number(trigs[0]?.N ?? 0),
      pendentes: Number(stats[0]?.PENDENTES ?? 0),
      totalNaFila: Number(stats[0]?.TOTAL ?? 0),
      ultimaCriacao: stats[0]?.ULT_CRIACAO?.toISOString() ?? null,
      ultimoProcessado: stats[0]?.ULT_PROC?.toISOString() ?? null,
      comErro: Number(erroStats[0]?.COM_ERRO ?? 0),
      tentativasMax: Number(erroStats[0]?.MAX_TENT ?? 0),
      exemploErros: exemplos.map((e) => ({
        tabela: (e.TABELA ?? '').trim(),
        tentativas: Number(e.TENTATIVAS),
        erro: e.ULTIMO_ERRO ? (e.ULTIMO_ERRO as unknown as string).trim() : null,
      })),
    };
  } finally {
    await detachFb(db);
  }
}

export { TABELAS_CDC };
