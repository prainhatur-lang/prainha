import { NextResponse } from 'next/server';

/** Versão atual disponível pra deploy. Deve casar com o arquivo
 *  `public/agente-release/agente-vX.Y.Z.cjs` correspondente. */
export const VERSAO_RELEASE = '0.5.6';

export async function GET() {
  return NextResponse.json({
    versao: VERSAO_RELEASE,
    bundleUrl: `/agente-release/agente-v${VERSAO_RELEASE}.cjs`,
    changelog: [
      'v0.5.6: Refetch total de FORNECEDORES a cada ciclo — captura updates como CPF/CNPJ adicionado depois do cadastro, nome alterado, endereco corrigido. Mesmo padrao da v0.5.5 (cliente).',
      'v0.5.5: Refetch total de CRMCLIENTE a cada ciclo — captura updates como CPF adicionado depois do cadastro, nome corrigido, etc. Resolve bug do auto-vinculo cliente↔fornecedor na folha.',
      'v0.5.4: Refetch janela 14 dias — captura updates pos-criacao do PEDIDO (data_fechamento, valor_total, total_servico). Corrige snapshot velho que causava ~60% de subreporting do 10%.',
      'v0.5.4: Strip de BOM no config.json — evita crash com Set-Content -Encoding utf8 do PowerShell 5.',
    ],
    lancadaEm: '2026-05-06',
  });
}
