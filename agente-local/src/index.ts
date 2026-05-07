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
  buscarPedidosJanela,
  buscarPedidoItensJanela,
  buscarClientesJanela,
  buscarFornecedoresJanela,
  executarUpdate,
} from './firebird';
import {
  enviarBatch,
  enviarFinanceiro,
  enviarPdv,
  buscarComandosPendentes,
  reportarComando,
} from './ingest';
import { log } from './logger';

bootTrace('BOOT 2 - imports OK');

// Versao do agente — bater junto com package.json. Aparece no boot log
// (`agente iniciado` + `[boot] concilia-agente vX.Y.Z`) pra facilitar a
// verificacao em campo (basta abrir logs\agente.log e olhar a 1a linha).
const AGENTE_VERSAO = '0.5.9';

// node-firebird tem um bug com Firebird 4 onde o detach gera callback async
// com 'pluginName' undefined. Isso e POS-CICLO — a query ja completou, o
// erro vem so na hora de fechar a conexao. Logo, ignorar eh seguro.
//
// Pra detectar travamento REAL (driver nao respondendo), o ciclo principal
// usa comTimeout(10min). Se estourar, mata o processo (run.cmd reinicia).
//
// Erros nao-pluginName fora do contexto de ciclo (raros) tambem matam.
process.on('uncaughtException', (err: Error) => {
  if (err?.message?.includes('pluginName')) {
    log.warn('node-firebird pluginName bug ignorado (apos ciclo)', {
      msg: err.message,
    });
    return;
  }
  log.error('uncaughtException — reiniciando processo em 1s', {
    msg: err.message,
    stack: err.stack,
  });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (err: unknown) => {
  const msg = (err as Error)?.message ?? String(err);
  if (msg.includes('pluginName')) {
    log.warn('node-firebird pluginName bug ignorado (rejection)', { msg });
    return;
  }
  log.error('unhandledRejection — reiniciando processo em 1s', {
    err: msg,
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

/** Re-busca PEDIDOS e ITENSPEDIDO abertos nos ultimos N dias e UPSERT.
 *  O cursor por CODIGO captura pedidos novos uma unica vez, mas Consumer
 *  atualiza VALOR_TOTAL/DATAFECHAMENTO/TOTALSERVICO depois (mesa fica aberta
 *  e o cliente vai consumindo). Esse loop garante que o snapshot do banco
 *  fique sempre fresco pro fechamento da semana — paga o custo de re-fetchar
 *  ~200 pedidos por ciclo, sem alterar o checkpoint. */
async function cicloPdvRefetch(
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  const dias = cfg.refetchJanelaDias;
  if (dias <= 0) return;
  const limite = cfg.batchSize;
  log.info('iniciando refetch janela', { dias });

  // Pedidos da janela
  try {
    let desde = 0;
    let totalPedidos = 0;
    for (;;) {
      const items = await buscarPedidosJanela(cfg, dias, desde, limite);
      if (items.length === 0) break;
      await enviarPdv(cfg, { pedidos: items });
      desde = items.reduce(
        (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
        desde,
      );
      totalPedidos += items.length;
      log.info('refetch pedidos batch', { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info('refetch pedidos ok', { dias, total: totalPedidos });
  } catch (e) {
    log.warn('refetch pedidos falhou', { err: (e as Error).message });
  }

  // Itens da janela
  try {
    let desde = 0;
    let totalItens = 0;
    for (;;) {
      const items = await buscarPedidoItensJanela(cfg, dias, desde, limite);
      if (items.length === 0) break;
      await enviarPdv(cfg, { pedidoItens: items });
      desde = items.reduce(
        (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
        desde,
      );
      totalItens += items.length;
      log.info('refetch itens batch', { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info('refetch itens ok', { dias, total: totalItens });
  } catch (e) {
    log.warn('refetch itens falhou', { err: (e as Error).message });
  }

  // Clientes — refetch TOTAL (sem janela) pra capturar updates como
  // CPF adicionado depois do cadastro, nome corrigido, etc. CRMCLIENTE
  // costuma ser pequeno (centenas) e o cursor incremental por CODIGO
  // perdia atualizacoes em registros existentes.
  try {
    let desde = 0;
    let totalClientes = 0;
    for (;;) {
      const items = await buscarClientesJanela(cfg, desde, limite);
      if (items.length === 0) break;
      await enviarFinanceiro(cfg, { clientes: items });
      desde = items.reduce(
        (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
        desde,
      );
      totalClientes += items.length;
      log.info('refetch clientes batch', { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info('refetch clientes ok', { total: totalClientes });
  } catch (e) {
    log.warn('refetch clientes falhou', { err: (e as Error).message });
  }

  // Fornecedores — mesmo padrao do cliente. CPF/CNPJ adicionados depois
  // do cadastro, nome alterado, etc. precisam voltar pro banco. Tabela
  // FORNECEDORES costuma ter centenas a poucos milhares de linhas.
  try {
    let desde = 0;
    let totalFornecedores = 0;
    for (;;) {
      const items = await buscarFornecedoresJanela(cfg, desde, limite);
      if (items.length === 0) break;
      await enviarFinanceiro(cfg, { fornecedores: items });
      desde = items.reduce(
        (m, p) => (p.codigoExterno > m ? p.codigoExterno : m),
        desde,
      );
      totalFornecedores += items.length;
      log.info('refetch fornecedores batch', { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info('refetch fornecedores ok', { total: totalFornecedores });
  } catch (e) {
    log.warn('refetch fornecedores falhou', { err: (e as Error).message });
  }
}

/** Processa comandos pendentes do servidor (write-back no Firebird).
 *  Tipos suportados:
 *  - 'atualizar_fornecedor': UPDATE FORNECEDORES SET ... WHERE CODIGO = ?
 *  - 'atualizar_cliente':    UPDATE CONTATOS SET ... WHERE CODIGO = ?
 *
 *  Mapeia chaves do JSON pra colunas do Firebird:
 *    nome -> NOME
 *    cnpjOuCpf -> CNPJOUCPF (FORNECEDORES tem essa coluna; CONTATOS tambem) */
async function cicloComandos(
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  let comandos: Awaited<ReturnType<typeof buscarComandosPendentes>>;
  try {
    comandos = await buscarComandosPendentes(cfg);
  } catch (e) {
    log.warn('falha buscando comandos', { err: (e as Error).message });
    return;
  }
  if (comandos.length === 0) return;
  log.info('processando comandos', { qtd: comandos.length });

  const COL_MAP: Record<string, string> = {
    nome: 'NOME',
    cnpjOuCpf: 'CNPJOUCPF',
  };

  for (const cmd of comandos) {
    try {
      await reportarComando(cfg, cmd.id, 'executando');

      const tabela =
        cmd.tipo === 'atualizar_fornecedor'
          ? 'FORNECEDORES'
          : cmd.tipo === 'atualizar_cliente'
            ? 'CONTATOS'
            : null;
      if (!tabela) {
        await reportarComando(cfg, cmd.id, 'erro', { msg: `tipo ${cmd.tipo} desconhecido` });
        continue;
      }

      const camposFB: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(cmd.payload.campos ?? {})) {
        const col = COL_MAP[k];
        if (col) camposFB[col] = v;
      }
      if (Object.keys(camposFB).length === 0) {
        await reportarComando(cfg, cmd.id, 'erro', { msg: 'sem campos validos' });
        continue;
      }

      const r = await executarUpdate(cfg, tabela, camposFB, cmd.payload.codigoExterno);
      await reportarComando(cfg, cmd.id, 'sucesso', {
        afetados: r.afetados,
        tabela,
        codigo: cmd.payload.codigoExterno,
        campos: camposFB,
      });
      log.info('comando ok', { id: cmd.id, tipo: cmd.tipo });
    } catch (e) {
      log.warn('comando falhou', { id: cmd.id, err: (e as Error).message });
      try {
        await reportarComando(cfg, cmd.id, 'erro', { msg: (e as Error).message });
      } catch {}
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
  console.log(`[boot] concilia-agente v${AGENTE_VERSAO} iniciando...`);
  const cfg = loadConfig();
  log.info('agente iniciado', {
    versao: AGENTE_VERSAO,
    api: cfg.api.url,
    firebird: `${cfg.firebird.host}:${cfg.firebird.port}`,
    intervalo: `${cfg.intervalSeconds}s`,
  });

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
    // Comandos do servidor (write-back) — executa antes do refetch pra
    // alterações apareçam no banco do concilia ja na proxima sincronizacao
    try {
      await comTimeout(cicloComandos(cfg), CICLO_TIMEOUT_MS, 'ciclo comandos');
    } catch (e: unknown) {
      log.error('ciclo comandos falhou', { err: (e as Error).message });
      if ((e as Error).message?.includes('timeout')) {
        log.error('ciclo comandos travou — reiniciando processo');
        setTimeout(() => process.exit(1), 1000);
        return;
      }
    }
    // Refetch PDV — pedidos/itens da ultima semana sao re-buscados e UPSERT.
    // Garante que data_fechamento/valor_total/total_servico fiquem frescos
    // mesmo apos snapshot inicial baixo.
    try {
      await comTimeout(cicloPdvRefetch(cfg), CICLO_TIMEOUT_MS, 'ciclo pdv refetch');
    } catch (e: unknown) {
      log.error('ciclo pdv refetch falhou', { err: (e as Error).message });
      if ((e as Error).message?.includes('timeout')) {
        log.error('ciclo pdv refetch travou — reiniciando processo');
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
