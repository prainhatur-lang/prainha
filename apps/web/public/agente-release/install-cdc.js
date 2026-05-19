// Instalador da camada CDC (Change Data Capture) do concilia v2.
//
// Cria no Firebird do Consumer:
//   - Tabela CONCILIA_SYNC_QUEUE (id, tabela, chave_pk, operacao, criado_em, processado, ...)
//   - Generator GEN_CONCILIA_SYNC_QUEUE
//   - 2 indices
//   - 11 triggers AFTER INSERT/UPDATE/DELETE (1 por tabela: PRODUTOS, PRODUTODETALHE,
//     PEDIDOS, ITENSPEDIDO, PAGAMENTOS, CONTACORRENTE, CONTASPAGAR, CATEGORIACONTAS,
//     FORNECEDORES, CONTATOS, CONTASBANCARIAS)
//   - Backfill inicial: marca registros existentes como pendentes (filtra por data
//     em tabelas grandes pra reduzir volume).
//
// IDEMPOTENTE: pode rodar varias vezes. Cada CREATE eh protegido por checagem
// previa no RDB$RELATIONS / RDB$TRIGGERS.
//
// PRINCIPIO: nao modifica objetos do RAL Tecnologia. So adiciona objetos
// com prefixo CONCILIA_* / GEN_CONCILIA_* / TR_CONCILIA_*.
//
// USO:
//   1. Baixe:
//      Invoke-WebRequest "https://app.prainhabar.com/agente-release/install-cdc.js" -OutFile C:\concilia-agente\install-cdc.js -UseBasicParsing
//   2. Garanta que node-firebird existe em C:\concilia-agente\diag-modules\package\lib
//   3. Rode:
//      cd C:\concilia-agente
//      .\node install-cdc.js
//
// Por padrao, backfill pega 365 dias. Pra mudar:
//      .\node install-cdc.js --dias=730   (2 anos)
//      .\node install-cdc.js --dias=0     (nao faz backfill)

const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'C:\\concilia-agente';
const FB_LIB = path.join(ROOT, 'diag-modules', 'package', 'lib');
const CONFIG = path.join(ROOT, 'config.json');

if (!fs.existsSync(FB_LIB)) {
  console.error('node-firebird nao encontrado em:', FB_LIB);
  process.exit(1);
}
if (!fs.existsSync(CONFIG)) {
  console.error('config.json nao encontrado em:', CONFIG);
  process.exit(1);
}

const fb = require(FB_LIB);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

// CLI args
const diasArg = process.argv.find((a) => a.startsWith('--dias='));
const DIAS_BACKFILL = diasArg ? parseInt(diasArg.split('=')[1], 10) : 365;

// ---------- Helpers ----------

function attach() {
  return new Promise((resolve, reject) => {
    fb.attach(cfg.firebird, (e, db) => {
      if (e) return reject(e);
      resolve(db);
    });
  });
}

// Roda DDL/DML/SELECT em transacao explicita com commit no fim.
// Necessario pra DDL no Firebird: sem commit, o proximo CREATE nao enxerga
// o objeto recem-criado.
function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.transaction(fb.ISOLATION_READ_COMMITTED, (e, tx) => {
      if (e) return reject(e);
      tx.query(sql, (e2, r) => {
        if (e2) {
          tx.rollback(() => reject(e2));
          return;
        }
        tx.commit((e3) => {
          if (e3) return reject(e3);
          resolve(r);
        });
      });
    });
  });
}

function detach(db) {
  return new Promise((resolve) => {
    try { db.detach(() => resolve()); } catch { resolve(); }
  });
}

async function existe(db, tipo, nome) {
  // tipo: 'TABLE' | 'TRIGGER' | 'GENERATOR' | 'INDEX'
  let sql;
  if (tipo === 'TABLE') {
    sql = "SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = '" + nome + "'";
  } else if (tipo === 'TRIGGER') {
    sql = "SELECT 1 FROM RDB$TRIGGERS WHERE RDB$TRIGGER_NAME = '" + nome + "'";
  } else if (tipo === 'GENERATOR') {
    sql = "SELECT 1 FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME = '" + nome + "'";
  } else if (tipo === 'INDEX') {
    sql = "SELECT 1 FROM RDB$INDICES WHERE RDB$INDEX_NAME = '" + nome + "'";
  }
  const r = await exec(db, sql);
  return r.length > 0;
}

async function passo(db, descricao, fn) {
  process.stdout.write('  ' + descricao + '... ');
  try {
    const resultado = await fn();
    console.log(resultado === undefined ? 'OK' : resultado);
  } catch (e) {
    console.log('ERRO: ' + e.message);
    throw e;
  }
}

// ---------- DDL ----------

const TABELAS_CDC = [
  // [tabela, coluna_pk, descricao_curta]
  ['PRODUTOS',        'CODIGO', 'produtos (pai)'],
  ['PRODUTODETALHE',  'CODIGO', 'produto variantes'],
  ['PEDIDOS',         'CODIGO', 'pedidos/comandas'],
  ['ITENSPEDIDO',     'CODIGO', 'items de pedido'],
  ['PAGAMENTOS',      'CODIGO', 'pagamentos'],
  ['CONTACORRENTE',   'CODIGO', 'movimento conta corrente'],
  ['CONTASPAGAR',     'CODIGO', 'contas a pagar'],
  ['CATEGORIACONTAS', 'CODIGO', 'categorias contabeis'],
  ['FORNECEDORES',    'CODIGO', 'fornecedores'],
  ['CONTATOS',        'CODIGO', 'contatos/clientes'],
  ['CONTASBANCARIAS', 'CODIGO', 'contas bancarias'],
];

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

function triggerSql(tabela, pk) {
  // Trigger AFTER I/U/D que enfileira na queue.
  // WHEN ANY DO BEGIN END swallows erros — nunca bloqueia o Consumer.
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

// Estrategia de backfill por tabela
// "all" = marca tudo, "data" = marca onde {coluna} >= NOW - dias
// "join_pedidos" = filtra via JOIN com PEDIDOS.DATAABERTURA
const BACKFILL_STRATEGY = {
  PRODUTOS:        { tipo: 'all' },
  PRODUTODETALHE:  { tipo: 'all' },
  CATEGORIACONTAS: { tipo: 'all' },
  FORNECEDORES:    { tipo: 'all' },
  CONTASBANCARIAS: { tipo: 'all' },
  CONTATOS:        { tipo: 'all' },          // 31k — vale a pena tudo
  CONTACORRENTE:   { tipo: 'all' },          // 11k
  CONTASPAGAR:     { tipo: 'all' },          // 50k — tabela importante, marca tudo
  PEDIDOS:         { tipo: 'data', coluna: 'DATAABERTURA' },
  ITENSPEDIDO:     { tipo: 'join_pedidos' }, // via JOIN PEDIDOS.DATAABERTURA
  PAGAMENTOS:      { tipo: 'data', coluna: 'DATAPAGAMENTO' },
};

function backfillSql(tabela, pk, dias) {
  const s = BACKFILL_STRATEGY[tabela];
  if (s.tipo === 'all') {
    return `
      INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
      SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}', CAST(${pk} AS VARCHAR(100)), 'I'
      FROM ${tabela}
    `;
  }
  if (s.tipo === 'data') {
    return `
      INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
      SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}', CAST(${pk} AS VARCHAR(100)), 'I'
      FROM ${tabela}
      WHERE ${s.coluna} >= DATEADD(${-dias} DAY TO CURRENT_TIMESTAMP)
    `;
  }
  if (s.tipo === 'join_pedidos') {
    return `
      INSERT INTO CONCILIA_SYNC_QUEUE (ID, TABELA, CHAVE_PK, OPERACAO)
      SELECT GEN_ID(GEN_CONCILIA_SYNC_QUEUE, 1), '${tabela}', CAST(i.${pk} AS VARCHAR(100)), 'I'
      FROM ${tabela} i
      JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
      WHERE p.DATAABERTURA >= DATEADD(${-dias} DAY TO CURRENT_TIMESTAMP)
    `;
  }
  throw new Error('estrategia desconhecida');
}

// ---------- Main ----------

async function main() {
  console.log('=== Concilia CDC Install ===');
  console.log('FB:           ' + cfg.firebird.host + ':' + cfg.firebird.port);
  console.log('Database:     ' + cfg.firebird.database);
  console.log('Backfill:     ' + DIAS_BACKFILL + ' dias (passe --dias=N pra alterar, 0 desativa)');
  console.log('');

  const db = await attach();
  try {
    console.log('### Estrutura ###');

    await passo(db, 'CONCILIA_SYNC_QUEUE (table)', async () => {
      if (await existe(db, 'TABLE', 'CONCILIA_SYNC_QUEUE')) return 'JA EXISTE';
      await exec(db, CREATE_TABLE_SQL);
    });

    await passo(db, 'GEN_CONCILIA_SYNC_QUEUE (generator)', async () => {
      if (await existe(db, 'GENERATOR', 'GEN_CONCILIA_SYNC_QUEUE')) return 'JA EXISTE';
      await exec(db, 'CREATE GENERATOR GEN_CONCILIA_SYNC_QUEUE');
    });

    await passo(db, 'IDX_CONCILIA_QUEUE_PEND (index)', async () => {
      if (await existe(db, 'INDEX', 'IDX_CONCILIA_QUEUE_PEND')) return 'JA EXISTE';
      await exec(db, 'CREATE INDEX IDX_CONCILIA_QUEUE_PEND ON CONCILIA_SYNC_QUEUE (PROCESSADO, ID)');
    });

    await passo(db, 'IDX_CONCILIA_QUEUE_DEDUP (index)', async () => {
      if (await existe(db, 'INDEX', 'IDX_CONCILIA_QUEUE_DEDUP')) return 'JA EXISTE';
      await exec(db, 'CREATE INDEX IDX_CONCILIA_QUEUE_DEDUP ON CONCILIA_SYNC_QUEUE (TABELA, CHAVE_PK, PROCESSADO)');
    });

    console.log('\n### Triggers (11 tabelas) ###');
    for (const [tabela, pk] of TABELAS_CDC) {
      const trigName = 'TR_CONCILIA_' + tabela;
      await passo(db, trigName + ' (' + tabela + '.' + pk + ')', async () => {
        if (await existe(db, 'TRIGGER', trigName)) return 'JA EXISTE';
        // Confirma que a tabela existe antes de criar trigger
        if (!(await existe(db, 'TABLE', tabela))) return 'PULOU (tabela ' + tabela + ' nao existe)';
        await exec(db, triggerSql(tabela, pk));
      });
    }

    if (DIAS_BACKFILL > 0) {
      console.log('\n### Backfill inicial (' + DIAS_BACKFILL + ' dias) ###');
      for (const [tabela, pk] of TABELAS_CDC) {
        await passo(db, tabela, async () => {
          if (!(await existe(db, 'TABLE', tabela))) return 'PULOU (tabela nao existe)';
          const strat = BACKFILL_STRATEGY[tabela];
          // Conta antes
          const sql = backfillSql(tabela, pk, DIAS_BACKFILL);
          // Executa
          const t0 = Date.now();
          await exec(db, sql);
          // Conta o que ficou na fila pra essa tabela
          const r = await exec(db,
            "SELECT count(*) AS N FROM CONCILIA_SYNC_QUEUE " +
            "WHERE TABELA = '" + tabela + "' AND PROCESSADO = 0"
          );
          const ms = Date.now() - t0;
          return r[0].N + ' enfileirados (' + strat.tipo + ', ' + ms + 'ms)';
        });
      }
    } else {
      console.log('\n### Backfill desativado (--dias=0) ###');
    }

    // Resumo final
    const total = await exec(db,
      'SELECT count(*) AS N FROM CONCILIA_SYNC_QUEUE WHERE PROCESSADO = 0'
    );
    console.log('\n=== Concluido ===');
    console.log('Total pendente na fila: ' + total[0].N);
    console.log('');
    console.log('Proximo passo: deploy do agente v1.0.0 (drenador) pra processar a fila.');
    console.log('Enquanto isso, o agente v0.7.0 atual continua funcionando normalmente —');
    console.log('a fila eh independente, nao afeta os ciclos antigos.');
  } finally {
    await detach(db);
  }
}

main().catch((e) => {
  console.error('\nFALHA:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
