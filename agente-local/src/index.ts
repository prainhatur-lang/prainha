// Entrypoint do agente local. Roda em loop infinito, sincronizando
// PAGAMENTOS do Firebird local com a API /api/ingest na nuvem.

import { loadConfig } from './config';
import { Checkpoint } from './checkpoint';
import { buscarPagamentos } from './firebird';
import { enviarBatch } from './ingest';
import { log } from './logger';

async function ciclo(cfg: Awaited<ReturnType<typeof loadConfig>>, checkpoint: Checkpoint) {
  const cp = checkpoint.get();
  log.info('iniciando ciclo', { ultimoCodigo: cp.ultimoCodigo });

  let totalCiclo = 0;
  while (true) {
    const desde = checkpoint.get().ultimoCodigo;
    const pagamentos = await buscarPagamentos(cfg, desde, cfg.batchSize);
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
    // Senao, busca proximo lote sem esperar
  }
}

async function main() {
  const cfg = await loadConfig();
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
