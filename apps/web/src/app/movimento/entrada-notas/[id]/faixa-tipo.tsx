// Faixa no topo da tela da nota, pra quem não é do fiscal: diz em palavras
// simples o que é esta compra (nota fiscal, pedido sem nota, serviço) e qual é
// o próximo passo. Só informa — os botões continuam onde sempre estiveram.

import { tipoCompra } from '@/lib/nota-tipo';

type Passo = { feito: boolean; texto: string; opcional?: boolean };

export function FaixaTipoNota(props: {
  origem: string | null;
  situacao: string | null;
  totalItens: number;
  mapeados: number;
  lancados: number;
  conferida: boolean;
  temFornecedor: boolean;
  emDobro: boolean;
  outraCasa: string | null;
  transferencia: boolean;
}) {
  const t = tipoCompra(props.origem);
  const explicacao =
    props.origem === 'PEDIDO_FOTO'
      ? 'Compra que veio sem nota fiscal: os itens foram lidos da foto do pedido. Confira com o papel antes de lançar. (Se o fornecedor mandou DANFE, é nota fiscal — ela chega sozinha da SEFAZ.)'
      : props.origem === 'NFSE_PDF'
        ? 'Nota de serviço (mão de obra, manutenção etc.): não mexe no estoque, só vira conta a pagar.'
        : props.origem === 'SEFAZ_DFE_RESUMO' || props.origem === 'SEFAZ_DFE_RESUMO_CIENTE'
          ? 'Nota fiscal que a SEFAZ avisou que existe, mas ainda sem a lista de itens.'
          : 'Nota fiscal eletrônica do fornecedor, com os itens e valores oficiais. Veio da SEFAZ ou do arquivo XML.';

  const cancelada = props.situacao === 'CANCELADA' || props.situacao === 'DENEGADA';
  const todos = props.totalItens > 0 && props.lancados >= props.totalItens;

  // Aviso único quando não há o que lançar aqui.
  let aviso: { texto: string; cls: string } | null = null;
  if (cancelada) aviso = { texto: '⛔ Nota cancelada pelo fornecedor — não lance no estoque nem pague.', cls: 'text-rose-800' };
  else if (props.outraCasa)
    aviso = { texto: `⚠ Esta nota é da ${props.outraCasa} — abra lá (aviso vermelho acima).`, cls: 'text-rose-800' };
  else if (props.transferencia)
    aviso = {
      texto: '↔ Nota de transferência entre casas — o estoque entra pelo recebimento da transferência, não por aqui.',
      cls: 'text-amber-800',
    };
  else if (props.emDobro)
    aviso = { texto: '⚠ Esta compra está duas vezes — use o botão "🔗 Juntar na NF-e" do aviso acima.', cls: 'text-amber-800' };
  else if (props.origem === 'SEFAZ_DFE_RESUMO')
    aviso = {
      texto: 'Próximo passo: na lista de notas, clique em dar ciência pra SEFAZ mandar os itens.',
      cls: 'text-amber-800',
    };
  else if (props.origem === 'SEFAZ_DFE_RESUMO_CIENTE')
    aviso = { texto: 'Esperando a SEFAZ mandar os itens. Volte mais tarde.', cls: 'text-violet-800' };
  else if (props.origem === 'NFSE_PDF')
    aviso = { texto: 'Nada a lançar no estoque. Confira as parcelas no contas a pagar.', cls: 'text-indigo-800' };
  else if (props.totalItens === 0) aviso = { texto: 'Esta nota não tem itens.', cls: 'text-slate-600' };
  else if (todos)
    aviso = { texto: '✓ Pronto: tudo já está no estoque. Não precisa fazer mais nada aqui.', cls: 'text-emerald-800' };

  const passos: Passo[] = [
    {
      feito: props.mapeados >= props.totalItens,
      texto: `Ligar cada item a um insumo (${props.mapeados} de ${props.totalItens}) — o "⚡ Match automático" ajuda`,
    },
    { feito: props.conferida, texto: 'Conferir o que chegou ("📦 Conferir entrega")', opcional: true },
    {
      feito: todos,
      texto:
        props.lancados > 0
          ? `Clicar em "✓ Lançar no estoque" — falta lançar ${props.totalItens - props.lancados} de ${props.totalItens}`
          : 'Clicar em "✓ Lançar no estoque" (as contas a pagar saem junto)',
    },
  ];
  const proximo = passos.findIndex((p) => !p.feito && !p.opcional);

  return (
    <div className={`mt-3 rounded-xl border p-4 ${t.cls}`}>
      <p className="text-sm font-semibold">
        {t.icone} {t.texto}
      </p>
      <p className="mt-0.5 text-xs opacity-90">{explicacao}</p>
      {aviso ? (
        <p className={`mt-2 text-sm font-medium ${aviso.cls}`}>{aviso.texto}</p>
      ) : (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">O que fazer</p>
          <ol className="mt-1 space-y-0.5 text-sm">
            {passos.map((p, i) => (
              <li
                key={i}
                className={
                  p.feito ? 'text-emerald-800' : i === proximo ? 'font-semibold text-slate-900' : 'text-slate-600'
                }
              >
                {p.feito ? '✓' : i === proximo ? '→' : '○'} {i + 1}. {p.texto}
                {p.opcional && !p.feito ? ' (recomendado)' : ''}
              </li>
            ))}
          </ol>
          {!props.temFornecedor && (
            <p className="mt-1 text-xs text-amber-800">
              Sem fornecedor vinculado, o estoque entra mas a conta a pagar não — vincule no aviso abaixo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
