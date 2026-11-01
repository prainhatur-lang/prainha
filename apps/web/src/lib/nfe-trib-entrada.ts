// Tributação de entrada de um item de nota de compra (01/11/2026), no formato
// das colunas de nota_compra_item. A Lelis monta a tributação da venda a partir
// disso (lib/lelis/tributacao.ts). Nota antiga fica com tudo null.
import type { NfeItemParseado } from './nfe-parser';

const num = (v: number | null | undefined) => (v != null ? String(v) : null);
const txt = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : null);

export function colunasTribEntrada(it: NfeItemParseado) {
  return {
    origemMerc: txt(it.origem, 1),
    cstIcms: txt(it.cstIcms, 4),
    valorBcSt: num(it.valorBcSt),
    valorIcmsSt: num(it.valorIcmsSt),
    valorIcmsStRet: num(it.valorIcmsStRet),
    cstPis: txt(it.cstPis, 2),
    cstCofins: txt(it.cstCofins, 2),
  };
}
