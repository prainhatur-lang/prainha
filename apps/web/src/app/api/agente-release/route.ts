import { NextResponse } from 'next/server';

/** Versão atual disponível pra deploy. Deve casar com o arquivo
 *  `public/agente-release/agente-vX.Y.Z.cjs` correspondente. */
export const VERSAO_RELEASE = '0.5.10';

export async function GET() {
  return NextResponse.json({
    versao: VERSAO_RELEASE,
    bundleUrl: `/agente-release/agente-v${VERSAO_RELEASE}.cjs`,
    changelog: [
      'v0.5.10: Comando baixar_fiado — agente lança baixa em CONTACORRENTE do Consumer (DEBITO=saldo, SALDOFINAL=0) pra zerar fiado do garçom apos compensar na folha. Botão "📤 Baixar fiados no Consumer" na tela da folha cria os comandos.',
      'v0.5.9: WRITE-BACK no Consumer Rede via fila de comandos. Permite editar nome/CPF do FORNECEDOR ou do CLIENTE pelo painel — agente pega na proxima rodada e faz UPDATE no Firebird. Util pra padronizar nome (ex: deixar igual ao do espelho de ponto) sem mexer no Consumer manualmente.',
      'v0.5.8: Cliente agora traz saldo do fiado (SALDOATUALCONTACORRENTE), limite de credito e flag arquivar_fiado. Vai permitir abater o fiado do garcom direto na comissao da folha automaticamente.',
      'v0.5.7: Cliente agora le da tabela CONTATOS (era CRMCLIENTE — que eh apenas analytics, sem cadastro). Resolve o bug que deixava nome/CPF/email/telefone NULL pra TODOS os 31k clientes da Prainha. Tambem usa colunas reais (CNPJOUCPF, FONEPRINCIPAL, FONECELULAR, FONERECADOS).',
      'v0.5.6: Refetch total de FORNECEDORES a cada ciclo — captura updates como CPF/CNPJ adicionado depois do cadastro, nome alterado, endereco corrigido. Mesmo padrao da v0.5.5 (cliente).',
      'v0.5.5: Refetch total de CRMCLIENTE a cada ciclo — captura updates como CPF adicionado depois do cadastro, nome corrigido, etc. Resolve bug do auto-vinculo cliente↔fornecedor na folha.',
      'v0.5.4: Refetch janela 14 dias — captura updates pos-criacao do PEDIDO (data_fechamento, valor_total, total_servico). Corrige snapshot velho que causava ~60% de subreporting do 10%.',
      'v0.5.4: Strip de BOM no config.json — evita crash com Set-Content -Encoding utf8 do PowerShell 5.',
    ],
    lancadaEm: '2026-05-06',
  });
}
