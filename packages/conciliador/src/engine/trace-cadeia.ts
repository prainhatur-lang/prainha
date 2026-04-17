// Trace ponta-a-ponta: PAGAMENTOS (Consumer) -> Vendas Cielo -> Recebiveis Cielo -> Banco
// Para cada pagamento do PDV, determina onde a cadeia quebra (se quebrar).

import type { EtapaConciliacao } from '@concilia/shared';
import type { LancamentoBancoInput, RecebivelInput } from './match-cielo-banco';
import type { CieloVenda, PdvPagamento } from './match-pdv-cielo';
import { matchCieloBanco } from './match-cielo-banco';

export interface TraceItem {
  pagamento: PdvPagamento;
  etapa: EtapaConciliacao;
  venda: CieloVenda | null;
  recebivel: RecebivelInput | null;
  pagouNoBanco: boolean;
}

export interface TraceResultado {
  items: TraceItem[];
  resumo: Record<EtapaConciliacao, { qtd: number; valor: number }>;
}

export function traceCadeia(opts: {
  pagamentos: PdvPagamento[];
  vendas: CieloVenda[];
  recebiveis: RecebivelInput[];
  lancamentosBanco: LancamentoBancoInput[];
}): TraceResultado {
  const { pagamentos, vendas, recebiveis, lancamentosBanco } = opts;

  const vendasByNsu = new Map(vendas.map((v) => [v.nsu, v]));
  const recByNsu = new Map(recebiveis.map((r) => [r.nsu, r]));

  const { nsusPagos } = matchCieloBanco(recebiveis, lancamentosBanco);

  const items: TraceItem[] = pagamentos.map((p) => {
    const nsu = p.nsu ?? '';
    const venda = vendasByNsu.get(nsu) ?? null;
    const recebivel = recByNsu.get(nsu) ?? null;
    const pagouNoBanco = nsusPagos.has(nsu);

    let etapa: EtapaConciliacao;
    if (!venda) etapa = 'NAO_NA_CIELO_VENDA';
    else if (!recebivel) etapa = 'SEM_AGENDA_RECEBIVEL';
    else if (!pagouNoBanco) etapa = 'NAO_PAGO_NO_BANCO';
    else etapa = 'COMPLETO';

    return { pagamento: p, etapa, venda, recebivel, pagouNoBanco };
  });

  const resumo: TraceResultado['resumo'] = {
    COMPLETO: { qtd: 0, valor: 0 },
    NAO_NA_CIELO_VENDA: { qtd: 0, valor: 0 },
    SEM_AGENDA_RECEBIVEL: { qtd: 0, valor: 0 },
    NAO_PAGO_NO_BANCO: { qtd: 0, valor: 0 },
    DIVERGENCIA_VALOR: { qtd: 0, valor: 0 },
  };
  for (const it of items) {
    resumo[it.etapa].qtd++;
    resumo[it.etapa].valor += it.pagamento.valor;
  }
  return { items, resumo };
}
