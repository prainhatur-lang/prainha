// VALIDAÇÃO do write-back de conta a pagar (CONTASPAGAR).
//
// DOIS MODOS:
//   (padrão) SOMENTE LEITURA — nenhuma escrita, nenhum generator avançado.
//            Seguro de rodar em QUALQUER máquina, inclusive produção.
//            Confere: generator existe + valor atual (sem avançar), triggers,
//            colunas NOT NULL, e uma amostra de VALOR pra inferir a escala.
//
//   --insert-teste  → faz UM INSERT real numa transação e dá ROLLBACK.
//            ⚠️ SÓ rode com certeza absoluta que é a instância de TESTE.
//            Atenção: generators NÃO são transacionais — se houver trigger
//            BEFORE INSERT (ou cair no GEN_ID), o contador avança 1 mesmo com
//            rollback (buraco inofensivo num banco de teste).
//
// Uso:
//   node validar-criar-contapagar.js                 (leitura, seguro)
//   node validar-criar-contapagar.js --insert-teste  (SÓ na TESTE)
//   FB_HOST=... FB_DB=... node validar-criar-contapagar.js

const fs = require('node:fs');
const Firebird = require('node-firebird');
const FAZER_INSERT = process.argv.includes('--insert-teste');

// Conexão: por padrão lê do config.json do agente (banco REAL que ele usa) —
// evita apontar pro FDB template por engano. Override por --config <path> ou
// por env FB_HOST/FB_DB/FB_USER/FB_PASS.
const cfgArgIdx = process.argv.indexOf('--config');
const cfgPath = cfgArgIdx >= 0 ? process.argv[cfgArgIdx + 1] : 'C:\\concilia-agente\\config.json';
let fbFromConfig = null;
try {
  if (fs.existsSync(cfgPath)) {
    const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (j.firebird && j.firebird.database) {
      fbFromConfig = j.firebird;
      console.log(`(conexão lida de ${cfgPath})`);
    }
  }
} catch (e) {
  console.log(`(não consegui ler ${cfgPath}: ${e.message} — usando env/default)`);
}

const options = {
  host: process.env.FB_HOST || (fbFromConfig && fbFromConfig.host) || 'localhost',
  port: Number(process.env.FB_PORT || (fbFromConfig && fbFromConfig.port) || 3050),
  database:
    process.env.FB_DB ||
    (fbFromConfig && fbFromConfig.database) ||
    'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  user: process.env.FB_USER || (fbFromConfig && fbFromConfig.user) || 'SYSDBA',
  password: process.env.FB_PASS || (fbFromConfig && fbFromConfig.password) || 'masterkey',
  lowercase_keys: false,
  role: null,
  pageSize: 4096,
};

const VALOR_TESTE = 12.34;
const DESC_TESTE = 'TESTE CONCILIA ROLLBACK';
const GEN_ASSUMIDO = 'GEN_CONTASPAGAR_ID';

function attach(opt) {
  return new Promise((res, rej) => Firebird.attach(opt, (e, db) => (e ? rej(e) : res(db))));
}
function q(db, sql, params) {
  return new Promise((res, rej) => db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r))));
}
function startTx(db) {
  return new Promise((res, rej) =>
    db.transaction(Firebird.ISOLATION_READ_COMMITTED, (e, tx) => (e ? rej(e) : res(tx))),
  );
}
function txQuery(tx, sql, params) {
  return new Promise((res, rej) => tx.query(sql, params || [], (e, r) => (e ? rej(e) : res(r))));
}
function txRollback(tx) {
  return new Promise((res) => tx.rollback(() => res()));
}
function extrairCodigo(r) {
  const ins = Array.isArray(r) ? r[0] : r;
  return ins && (ins.CODIGO ?? ins.codigo) != null ? (ins.CODIGO ?? ins.codigo) : null;
}

(async () => {
  let db;
  try {
    db = await attach(options);
    console.log(`✓ Conectado em ${options.host}:${options.port}`);
    console.log(`  banco: ${options.database}`);
    const ehTemplate = /Program Files/i.test(options.database);
    if (ehTemplate) console.log('  ⚠ ATENÇÃO: caminho parece o TEMPLATE (Program Files), não a produção (AppData). Confira!');
    console.log(`  modo: ${FAZER_INSERT ? 'INSERT DE TESTE (rollback)' : 'SOMENTE LEITURA (seguro)'}\n`);

    // 1) Generator (LEITURA — GEN_ID(gen,0) NÃO avança)
    console.log('=== 1) Generator do CODIGO ===');
    const gens = await q(
      db,
      `SELECT TRIM(RDB$GENERATOR_NAME) AS G FROM RDB$GENERATORS WHERE RDB$SYSTEM_FLAG=0 AND RDB$GENERATOR_NAME CONTAINING 'CONTASPAGAR'`,
    );
    gens.forEach((g) => console.log('   - generator:', g.G));
    const genExiste = gens.some((g) => g.G === GEN_ASSUMIDO);
    const genUsar = genExiste ? GEN_ASSUMIDO : gens[0] ? gens[0].G : null;
    let genVal = null;
    if (genUsar) {
      const gv = await q(db, `SELECT GEN_ID(${genUsar}, 0) AS V FROM RDB$DATABASE`); // 0 = só lê
      genVal = gv[0] ? Number(gv[0].V) : null;
      console.log(`   valor atual (sem avançar): ${genVal}`);
    } else {
      console.log('   ⚠ nenhum generator com CONTASPAGAR no nome — investigar.');
    }
    const maxc = await q(db, `SELECT MAX(CODIGO) AS MX, COUNT(*) AS N FROM CONTASPAGAR`);
    console.log(`   MAX(CODIGO)=${maxc[0].MX}  total linhas=${maxc[0].N}`);
    if (genVal != null && maxc[0].MX != null) {
      console.log(`   ${genVal >= maxc[0].MX ? '✓ generator >= MAX (consistente)' : '⚠ generator < MAX — pode não ser o generator certo'}`);
    }

    // 2) Triggers BEFORE INSERT
    console.log('\n=== 2) Triggers da CONTASPAGAR ===');
    const trg = await q(
      db,
      `SELECT TRIM(RDB$TRIGGER_NAME) AS N, RDB$TRIGGER_TYPE AS T, RDB$TRIGGER_INACTIVE AS INA FROM RDB$TRIGGERS WHERE RDB$RELATION_NAME='CONTASPAGAR' AND RDB$SYSTEM_FLAG=0`,
    );
    if (!trg.length) console.log('   (nenhum trigger de usuário)');
    trg.forEach((t) => console.log(`   - ${t.N} type=${t.T}${t.T === 1 ? ' (BEFORE INSERT)' : ''} inativo=${t.INA}`));
    const temBeforeInsert = trg.some((t) => t.T === 1 && !t.INA);

    // 3) Amostra de VALOR (inferir escala sem escrever)
    console.log('\n=== 3) Amostra de VALOR (inferir escala) ===');
    const amostra = await q(db, `SELECT FIRST 3 CODIGO, VALOR FROM CONTASPAGAR WHERE VALOR > 0 ORDER BY CODIGO DESC`);
    amostra.forEach((r) => console.log(`   CODIGO ${r.CODIGO}: VALOR=${r.VALOR} (typeof ${typeof r.VALOR})`));
    const valOk = amostra.length && amostra.every((r) => Number(r.VALOR) < 1e7 && !Number.isInteger(Number(r.VALOR) * 1) === false ? true : Number(r.VALOR) < 1e7);
    console.log(amostra.length
      ? `   → node-firebird devolve VALOR como ${typeof amostra[0].VALOR}=${amostra[0].VALOR}. Se parece reais (ex: 35.90), a escala é tratada e o agente passa reais direto. ✓`
      : '   (sem linhas com VALOR>0 pra amostrar)');

    if (!FAZER_INSERT) {
      console.log('\n========== RESUMO (somente leitura) ==========');
      console.log(`Generator      : ${genUsar ?? '(não achado)'}${genExiste ? ' ✓ (= assumido)' : genUsar ? ' ⚠ (DIFERENTE de GEN_CONTASPAGAR_ID)' : ''}`);
      console.log(`Trigger B.I.   : ${temBeforeInsert ? 'SIM (provável que preencha CODIGO)' : 'não'}`);
      console.log(`Escala VALOR   : ver amostra acima`);
      console.log('==============================================');
      console.log('\nPra a PROVA definitiva (INSERT real + rollback), rode na TESTE:');
      console.log('   node validar-criar-contapagar.js --insert-teste');
      console.log('Me cola este resumo que eu já confirmo/ajusto o agente.');
      db.detach();
      return;
    }

    // ===== MODO INSERT DE TESTE (rollback) — só com --insert-teste =====
    console.log('\n=== 4) INSERT de teste (transação → ROLLBACK) ===');
    console.log('   ⚠ Só prossiga se isto é a instância de TESTE.');
    const cat = await q(db, `SELECT FIRST 1 CODIGO FROM CATEGORIASCONTAS ORDER BY CODIGO`).catch(() => []);
    const codCategoria = cat[0] ? cat[0].CODIGO : 1;
    const COLS = 'CODIGOCATEGORIACONTAS, CODIGOFORNECEDOR, PARCELA, TOTALPARCELAS, DATAVENCIMENTO, VALOR, DESCONTOS, DATACADASTRO, COMPETENCIA, DESCRICAO, OBSERVACAO, VERSAOREG, VERSAOSINC';
    const VALS = '?, ?, 1, 1, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 1, 1';
    const params = [codCategoria, null, new Date('2099-12-01T00:00:00'), VALOR_TESTE, null, '209912', DESC_TESTE, DESC_TESTE];

    let modo = null, codigoGerado = null, valorLido = null;
    const tx = await startTx(db);
    try {
      try {
        const r = await txQuery(tx, `INSERT INTO CONTASPAGAR (${COLS}) VALUES (${VALS}) RETURNING CODIGO`, params);
        modo = 'trigger';
        codigoGerado = extrairCodigo(r);
        console.log(`   ✓ INSERT sem CODIGO funcionou → trigger preenche (CODIGO=${codigoGerado})`);
      } catch (e1) {
        console.log(`   ✗ sem CODIGO falhou: ${e1.message.split('\n')[0]}`);
        if (!genUsar) throw new Error('sem trigger e sem generator — investigar');
        const r = await txQuery(tx, `INSERT INTO CONTASPAGAR (CODIGO, ${COLS}) VALUES (GEN_ID(${genUsar},1), ${VALS}) RETURNING CODIGO`, params);
        modo = 'generator';
        codigoGerado = extrairCodigo(r);
        console.log(`   ✓ INSERT com GEN_ID(${genUsar},1) funcionou (CODIGO=${codigoGerado})`);
        console.log('   (nota: esse GEN_ID avançou o contador 1, mesmo com rollback — buraco inofensivo)');
      }
      if (codigoGerado != null) {
        const back = await txQuery(tx, `SELECT VALOR FROM CONTASPAGAR WHERE CODIGO = ?`, [codigoGerado]);
        valorLido = back[0] ? Number(back[0].VALOR) : null;
      }
    } finally {
      await txRollback(tx);
      console.log('   ↩ ROLLBACK feito — nada persistido.');
    }

    const escalaOk = valorLido != null && Math.abs(valorLido - VALOR_TESTE) < 0.001;
    console.log('\n========== VEREDITO ==========');
    console.log(`Generator      : ${genUsar ?? '(não achado)'}${genExiste ? ' ✓' : ' ⚠ DIFERENTE'}`);
    console.log(`Modo de INSERT : ${modo === 'trigger' ? 'OMITIR CODIGO (trigger preenche)' : modo === 'generator' ? `CODIGO = GEN_ID(${genUsar},1)` : 'FALHOU'}`);
    console.log(`Escala VALOR   : ${VALOR_TESTE} → ${valorLido}  ${escalaOk ? '✓ OK (passar reais direto)' : '⚠ DIVERGENTE'}`);
    console.log('==============================');
    console.log(
      modo === 'generator' && genExiste && escalaOk
        ? '\n>>> AGENTE JÁ CORRETO. Pode ligar FOLHA_WRITEBACK_CONSUMER=true.'
        : '\n>>> Me cola o veredito que eu ajusto o criarContaPagar().',
    );
    db.detach();
  } catch (e) {
    console.error('\nERRO:', e.message);
    if (db) db.detach();
    process.exit(1);
  }
})();
