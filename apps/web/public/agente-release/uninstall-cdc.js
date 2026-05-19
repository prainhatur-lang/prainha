// Desinstalador da camada CDC do concilia v2.
//
// Remove TODOS os objetos com prefixo CONCILIA_* / TR_CONCILIA_* /
// GEN_CONCILIA_* / IDX_CONCILIA_*. Util pra reverter a instalacao
// caso algo de errado ou pra reinstalar do zero.
//
// USO:
//   Invoke-WebRequest "https://app.prainhabar.com/agente-release/uninstall-cdc.js" -OutFile C:\concilia-agente\uninstall-cdc.js -UseBasicParsing
//   cd C:\concilia-agente
//   .\node uninstall-cdc.js

const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'C:\\concilia-agente';
const FB_LIB = path.join(ROOT, 'diag-modules', 'package', 'lib');
const CONFIG = path.join(ROOT, 'config.json');

const fb = require(FB_LIB);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

function attach() {
  return new Promise((resolve, reject) => {
    fb.attach(cfg.firebird, (e, db) => {
      if (e) return reject(e);
      resolve(db);
    });
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.transaction(fb.ISOLATION_READ_COMMITTED, (e, tx) => {
      if (e) return reject(e);
      tx.query(sql, (e2, r) => {
        if (e2) { tx.rollback(() => reject(e2)); return; }
        tx.commit((e3) => {
          if (e3) return reject(e3);
          resolve(r);
        });
      });
    });
  });
}

// Lista das 56 tabelas CDC v2 (decisoes finais 19/05/2026).
const TABELAS = [
  // Catalogo
  'PRODUTOTIPO', 'UNIDADECOMERCIALIZACAO', 'PRODUTOSTAMANHOS', 'PRODUTOTAMANHO',
  'PRODUTOS', 'PRODUTODETALHE', 'PRODUTOFICHA', 'PRODUTODETALHECOMPLEMENTO',
  // Vendas
  'ITEMPEDIDOTIPO', 'PEDIDOORIGEM', 'PEDIDOS', 'ITENSPEDIDO', 'ITEMPEDIDOFICHA',
  // Pagamento
  'MEIOPAGAMENTO', 'FORMASPAGAMENTO', 'PAGAMENTOS',
  // Cartao
  'CREDENCIADORACARTAO', 'OPERADORACARTAO', 'TEFADQUIRENTE',
  // Financeiro
  'GRUPODRE', 'CATEGORIACONTAS', 'CONTASBANCARIAS', 'CONTACORRENTE', 'CONTASPAGAR',
  // NF
  'NFE', 'NFCE', 'NFITEM', 'NFPAGAMENTO',
  // NF lookups
  'CFOP', 'SITUACAOTRIBUTARIA', 'SITUACAOTRIBUTARIAPIS', 'SITUACAOTRIBUTARIACOFINS',
  'MODALIDADEBCICMS', 'ORIGEMMERCADORIA', 'REGIMETRIBUTARIO',
  'TIPODOCUMENTODESTINATARIO', 'NFTIPO', 'NFSERIE',
  // Contatos
  'CONTATOS', 'FORNECEDORES',
  // Delivery
  'TIPOENTREGA', 'TAXAENTREGA', 'TAXAENTREGACEP',
  'GRUPOENTREGA', 'ENDERECO', 'DELIVERY', 'PEDIDOGRUPOENTREGA',
  // iFood / Integration
  'IFOODPEDIDO', 'ORDERINTEGRATION', 'ORDERSHIPPING', 'MENUDINOPEDIDO',
  // Caixa
  'CAIXA', 'CAIXAOPERACAO',
  // Estoque
  'ESTOQUE', 'ESTOQUEMOVIMENTACAO',
];

async function tentaDrop(db, sql, descricao) {
  process.stdout.write('  ' + descricao + '... ');
  try {
    await exec(db, sql);
    console.log('OK');
  } catch (e) {
    // "Object not defined" eh esperado (ja foi removido ou nao existia)
    if (/not defined|does not exist|unknown/i.test(e.message)) {
      console.log('ja nao existia');
    } else {
      console.log('FALHOU: ' + e.message);
    }
  }
}

async function main() {
  console.log('=== Concilia CDC UNINSTALL ===');
  console.log('Database: ' + cfg.firebird.database);
  console.log('');

  const db = await attach();
  try {
    console.log('### Triggers ###');
    for (const t of TABELAS) {
      await tentaDrop(db, 'DROP TRIGGER TR_CONCILIA_' + t, 'TR_CONCILIA_' + t);
    }

    console.log('\n### Indices ###');
    await tentaDrop(db, 'DROP INDEX IDX_CONCILIA_QUEUE_PEND', 'IDX_CONCILIA_QUEUE_PEND');
    await tentaDrop(db, 'DROP INDEX IDX_CONCILIA_QUEUE_DEDUP', 'IDX_CONCILIA_QUEUE_DEDUP');

    console.log('\n### Tabela e generator ###');
    await tentaDrop(db, 'DROP TABLE CONCILIA_SYNC_QUEUE', 'CONCILIA_SYNC_QUEUE');
    await tentaDrop(db, 'DROP GENERATOR GEN_CONCILIA_SYNC_QUEUE', 'GEN_CONCILIA_SYNC_QUEUE');

    console.log('\n=== Concluido ===');
    console.log('Nenhum objeto CONCILIA_* deve restar no banco.');
  } finally {
    try { db.detach(() => {}); } catch {}
  }
}

main().catch((e) => {
  console.error('FALHA:', e.message);
  process.exit(1);
});
