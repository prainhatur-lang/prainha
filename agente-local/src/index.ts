// Entrypoint do agente local. Roda em loop infinito, sincronizando
// PAGAMENTOS do Firebird local com a API /api/ingest na nuvem.

// BOOT TRACE absoluto - escreve antes de qualquer outra coisa para garantir
// que pelo menos sabemos se o processo iniciou (debug NSSM/Service)
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function bootTrace(msg: string) {
  try {
    // Tenta caminho absoluto baseado no diretorio do script
    const dir = resolve(dirname(process.execPath), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      resolve(dir, 'boot-trace.log'),
      `${new Date().toISOString()} | cwd=${process.cwd()} | execPath=${process.execPath} | argv=${JSON.stringify(process.argv)} | ${msg}\n`,
    );
  } catch (e) {
    // Fallback: tenta C:\concilia-agente\logs
    try {
      mkdirSync('C:\\concilia-agente\\logs', { recursive: true });
      appendFileSync(
        'C:\\concilia-agente\\logs\\boot-trace.log',
        `${new Date().toISOString()} | FALLBACK | err=${(e as Error).message} | ${msg}\n`,
      );
    } catch {
      // Ignora se nem o fallback funcionar
    }
  }
}

bootTrace('BOOT 1 - antes de imports');

import { loadConfig } from './config';
import { Checkpoint } from './checkpoint';
import { buscarPagamentos } from './firebird';
import { enviarBatch } from './ingest';
import { log } from './logger';

bootTrace('BOOT 2 - imports OK');

// node-firebird tem um bug conhecido com Firebird 4 onde o detach gera um
// callback async com 'pluginName' undefined, derrubando o processo. Como o
// erro vem de um socket callback, nao da pra capturar com try/catch.
// Estrategia: capturar uncaughtException, logar e seguir.
process.on('uncaughtException', (err: Error) => {
  if (err?.message?.includes('pluginName')) {
    log.warn('node-firebird detach bug ignorado', { msg: err.message });
    return;
  }
  log.error('uncaughtException', { msg: err.message, stack: err.stack });
});

process.on('unhandledRejection', (err: unknown) => {
  log.error('unhandledRejection', { err: (err as Error)?.message });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ciclo(cfg: ReturnType<typeof loadConfig>, checkpoint: Checkpoint) {
  const cp = checkpoint.get();
  log.info('iniciando ciclo', { ultimoCodigo: cp.ultimoCodigo });

  let totalCiclo = 0;
  while (true) {
    const desde = checkpoint.get().ultimoCodigo;
    let pagamentos: Awaited<ReturnType<typeof buscarPagamentos>>;
    try {
      pagamentos = await buscarPagamentos(cfg, desde, cfg.batchSize);
    } catch (e: unknown) {
      log.warn('falha em buscarPagamentos, abortando ciclo', {
        err: (e as Error).message,
        desde,
      });
      return;
    }
    if (pagamentos.length === 0) {
      // envia heartbeat (batch vazio) so quando nada novo no primeiro fetch
      if (totalCiclo === 0) {
        await enviarBatch(cfg, []).catch((e: unknown) => {
          log.warn('heartbeat falhou', { err: (e as Error).message });
        });
      }
      log.info('nada novo', { totalCiclo });
      return;
    }

    log.info('enviando batch', { qtd: pagamentos.length, primeiro: pagamentos[0]?.codigoExterno });
    const resp = await enviarBatch(cfg, pagamentos);
    log.info('batch ok', resp);

    const novoUltimo = pagamentos.reduce(
      (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
      desde,
    );
    checkpoint.update(novoUltimo, pagamentos.length);
    totalCiclo += pagamentos.length;

    // Se veio menos que batchSize, acabou
    if (pagamentos.length < cfg.batchSize) {
      log.info('ciclo terminou', { totalCiclo, ultimoCodigo: novoUltimo });
      return;
    }
    // Delay minimo + setImmediate para isolar do detach buggy do node-firebird
    // (uncaughtException do detach anterior precisa do tick do event loop)
    await sleep(200);
    await new Promise((r) => setImmediate(r));
  }
}

async function main() {
  // Boot marker: confirma que o processo iniciou de verdade
  console.log('[boot] concilia-agente iniciando...');
  const cfg = loadConfig();
  log.info('agente iniciado', {
    api: cfg.api.url,
    firebird: `${cfg.firebird.host}:${cfg.firebird.port}`,
    intervalo: `${cfg.intervalSeconds}s`,
  });

  const checkpoint = new Checkpoint(cfg.checkpointFile);

  // Loop infinito
  for (;;) {
    try {
      await ciclo(cfg, checkpoint);
    } catch (e: unknown) {
      log.error('ciclo falhou', { err: (e as Error).message });
    }
    // espera intervalo
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

main().catch((e: unknown) => {
  log.error('fatal', { err: (e as Error).message });
  process.exit(1);
});
