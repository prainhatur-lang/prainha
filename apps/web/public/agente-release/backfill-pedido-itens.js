// Backfill standalone de pedido_item -> codigo_produto_externo.
//
// Roda na MAQUINA DA FILIAL (precisa do Firebird local).
// Le do FB com o JOIN PRODUTODETALHE (igual o agente v0.7.0+),
// envia pra /api/ingest/pdv em batches, com checkpoint proprio que
// permite parar e retomar.
//
// USO:
//   1. Baixe o arquivo:
//      Invoke-WebRequest "https://app.prainhabar.com/agente-release/backfill-pedido-itens.js" -OutFile C:\concilia-agente\backfill-pedido-itens.js -UseBasicParsing
//
//   2. (Pre-requisito) Garanta que existe node-firebird em
//      C:\concilia-agente\diag-modules\package\lib (instrucao no README).
//
//   3. Rode no terminal (SEM parar o agente — convive em paralelo):
//      cd C:\concilia-agente
//      .\node backfill-pedido-itens.js
//
//   4. Pode interromper a qualquer momento com Ctrl+C — o checkpoint
//      esta em C:\concilia-agente\backfill-itens-checkpoint.json e
//      retoma do ponto exato na proxima execucao.
//
//   5. Pra refazer do zero (raro): delete o checkpoint.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'C:\\concilia-agente';
const FB_LIB = path.join(ROOT, 'diag-modules', 'package', 'lib');
const CONFIG = path.join(ROOT, 'config.json');
const CHECKPOINT = path.join(ROOT, 'backfill-itens-checkpoint.json');

if (!fs.existsSync(FB_LIB)) {
  console.error('node-firebird nao encontrado em:', FB_LIB);
  console.error('Instale-o primeiro (ver README).');
  process.exit(1);
}
if (!fs.existsSync(CONFIG)) {
  console.error('config.json nao encontrado em:', CONFIG);
  process.exit(1);
}

const fb = require(FB_LIB);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

const BATCH = 200;       // tamanho do batch que o FB busca + manda ao servidor
const PAUSA_MS = 100;    // pausa entre batches
const MAX_RETRIES = 3;
const LOG_EVERY = 1000;

// ---------- helpers ----------

function lerCheckpoint() {
  if (!fs.existsSync(CHECKPOINT)) return { ultimoCodigo: 0, totalEnviado: 0 };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
  } catch (e) {
    console.warn('[warn] checkpoint corrompido, recomecando do 0:', e.message);
    return { ultimoCodigo: 0, totalEnviado: 0 };
  }
}

function salvarCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2), 'utf8');
}

function toIso(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

// query do agente v0.7.0+ — JOIN com PRODUTODETALHE pra resolver CODIGOPRODUTO
const SQL = `
  SELECT FIRST ? i.CODIGO, i.CODIGOPEDIDO,
         COALESCE(i.CODIGOPRODUTO, pd.CODIGOPRODUTO) AS CODIGOPRODUTO,
         i.NOMEPRODUTO,
         i.QUANTIDADE, i.VALORUNITARIO, i.PRECOCUSTO,
         i.VALORITEM, i.VALORCOMPLEMENTO, i.VALORFILHO,
         i.VALORDESCONTO, i.VALORGORJETA, i.VALORTOTAL,
         i.CODIGOPAI, i.CODIGOITEMPEDIDOTIPO, i.CODIGOPAGAMENTO,
         i.CODIGOCOLABORADOR, i.DATAHORACADASTRO, i.DATADELETE,
         i.DETALHES, i.VERSAOREG
  FROM ITENSPEDIDO i
  LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO = i.CODIGOPRODUTODETALHE
  WHERE i.CODIGO > ?
  ORDER BY i.CODIGO
`;

function buscarBatch(desde) {
  return new Promise((resolve, reject) => {
    fb.attach(cfg.firebird, (e, db) => {
      if (e) return reject(e);
      db.query(SQL, [BATCH, desde], (e2, rows) => {
        if (e2) {
          try { db.detach(() => {}); } catch {}
          return reject(e2);
        }
        const out = rows.map((r) => ({
          codigoExterno: r.CODIGO,
          codigoPedidoExterno: r.CODIGOPEDIDO,
          codigoProdutoExterno: toNum(r.CODIGOPRODUTO),
          nomeProduto: toStr(r.NOMEPRODUTO),
          quantidade: toNum(r.QUANTIDADE),
          valorUnitario: toNum(r.VALORUNITARIO),
          precoCusto: toNum(r.PRECOCUSTO),
          valorItem: toNum(r.VALORITEM),
          valorComplemento: toNum(r.VALORCOMPLEMENTO),
          valorFilho: toNum(r.VALORFILHO),
          valorDesconto: toNum(r.VALORDESCONTO),
          valorGorjeta: toNum(r.VALORGORJETA),
          valorTotal: toNum(r.VALORTOTAL),
          codigoPai: toNum(r.CODIGOPAI),
          codigoItemPedidoTipo: toNum(r.CODIGOITEMPEDIDOTIPO),
          codigoPagamento: toNum(r.CODIGOPAGAMENTO),
          codigoColaborador: toNum(r.CODIGOCOLABORADOR),
          dataHoraCadastro: toIso(r.DATAHORACADASTRO),
          dataDelete: toIso(r.DATADELETE),
          detalhes: toStr(r.DETALHES),
          versaoReg: toNum(r.VERSAOREG),
        }));
        // resolve ANTES do detach (bug pluginName do FB4)
        resolve(out);
        try { db.detach(() => {}); } catch {}
      });
    });
  });
}

async function enviarBatch(pedidoItens) {
  const url = cfg.api.url.replace(/\/$/, '') + '/api/ingest/pdv';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.api.token,
    },
    body: JSON.stringify({ pedidoItens }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + ' - ' + txt.slice(0, 300));
  }
  return r.json();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- loop principal ----------

(async () => {
  const cp = lerCheckpoint();
  console.log('=== Backfill pedido_item ===');
  console.log('FB:    ' + cfg.firebird.host + ':' + cfg.firebird.port);
  console.log('API:   ' + cfg.api.url);
  console.log('Inicio em CODIGO > ' + cp.ultimoCodigo +
    ' (ja enviados nesse run anterior: ' + cp.totalEnviado + ')');
  console.log('Press Ctrl+C pra interromper. Retoma do ponto exato na proxima execucao.\n');

  const t0 = Date.now();
  let totalRun = 0;
  let proximoLog = LOG_EVERY;

  while (true) {
    let batch;
    let lastErr;
    for (let tent = 1; tent <= MAX_RETRIES; tent++) {
      try {
        batch = await buscarBatch(cp.ultimoCodigo);
        break;
      } catch (e) {
        lastErr = e;
        console.warn('[warn] buscarBatch tent ' + tent + '/' + MAX_RETRIES +
          ' falhou: ' + e.message);
        if (tent < MAX_RETRIES) await sleep(2000 * tent);
      }
    }
    if (!batch) {
      console.error('FALHA: nao consegui buscar batch em ' + MAX_RETRIES +
        ' tentativas. Ultimo erro: ' + lastErr.message);
      process.exit(1);
    }

    if (batch.length === 0) {
      console.log('\n=== Concluido ===');
      console.log('Total enviado nessa execucao: ' + totalRun);
      console.log('Tempo: ' + Math.round((Date.now() - t0) / 1000) + 's');
      console.log('Ultimo CODIGO processado: ' + cp.ultimoCodigo);
      process.exit(0);
    }

    let lastErrEnvio;
    let enviou = false;
    for (let tent = 1; tent <= MAX_RETRIES; tent++) {
      try {
        await enviarBatch(batch);
        enviou = true;
        break;
      } catch (e) {
        lastErrEnvio = e;
        console.warn('[warn] enviarBatch tent ' + tent + '/' + MAX_RETRIES +
          ' falhou: ' + e.message);
        if (tent < MAX_RETRIES) await sleep(3000 * tent);
      }
    }
    if (!enviou) {
      console.error('FALHA enviarBatch apos retries. Ultimo erro: ' + lastErrEnvio.message);
      console.error('Checkpoint preservado em ' + cp.ultimoCodigo + '. Reinicie pra retomar.');
      process.exit(1);
    }

    const maior = batch[batch.length - 1].codigoExterno;
    cp.ultimoCodigo = maior;
    cp.totalEnviado += batch.length;
    totalRun += batch.length;
    salvarCheckpoint(cp);

    if (totalRun >= proximoLog) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const rate = totalRun / Math.max(1, elapsed);
      console.log('[' + new Date().toISOString().slice(11, 19) + '] ' +
        totalRun + ' items enviados — ultimo CODIGO ' + maior +
        ' — ' + rate.toFixed(1) + ' items/s');
      proximoLog += LOG_EVERY;
    }

    await sleep(PAUSA_MS);
  }
})();
