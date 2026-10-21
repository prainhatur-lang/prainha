// Tipo da compra em palavras simples, a partir de nota_compra.origem_importacao.
// Usado na lista de notas de entrada e no topo da tela da nota.

export function tipoCompra(origem: string | null): { icone: string; texto: string; dica: string; cls: string } {
  if (origem === 'PEDIDO_FOTO')
    return {
      icone: '📸',
      texto: 'Pedido sem nota',
      dica: 'Compra sem nota fiscal: entrou pela foto do pedido/romaneio do fornecedor',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    };
  if (origem === 'NFSE_PDF')
    return {
      icone: '🛠',
      texto: 'Nota de serviço',
      dica: 'Nota de serviço (NFS-e): só vira conta a pagar, não mexe no estoque',
      cls: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    };
  return {
    icone: '🧾',
    texto: 'Nota fiscal',
    dica: 'Nota fiscal eletrônica (NF-e) registrada na SEFAZ',
    cls: 'border-sky-200 bg-sky-50 text-sky-800',
  };
}
