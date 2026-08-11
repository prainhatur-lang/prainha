// DANFE NFC-e em "blocos" de impressão — o formato que a LIO já usa
// (Lio.Bloco: texto/negrito/tamanho/qr). A térmica 80mm do caixa recebe os
// mesmos blocos e o vendas-local converte pra ESC/POS (QR vira raster).
//
// largura: 32 colunas na LIO, 48 na térmica genérica.

import type { NfceItemSnapshot, NfcePagamentoSnapshot } from '@concilia/db/schema';
import { formatarDocumento } from './documento';

export interface DanfeBloco {
  texto?: string;
  negrito?: boolean;
  tamanho?: number;
  /** Conteúdo do QR (a impressora gera a imagem). */
  qr?: string;
}

export interface DadosDanfe {
  razaoSocial: string;
  nomeFantasia?: string | null;
  cnpj: string;
  ie: string;
  endereco: string;
  ambiente: number;
  serie: number;
  numero: number;
  chave: string;
  protocolo?: string | null;
  autorizadaEm?: string | null; // já formatado dd/mm/aaaa hh:mm:ss
  emitidaEm?: string | null;
  destDocumento?: string | null;
  itens: NfceItemSnapshot[];
  pagamentos: NfcePagamentoSnapshot[];
  valorDesconto: number;
  valorOutro: number;
  valorTotal: number;
  valorTroco?: number;
  qrcode?: string | null;
  urlChave?: string | null;
  mesa?: string | null;
  infoExtra?: string | null;
  /** Nota cancelada — imprime tarja (reimpressão de histórico). */
  cancelada?: boolean;
}

const brl = (n: number) =>
  'R$ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

const TPAG_NOME: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartao de Credito',
  '04': 'Cartao de Debito',
  '05': 'Credito Loja',
  '17': 'PIX',
  '20': 'PIX',
  '99': 'Outros',
};

/** esquerda + direita preenchendo até `w` colunas (quebra a esquerda se não couber). */
function lr(esq: string, dir: string, w: number): string {
  const e = esq.length + dir.length + 1 > w ? esq.slice(0, w - dir.length - 1) : esq;
  return e + ' '.repeat(Math.max(1, w - e.length - dir.length)) + dir;
}

/** Chave de acesso em grupos de 4 (2 linhas de 24 na LIO, 1 de 48+ na térmica). */
function chaveFormatada(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function montarDanfeBlocos(d: DadosDanfe, largura: number): DanfeBloco[] {
  const w = largura;
  const traco = '-'.repeat(w);
  const b: DanfeBloco[] = [];
  const linhas: string[] = [];

  // cabeçalho emitente
  b.push({ texto: `\n${d.nomeFantasia || d.razaoSocial}`, negrito: true, tamanho: 22 });
  b.push({
    texto:
      `${d.razaoSocial}\nCNPJ ${formatarDocumento(d.cnpj)}  IE ${d.ie}\n${d.endereco}`,
    tamanho: 18,
  });
  b.push({
    texto: `${traco}\nDANFE NFC-e - Documento Auxiliar\nda Nota Fiscal de Consumidor\nEletronica\n${traco}`,
    tamanho: 18,
  });

  if (d.ambiente === 2) {
    b.push({ texto: 'EMITIDA EM HOMOLOGACAO\nSEM VALOR FISCAL', negrito: true, tamanho: 20 });
  }
  if (d.cancelada) {
    b.push({ texto: '*** NFC-e CANCELADA ***', negrito: true, tamanho: 22 });
  }

  // itens
  linhas.length = 0;
  linhas.push(lr('ITEM', 'VALOR', w));
  for (const it of d.itens) {
    const qtd = it.quantidade === Math.round(it.quantidade)
      ? String(it.quantidade)
      : it.quantidade.toFixed(3).replace('.', ',');
    const un = (it.unidade || 'UN').trim();
    const nome = it.descricao.trim();
    const dir = brl(it.valorTotal);
    // nome (pode quebrar) + linha "qtd x unitário = total"
    if (nome.length + dir.length + 1 <= w) {
      linhas.push(lr(nome, dir, w));
    } else {
      linhas.push(nome.slice(0, w));
      linhas.push(lr(` ${nome.slice(w, w * 2 - dir.length - 2)}`, dir, w));
    }
    const unit = it.quantidade > 0 ? it.valorTotal / it.quantidade : 0;
    linhas.push(` ${qtd} ${un} x ${brl(unit)}`);
    if ((it.valorDesconto ?? 0) > 0.004) linhas.push(lr(' desconto', '-' + brl(it.valorDesconto!), w));
  }
  b.push({ texto: linhas.join('\n'), tamanho: 18 });

  // totais
  const tot: string[] = [traco];
  const qtdItens = d.itens.length;
  const subtotal = d.itens.reduce((s, i) => s + i.valorTotal, 0);
  tot.push(lr(`QTD. ITENS: ${qtdItens}`, '', w).trimEnd());
  tot.push(lr('Subtotal', brl(subtotal), w));
  if (d.valorDesconto > 0.004) tot.push(lr('Desconto', '-' + brl(d.valorDesconto), w));
  if (d.valorOutro > 0.004) tot.push(lr('Servico/Acrescimo', brl(d.valorOutro), w));
  b.push({ texto: tot.join('\n'), tamanho: 18 });
  b.push({ texto: lr('TOTAL', brl(d.valorTotal), Math.min(w, 24)), negrito: true, tamanho: 22 });

  // pagamentos
  const pag: string[] = [];
  pag.push(lr('FORMA PAGAMENTO', 'VALOR', w));
  for (const p of d.pagamentos) {
    pag.push(lr(TPAG_NOME[p.tPag] ?? 'Outros', brl(p.valor), w));
  }
  if ((d.valorTroco ?? 0) > 0.004) pag.push(lr('Troco', brl(d.valorTroco!), w));
  b.push({ texto: pag.join('\n') + `\n${traco}`, tamanho: 18 });

  // consumidor
  b.push({
    texto: d.destDocumento
      ? `CONSUMIDOR ${d.destDocumento.length === 14 ? 'CNPJ' : 'CPF'} ${formatarDocumento(d.destDocumento)}`
      : 'CONSUMIDOR NAO IDENTIFICADO',
    negrito: true,
    tamanho: 18,
  });

  // identificação da nota
  const ident: string[] = [traco];
  ident.push(`NFC-e n. ${d.numero}  Serie ${d.serie}`);
  if (d.emitidaEm) ident.push(`Emissao ${d.emitidaEm}`);
  if (d.mesa) ident.push(`${d.mesa}`);
  b.push({ texto: ident.join('\n'), tamanho: 18 });

  // consulta + chave
  b.push({
    texto:
      `Consulte pela Chave de Acesso em\n${d.urlChave || ''}\n` +
      chaveFormatada(d.chave),
    tamanho: 16,
  });

  // QR code
  if (d.qrcode) b.push({ qr: d.qrcode });
  // A base de consulta da SEFAZ-SE ingere a nota com horas de atraso — sem o
  // aviso, QR recem-impresso escaneado na hora parece "invalido" (104/234).
  if (d.qrcode && !d.cancelada) {
    b.push({ texto: 'QR disponivel p/ consulta no site\nem ate algumas horas (nota ja autorizada)', tamanho: 12 });
  }

  // protocolo
  if (d.protocolo) {
    b.push({
      texto:
        `Protocolo de autorizacao\n${d.protocolo}` +
        (d.autorizadaEm ? `\n${d.autorizadaEm}` : ''),
      tamanho: 16,
    });
  }

  if (d.infoExtra) b.push({ texto: d.infoExtra, tamanho: 16 });

  b.push({ texto: 'Tributos incidentes cf. Lei 12.741/2012\n\n\n\n\n', tamanho: 14 });

  return b;
}
