import { NextResponse } from 'next/server';

/** Versão atual disponível pra deploy. Deve casar com o arquivo
 *  `public/agente-release/agente-vX.Y.Z.cjs` correspondente. */
export const VERSAO_RELEASE = '1.0.1';

export async function GET() {
  return NextResponse.json({
    versao: VERSAO_RELEASE,
    bundleUrl: `/agente-release/agente-v${VERSAO_RELEASE}.cjs`,
    changelog: [
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
