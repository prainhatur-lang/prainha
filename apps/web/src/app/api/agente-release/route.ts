import { NextResponse } from 'next/server';

/** Versão atual disponível pra deploy. Deve casar com o arquivo
 *  `public/agente-release/agente-vX.Y.Z.cjs` correspondente. */
export const VERSAO_RELEASE = '1.4.0';

export async function GET() {
  return NextResponse.json({
    versao: VERSAO_RELEASE,
    bundleUrl: `/agente-release/agente-v${VERSAO_RELEASE}.cjs`,
    changelog: [
      'v1.4.0: Cadastro de cliente completo pela nuvem. atualizar_cliente agora aceita o cadastro inteiro (e-mail, telefone, celular, nascimento, endereço, cidade/UF/CEP, observação, limite de fiado e a trava BLOQUEARVENDAAPOSLIMITE) — antes só nome e CPF. Comando novo criar_cliente: INSERT em CONTATOS e devolve o CODIGO gerado pela trigger, pra nuvem não inventar código. Coluna que não existe na instalação é descartada em vez de derrubar o UPDATE inteiro. O sync de clientes também passou a trazer esses campos de volta.',
      'v1.3.0: lancar_bebida_reserva agora checa estoque (ESTOQUECONTROLADO/ESTOQUEATUAL em PRODUTODETALHE) antes de lançar — se não tiver quantidade suficiente, falha na hora com "sem estoque suficiente" em vez de vender o que não existe. E quando lança de verdade, grava ESTOQUEMOVIMENTACAO + baixa ESTOQUEATUAL, replicando exatamente o padrão de uma venda feita pelo garçom (conferido contra 3 vendas reais em produção) — antes disso, nenhum lançamento automático baixava estoque, porque essa baixa é feita pelo app do Consumer, não por trigger do banco.',
      'v1.2.0: lancar_bebida_reserva agora ABRE a mesa no Consumer se ela ainda não estiver aberta (CODIGOPEDIDOORIGEM=3, mesma origem já validada em prod pelo cardápio digital), em vez de só esperar o garçom abrir. A recepção já confirmou que o cliente chegou e sentou, então abrir a comanda nesse momento é o correto — não precisa mais esperar.',
      'v1.1.1: GET /api/agente/comandos agora é long-poll (servidor segura a resposta até 25s esperando comando novo, em vez de devolver vazio na hora) — junto com o loop de comandos separado do 1.1.0, um comando novo (ex: lançar bebida) chega no agente em ~1s em vez de até 15s.',
      'v1.1.0: Fila de comandos (lancar_bebida_reserva, baixar_fiado, etc.) agora roda num loop PRÓPRIO de 15s, separado do ciclo pesado de sincronização (que continua no intervalo normal de 15min). Antes, um comando só era processado no próximo ciclo grande — podia levar até 15min pra lançar uma bebida confirmada na recepção, tarde demais com o cliente já sentado.',
      'v1.0.9: Comando novo lancar_bebida_reserva — quando a recepção confirma no check-in que o cliente ainda quer a bebida pré-pedida na reserva do site, o agente lança o item direto na comanda aberta da mesa no Consumer (com job de impressão cozinha/bar), sem lançamento manual. Se a mesa ainda não abriu, reenfileira e tenta de novo por até 4h antes de desistir. Nunca cria comanda nova.',
      'v1.0.7: Comando novo pular_tabelas — marca registros de tabelas especificas como PROCESSADO=1 sem enviar pro servidor. Util pra pular backfill de PRODUTOS/PEDIDOS/ITENSPEDIDO/PAGAMENTOS que ja estao no concilia via cicloPdv antigo. Reduz fila de 1.4M pra ~150k em segundos. Payload: { tabelas: ["PRODUTOS","PEDIDOS",...] }.',
      'v1.0.6: Drenador timeout 10min→30min + MAX_ITER 50→200 (= 100k itens/ciclo). Backfill inicial de 1.4M itens em 0001 estava lento (250/min) porque ciclo era matado em 10min. Agora drena ate 100k/ciclo, ~5 ciclos pra esvaziar 0001 (~30min cada).',
      'v1.0.5: Drenador cap BATCH=min(cfg, 500) + timeout fetch 45s→90s. Config das filiais tava com batchSize=1000 (payload ~640KB) — endpoint timeout em 45s, ULTIMO_ERRO fez 39-45 retries falhando. Agora 500 max + 90s = endpoint serverless tem folga.',
      'v1.0.4: Fix CRITICO drenador — query() agora usa transaction explicita igual exec() do cdc.ts (db.query direto nao enxergava itens commitados por triggers de outra conexao em FB4). Tambem adicionado timeout 45s no POST /sync (sem isso, fetch travava 10min). Testado local: 285 itens processados em 14s.',
      'v1.0.0: CDC v2 — captura genérica via triggers no Firebird. Agente embute instalador CDC (comando instalar_cdc), drenador da fila CONCILIA_SYNC_QUEUE, auto-update via comando. Endpoint /api/concilia/sync recebe registros. Botoes no dashboard pra instalar/desinstalar/atualizar sem precisar mexer na maquina.',
      'v0.7.0: Fix CRITICO — ITENSPEDIDO.CODIGOPRODUTO eh sempre NULL no Consumer (PDV vende variantes/PRODUTODETALHE). buscarPedidoItens agora faz LEFT JOIN PRODUTODETALHE pra resolver CODIGOPRODUTO via PRODUTODETALHE.CODIGOPRODUTO. Sem isso, 300k pedido_item existentes ficavam com produto_id=NULL.',
      'v0.6.0: Outbox queue inicial — tabela CONCILIA_SYNC_QUEUE + 2 triggers (PRODUTOS + PRODUTODETALHE). Tolerante a tabela inexistente. cicloFilaSync drena no agente.',
      'v0.5.13: baixar_fiado corrige convencao CREDITO/DEBITO. Era DEBITO=valor (errado, soma divida) → agora CREDITO=valor (correto, pagamento abate divida). Também IMPORTADO=S (era N) pra Consumer incluir no calculo do saldo. Bug v0.5.10-12: linha de baixa aparecia no extrato mas saldo do cliente nao reduzia.',
      'v0.5.12: baixar_fiado agora atualiza tambem CONTATOS.SALDOATUALCONTACORRENTE=0 na MESMA transaction do INSERT em CONTACORRENTE. Sem isso, a UI do Consumer Rede continuava mostrando o cliente como devedor mesmo apos a baixa (Consumer mantem 2 fontes do saldo: extrato em CONTACORRENTE + cache em CONTATOS).',
      'v0.5.11: Fix CRITICO — INSERT/UPDATE no Firebird agora usam transaction com commit explicito. Sem isso, node-firebird descartava a operação no detach() (autocommit so funciona pra SELECT). Bug fez baixar_fiado v0.5.10 retornar sucesso mas nao persistir a baixa.',
      'v0.5.10: Comando baixar_fiado — agente lança baixa em CONTACORRENTE do Consumer (DEBITO=saldo, SALDOFINAL=0) pra zerar fiado do garçom apos compensar na folha. Botão "📤 Baixar fiados no Consumer" na tela da folha cria os comandos.',
      'v0.5.9: WRITE-BACK no Consumer Rede via fila de comandos. Permite editar nome/CPF do FORNECEDOR ou do CLIENTE pelo painel — agente pega na proxima rodada e faz UPDATE no Firebird. Util pra padronizar nome (ex: deixar igual ao do espelho de ponto) sem mexer no Consumer manualmente.',
      'v0.5.8: Cliente agora traz saldo do fiado (SALDOATUALCONTACORRENTE), limite de credito e flag arquivar_fiado. Vai permitir abater o fiado do garcom direto na comissao da folha automaticamente.',
      'v0.5.7: Cliente agora le da tabela CONTATOS (era CRMCLIENTE — que eh apenas analytics, sem cadastro). Resolve o bug que deixava nome/CPF/email/telefone NULL pra TODOS os 31k clientes da Prainha. Tambem usa colunas reais (CNPJOUCPF, FONEPRINCIPAL, FONECELULAR, FONERECADOS).',
      'v0.5.6: Refetch total de FORNECEDORES a cada ciclo — captura updates como CPF/CNPJ adicionado depois do cadastro, nome alterado, endereco corrigido. Mesmo padrao da v0.5.5 (cliente).',
      'v0.5.5: Refetch total de CRMCLIENTE a cada ciclo — captura updates como CPF adicionado depois do cadastro, nome corrigido, etc. Resolve bug do auto-vinculo cliente↔fornecedor na folha.',
      'v0.5.4: Refetch janela 14 dias — captura updates pos-criacao do PEDIDO (data_fechamento, valor_total, total_servico). Corrige snapshot velho que causava ~60% de subreporting do 10%.',
      'v0.5.4: Strip de BOM no config.json — evita crash com Set-Content -Encoding utf8 do PowerShell 5.',
    ],
    lancadaEm: '2026-05-07',
  });
}
