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
import { Checkpoint, type EntidadeSync } from './checkpoint';
import {
  buscarPagamentos,
  buscarFornecedores,
  buscarCategoriasContas,
  buscarContasBancarias,
  buscarContasPagar,
  buscarClientes,
  buscarMovimentosContaCorrente,
  buscarProdutos,
  buscarPedidos,
  buscarPedidoItens,
} from './firebird';
import { enviarBatch, enviarFinanceiro, enviarPdv } from './ingest';
import { log } from './logger';
import { startAutoUpdate, __agentVersion } from './auto-update';

bootTrace('BOOT 2 - imports OK');

// node-firebird tem um bug conhecido com Firebird 4 onde o detach gera um
// callback async com 'pluginName' undefined, derrubando o processo.
//
// O tratamento ANTIGO era "ignorar e seguir" — mas isso deixava a Promise
// de buscarPagamentos pendurada pra sempre, travando o agente silenciosamente
// (log mostrava "node-firebird detach bug ignorado" e depois silencio eterno).
//
// Estrategia NOVA: log do erro e exit(1). O run.cmd tem loop de auto-restart
// em 5s, entao o agente volta limpo sem intervencao humana.
process.on('uncaughtException', (err: Error) => {
  if (err?.message?.includes('pluginName')) {
    log.warn('node-firebird pluginName bug — reiniciando processo em 1s', {
      msg: err.message,
    });
  } else {
    log.error('uncaughtException — reiniciando processo em 1s', {
      msg: err.message,
      stack: err.stack,
    });
  }
  // Pequeno delay pra garantir que o log foi flushed pro disco antes do exit
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (err: unknown) => {
  log.error('unhandledRejection — reiniciando processo em 1s', {
    err: (err as Error)?.message,
    stack: (err as Error)?.stack,
  });
  setTimeout(() => process.exit(1), 1000);
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

/** Ciclo financeiro — sincroniza Fornecedores, Categorias, Contas Bancarias
 *  e Contas a Pagar do Consumer. Faz de forma best-effort: se alguma tabela
 *  nao existir (erro Firebird), continua com as outras. */
async function cicloFinanceiro(
  cfg: ReturnType<typeof loadConfig>,
  checkpoint: Checkpoint,
): Promise<void> {
  const limite = cfg.batchSize;

  const entidades: Array<{
    nome: EntidadeSync;
    fetch: () => Promise<Array<{ codigoExterno: number }>>;
    key:
      | 'fornecedores'
      | 'categorias'
      | 'contasBancarias'
      | 'contasPagar'
      | 'clientes'
      | 'movimentosContaCorrente';
  }> = [
    {
      nome: 'fornecedores',
      key: 'fornecedores',
      fetch: () => buscarFornecedores(cfg, checkpoint.getUltimoCodigo('fornecedores'), limite),
    },
    {
      nome: 'categorias',
      key: 'categorias',
      fetch: () => buscarCategoriasContas(cfg, checkpoint.getUltimoCodigo('categorias'), limite),
    },
    {
      nome: 'contasBancarias',
      key: 'contasBancarias',
      fetch: () =>
        buscarContasBancarias(cfg, checkpoint.getUltimoCodigo('contasBancarias'), limite),
    },
    {
      nome: 'contasPagar',
      key: 'contasPagar',
      fetch: () => buscarContasPagar(cfg, checkpoint.getUltimoCodigo('contasPagar'), limite),
    },
    {
      nome: 'clientes',
      key: 'clientes',
      fetch: () => buscarClientes(cfg, checkpoint.getUltimoCodigo('clientes'), limite),
    },
    {
      nome: 'movimentosContaCorrente',
      key: 'movimentosContaCorrente',
      fetch: () =>
        buscarMovimentosContaCorrente(
          cfg,
          checkpoint.getUltimoCodigo('movimentosContaCorrente'),
          limite,
        ),
    },
  ];

  for (const ent of entidades) {
    try {
      // loop enquanto vier batch cheio
      for (;;) {
        const items = await ent.fetch();
        if (items.length === 0) break;
        const batch = { [ent.key]: items };
        await enviarFinanceiro(cfg, batch);
        const ultimoCodigo = items.reduce(
          (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
          checkpoint.getUltimoCodigo(ent.nome),
        );
        checkpoint.updateEntidade(ent.nome, ultimoCodigo, items.length);
        log.info('financeiro batch ok', {
          entidade: ent.nome,
          qtd: items.length,
          ultimo: ultimoCodigo,
        });
        if (items.length < limite) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      log.warn('financeiro falhou pra entidade, segue', {
        entidade: ent.nome,
        err: (e as Error).message,
      });
    }
  }
}

/** Ciclo PDV — Produtos, Pedidos, Itens de pedido. Best-effort. */
async function cicloPdv(
  cfg: ReturnType<typeof loadConfig>,
  checkpoint: Checkpoint,
): Promise<void> {
  const limite = cfg.batchSize;
  const entidades: Array<{
    nome: EntidadeSync;
    fetch: () => Promise<Array<{ codigoExterno: number }>>;
    key: 'produtos' | 'pedidos' | 'pedidoItens';
  }> = [
    {
      nome: 'produtos',
      key: 'produtos',
      fetch: () => buscarProdutos(cfg, checkpoint.getUltimoCodigo('produtos'), limite),
    },
    {
      nome: 'pedidos',
      key: 'pedidos',
      fetch: () => buscarPedidos(cfg, checkpoint.getUltimoCodigo('pedidos'), limite),
    },
    {
      nome: 'pedidoItens',
      key: 'pedidoItens',
      fetch: () => buscarPedidoItens(cfg, checkpoint.getUltimoCodigo('pedidoItens'), limite),
    },
  ];
  for (const ent of entidades) {
    try {
      for (;;) {
        const items = await ent.fetch();
        if (items.length === 0) break;
        const batch = { [ent.key]: items };
        await enviarPdv(cfg, batch);
        const ultimoCodigo = items.reduce(
          (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
          checkpoint.getUltimoCodigo(ent.nome),
        );
        checkpoint.updateEntidade(ent.nome, ultimoCodigo, items.length);
        log.info('pdv batch ok', {
          entidade: ent.nome,
          qtd: items.length,
          ultimo: ultimoCodigo,
        });
        if (items.length < limite) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      log.warn('pdv falhou pra entidade, segue', {
        entidade: ent.nome,
        err: (e as Error).message,
      });
    }
  }
}

/** Envolve uma Promise num timeout. Se estourar, rejeita com Error.
 *  Essencial porque node-firebird as vezes trava em estados de conexao ruim
 *  sem lancar erro nem resolver — a Promise fica pendurada pra sempre. */
function comTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms / 1000}s em ${label}`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

const CICLO_TIMEOUT_MS = 10 * 60 * 1000; // 10min — qualquer ciclo alem disso e travamento

async function main() {
  // Boot marker: confirma que o processo iniciou de verdade
  console.log(`[boot] concilia-agente v${__agentVersion} iniciando...`);
  const cfg = loadConfig();
  log.info('agente iniciado', {
    versao: __agentVersion,
    api: cfg.api.url,
    firebird: `${cfg.firebird.host}:${cfg.firebird.port}`,
    intervalo: `${cfg.intervalSeconds}s`,
  });

  startAutoUpdate();

  const checkpoint = new Checkpoint(cfg.checkpointFile);

  // Loop infinito
  for (;;) {
    try {
      await comTimeout(ciclo(cfg, checkpoint), CICLO_TIMEOUT_MS, 'ciclo pagamentos');
    } catch (e: unknown) {
      log.error('ciclo pagamentos falhou', { err: (e as Error).message });
      // Se timeout, reinicia — driver provavelmente travou
      if ((e as Error).message?.includes('timeout')) {
        log.error('ciclo travou — reiniciando processo');
        setTimeout(() => process.exit(1), 1000);
        return;
      }
    }
    // Ciclo financeiro (best effort, independente do pagamentos)
    try {
      await comTimeout(cicloFinanceiro(cfg, checkpoint), CICLO_TIMEOUT_MS, 'ciclo financeiro');
    } catch (e: unknown) {
      log.error('ciclo financeiro falhou', { err: (e as Error).message });
      if ((e as Error).message?.includes('timeout')) {
        log.error('ciclo financeiro travou — reiniciando processo');
        setTimeout(() => process.exit(1), 1000);
        return;
      }
    }
    // Ciclo PDV (produtos + pedidos + itens)
    try {
      await comTimeout(cicloPdv(cfg, checkpoint), CICLO_TIMEOUT_MS, 'ciclo pdv');
    } catch (e: unknown) {
      log.error('ciclo pdv falhou', { err: (e as Error).message });
      if ((e as Error).message?.includes('timeout')) {
        log.error('ciclo pdv travou — reiniciando processo');
        setTimeout(() => process.exit(1), 1000);
        return;
      }
    }
    // espera intervalo
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

main().catch((e: unknown) => {
  log.error('fatal', { err: (e as Error).message });
  process.exit(1);
});
