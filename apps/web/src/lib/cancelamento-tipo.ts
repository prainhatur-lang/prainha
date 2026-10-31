// ESTORNO × CANCELAMENTO de item (pedido do dono, 12/10/2026).
//
// No Prainha Bar a mesa pede o isopor com 6, 8 cervejas e devolve as que não
// abriu. A loja grava isso na mesma tabela do cancelamento (cancelamento_item),
// quase sempre com o motivo "Cliente desistiu / mudou o pedido" — o motivo
// "Devolução", que pede foto, não é usado. Isso não é cancelamento: nada foi
// perdido, a garrafa voltou fechada pro bar.
//
//   ESTORNO      = bebida fechada que foi pra mesa e voltou (não consumiu).
//   CANCELAMENTO = todo o resto: prato recusado, lançamento errado, falta,
//                  demora, desistência antes de sair, pedido inteiro.
//
// A loja ainda não marca qual é qual, então a regra aqui é pelo que ela manda:
//   1. motivo "Devolução…" ou "Estorno…" → estorno, sempre;
//   2. motivo "Cliente desistiu…" + item que já tinha saído (pronto/entregue)
//      + praça de bebida fechada (BAR, Destilados) → estorno.
// Drink feito (praça DRINKS) e prato não entram: produzido e devolvido é perda.

export interface ItemCancelado {
  motivo: string | null;
  statusItem: string | null;
  /** nome da praça de produção (area_producao.nome) */
  praca: string | null | undefined;
}

/** O item já tinha saído (pronto, entregue…) quando foi tirado da conta. */
export function jaSaiu(statusItem: string | null | undefined): boolean {
  return !!statusItem && statusItem !== 'a_produzir' && statusItem !== 'pedido' && statusItem !== 'servico';
}

// SERVIÇO NÃO SE PRODUZ (dono, 31/10/2026). Couvert, taxa do Lounge e Espaço
// Kids entram na conta JÁ BAIXADOS na loja (pra sumir do KDS), e o cancelamento
// gravava "entregue" → "JÁ PRODUZIDO" no balanço. A loja passa a gravar
// 'servico'; os cancelamentos antigos são reconhecidos pelo nome.
// Mesma lista da loja (ITENS_FORA_KDS_PADRAO + Espaço Kids no vendas-local).
const NOMES_SERVICO = /couvert|lounge taxa|taxa lounge|espa[cç]o kids/i;

export function itemDeServico(nome: string | null | undefined): boolean {
  return NOMES_SERVICO.test(nome ?? '');
}

/** Status do item cancelado pra mostrar: serviço já baixado vira 'servico'. */
export function statusDoCancelado(statusItem: string | null | undefined, nome: string | null | undefined): string | null {
  if (!statusItem) return null;
  if (statusItem !== 'a_produzir' && statusItem !== 'pedido' && itemDeServico(nome)) return 'servico';
  return statusItem;
}

/** Praça que só entrega bebida fechada (garrafa, lata) — o que volta pro estoque. */
export function pracaDeBebidaFechada(nome: string | null | undefined): boolean {
  return /^(bar|destilados)$/i.test((nome ?? '').trim());
}

export function ehEstornoDeItem(c: ItemCancelado): boolean {
  const motivo = (c.motivo ?? '').trim();
  if (/^(devolu|estorno)/i.test(motivo)) return true;
  if (c.statusItem === 'pedido') return false;
  return /^cliente desistiu/i.test(motivo) && jaSaiu(c.statusItem) && pracaDeBebidaFechada(c.praca);
}
