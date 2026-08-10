// Testes do matcher Agenda Cielo × Extrato bancário.
// O cenário do Pix 1:1 vem de um caso real (Prainha, 01/08/2026): a Cielo
// previu R$ 2.736,52 de Pix no dia e o extrato tinha R$ 2.629,58 — faltavam
// R$ 106,94. Com subset-sum agrupado os 20 Pix do dia caíam juntos como
// "não pago"; casando um a um sobra só o que faltou de verdade.

import { describe, expect, it } from 'vitest';
import { matchCieloBanco, type LancamentoBancoInput, type RecebivelInput } from './match-cielo-banco';

const pix = (nsu: string, valor: number, dia = '01/08/2026'): RecebivelInput => ({
  id: `r-${nsu}`,
  nsu,
  dataPagamento: dia,
  formaPagamento: 'Pix',
  valorLiquido: valor,
});
const cartao = (nsu: string, valor: number, dia = '01/08/2026'): RecebivelInput => ({
  id: `r-${nsu}`,
  nsu,
  dataPagamento: dia,
  formaPagamento: 'Crédito à vista',
  valorLiquido: valor,
});
const credito = (valor: number, dia = '01/08/2026', descricao = 'Pix recebido - PIX RECEBIDO - Cp :01027058'): LancamentoBancoInput => ({
  id: `c-${valor}-${dia}`,
  dataMovimento: dia,
  tipo: 'C',
  valor,
  descricao,
  idTransacao: '',
});

describe('Pix casa 1:1, não em bloco', () => {
  it('paga os Pix que têm crédito e deixa só o que faltou', () => {
    const r = matchCieloBanco(
      [pix('1', 258.73), pix('2', 249.97), pix('3', 106.94)],
      [credito(258.73), credito(249.97)], // o de 106,94 não caiu
    );
    expect(r.nsusPagos.has('1')).toBe(true);
    expect(r.nsusPagos.has('2')).toBe(true);
    expect(r.nsusPagos.has('3')).toBe(false);
    // o que sobra é a diferença real, não o dia inteiro
    const pendente = r.gruposSemMatch.reduce((s, g) => s + g.valorTotal, 0);
    expect(pendente).toBeCloseTo(106.94, 2);
  });

  it('dois Pix de mesmo valor consomem dois créditos distintos', () => {
    const r = matchCieloBanco(
      [pix('1', 100), pix('2', 100)],
      [credito(100), { ...credito(100), id: 'c-100-b' }],
    );
    expect(r.nsusPagos.size).toBe(2);
    expect(r.creditosSobrando).toHaveLength(0);
  });

  it('não rouba o crédito que pertence ao grupo de cartão', () => {
    // cartão vem consolidado num crédito só; o Pix não pode consumi-lo
    const r = matchCieloBanco(
      [pix('p1', 50), cartao('c1', 300), cartao('c2', 200)],
      [credito(50), credito(500, '01/08/2026', 'Pix recebido - PIX RECEBIDO - Cp :00000000-CIELO S.A')],
    );
    expect(r.nsusPagos.has('p1')).toBe(true);
    expect(r.nsusPagos.has('c1')).toBe(true);
    expect(r.nsusPagos.has('c2')).toBe(true);
    expect(r.gruposSemMatch).toHaveLength(0);
  });

  it('acha o crédito do Pix mesmo caindo um dia depois', () => {
    const r = matchCieloBanco([pix('1', 199.9, '05/08/2026')], [credito(199.9, '06/08/2026')]);
    expect(r.nsusPagos.has('1')).toBe(true);
  });
});

describe('descrições do extrato', () => {
  it('reconhece o formato da API do Inter, não só o do CNAB', () => {
    // CNAB: "PIX RECEBIDO ..." · API: "Pix recebido - PIX RECEBIDO - Cp :..."
    const viaApi = matchCieloBanco(
      [pix('1', 80)],
      [credito(80, '01/08/2026', 'Pix recebido - PIX RECEBIDO - Cp :00000000-CIELO S.A')],
    );
    expect(viaApi.nsusPagos.has('1')).toBe(true);

    const viaCnab = matchCieloBanco([pix('2', 80)], [credito(80, '01/08/2026', 'PIX RECEBIDO')]);
    expect(viaCnab.nsusPagos.has('2')).toBe(true);
  });

  it('ignora crédito que não é de adquirente', () => {
    const r = matchCieloBanco(
      [pix('1', 80)],
      [credito(80, '01/08/2026', 'Transferência recebida - DOC de terceiro')],
    );
    expect(r.nsusPagos.has('1')).toBe(false);
  });
});
