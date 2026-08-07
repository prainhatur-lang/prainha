// Testes do parser EDI contra o kit OFICIAL de teste da Cielo
// (ArquivoTeste_ExtratoEletronico.zip que acompanha o manual v15.15).
// Os fixtures são os arquivos originais, só renomeados — EC fictício 1234567890.
//
// O kit conta uma história completa de conciliação:
//   21/01 CIELO03: venda voucher Alelo de R$ 245,80 (líq. 238,45), venc. 20/02
//   18/02 (CIELO15): a UR é antecipada via ARV — líq. 237,93 (desconto 0,52)
//   19/02 CIELO03: aparece o débito ARV de -238,45 na agenda
//   20/02 CIELO04: no vencimento original, venda +238,45 e débito ARV -238,45
//                  liquidam juntos → líquido ZERO na conta (já foi pago antes)
//   03/03 CIELO16: 16 Pix — 14 pagos, 1 bloqueado (+199,90) e o ajuste do
//                  bloqueio (-199,90) → líquido do dia 10.027,38
//   04/03 CIELO16: desbloqueio: ajuste a crédito +199,90 pago em 03/03

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ehArquivoEdi,
  lerCabecalhoEdi,
  parseCieloEdiVendas,
  parseCieloEdiRecebiveis,
  parseCieloEdiUrs,
} from './cielo-edi';

const fixture = (nome: string): Buffer =>
  readFileSync(new URL(`./__fixtures__/${nome}`, import.meta.url));

const cielo03Venda = fixture('cielo03-venda-voucher.txt');
const cielo03Arv = fixture('cielo03-debito-arv.txt');
const cielo04 = fixture('cielo04-pagamento.txt');
const cielo15 = fixture('cielo15-negociacao.txt');
const cielo16 = fixture('cielo16-pix.txt');
const cielo16Desbloqueio = fixture('cielo16-pix-desbloqueio.txt');

describe('lerCabecalhoEdi / ehArquivoEdi', () => {
  it('identifica os 4 tipos de arquivo do kit', () => {
    expect(lerCabecalhoEdi(cielo03Venda)?.tipoArquivo).toBe('CIELO03');
    expect(lerCabecalhoEdi(cielo04)?.tipoArquivo).toBe('CIELO04');
    expect(lerCabecalhoEdi(cielo15)?.tipoArquivo).toBe('CIELO15');
    expect(lerCabecalhoEdi(cielo16)?.tipoArquivo).toBe('CIELO16');
    for (const f of [cielo03Venda, cielo03Arv, cielo04, cielo15, cielo16, cielo16Desbloqueio]) {
      expect(ehArquivoEdi(f)).toBe(true);
    }
  });

  it('lê matriz, data de processamento e sequencial', () => {
    const info = lerCabecalhoEdi(cielo03Venda)!;
    expect(info.matriz).toBe('1234567890');
    expect(info.dataProcessamento).toBe('21/01/2026');
    expect(info.sequencial).toBe('0001071');
  });

  it('não confunde CSV nem CNAB com EDI', () => {
    expect(ehArquivoEdi('Data da venda;Hora da venda;...')).toBe(false);
    expect(ehArquivoEdi('077' + '0'.repeat(237))).toBe(false); // CNAB começa com 077
  });
});

describe('parseCieloEdiVendas (CIELO03)', () => {
  it('lê a venda voucher com todos os campos', () => {
    const vendas = parseCieloEdiVendas(cielo03Venda);
    expect(vendas).toHaveLength(1);
    expect(vendas[0]).toEqual({
      data: '20/01/2026',
      hora: '11:28:04',
      estabelecimento: '1234567890',
      formaPagamento: 'Voucher',
      bandeira: 'Elo',
      valorBruto: 245.8,
      valorLiquido: 238.45,
      valorTaxa: 7.35,
      autorizacao: '680469',
      nsu: '746438',
      tid: null,
      dataPrevistaPagamento: '20/02/2026',
    });
  });

  it('NÃO transforma débito de antecipação ARV em venda', () => {
    // O CIELO03 de 19/02 só tem um registro E de posting 49 (débito ARV,
    // NSU 000000, -R$ 238,45). Sem o filtro de posting type isso viraria
    // uma venda falsa em venda_adquirente.
    expect(parseCieloEdiVendas(cielo03Arv)).toHaveLength(0);
  });

  it('rejeita arquivo que não é CIELO03', () => {
    expect(() => parseCieloEdiVendas(cielo04)).toThrowError(/CIELO04/);
  });
});

describe('parseCieloEdiVendas (CIELO16 — o Pix também é venda)', () => {
  it('gera venda só das transações Pix, ignorando os ajustes', () => {
    // 16 registros: 15 Pix (tipo 01) + 1 ajuste a débito do bloqueio (tipo 03)
    const vendas = parseCieloEdiVendas(cielo16);
    expect(vendas).toHaveLength(15);
    expect(vendas.every((v) => v.formaPagamento === 'Pix' && v.bandeira === 'Pix')).toBe(true);
  });

  it('a venda Pix carrega o mesmo par (nsu, autorização) do recebível', () => {
    const [venda] = parseCieloEdiVendas(cielo16);
    const rec = parseCieloEdiRecebiveis(cielo16).find((r) => r.nsu === venda!.nsu)!;
    expect(venda).toMatchObject({
      data: '02/03/2026',
      estabelecimento: '1234567890',
      valorBruto: 200,
      valorTaxa: 0.1,
      valorLiquido: 199.9,
      nsu: '656547',
      autorizacao: 'E9040088820260302131856721392001',
      dataPrevistaPagamento: '02/03/2026',
    });
    expect(venda!.autorizacao).toBe(rec.autorizacao);
  });

  it('o desbloqueio (ajuste a crédito) não vira venda nova', () => {
    expect(parseCieloEdiVendas(cielo16Desbloqueio)).toHaveLength(0);
  });
});

describe('parseCieloEdiRecebiveis (CIELO04)', () => {
  it('lê venda paga e débito ARV, líquido do dia = zero', () => {
    const rec = parseCieloEdiRecebiveis(cielo04);
    expect(rec).toHaveLength(2);

    const [venda, arv] = rec;
    expect(venda).toMatchObject({
      dataPagamento: '20/02/2026', // herdada do registro D (data real do pagamento)
      formaPagamento: 'Voucher',
      bandeira: 'Elo',
      valorBruto: 245.8,
      valorTaxa: 7.35,
      valorLiquido: 238.45,
      autorizacao: '680469',
      nsu: '746438',
      status: 'Pago',
    });
    // O débito da antecipação FICA no recebível: é ele que explica o líquido
    // zero do dia (a venda já tinha sido paga em 18/02 via ARV).
    expect(arv).toMatchObject({
      dataPagamento: '20/02/2026',
      valorBruto: -238.45,
      valorLiquido: -238.45,
      nsu: '0',
      status: 'Antecipação ARV',
    });

    const liquidoDia = rec.reduce((s, r) => s + r.valorLiquido, 0);
    expect(liquidoDia).toBeCloseTo(0, 2);
  });

  it('expõe as URs (registros D) com data de pagamento', () => {
    const urs = parseCieloEdiUrs(cielo04);
    expect(urs).toHaveLength(2);
    expect(urs[0]).toMatchObject({ valorLiquido: 238.45, dataPagamento: '20/02/2026' });
    expect(urs[1]).toMatchObject({ valorLiquido: -238.45, dataPagamento: '20/02/2026' });
  });

  it('rejeita CIELO15 (negociação ARV analítica, sem parser)', () => {
    expect(() => parseCieloEdiRecebiveis(cielo15)).toThrowError(/CIELO15/);
    expect(() => parseCieloEdiVendas(cielo15)).toThrowError(/CIELO15/);
  });
});

describe('parseCieloEdiRecebiveis (CIELO16 — Pix)', () => {
  it('lê os 16 registros e o líquido bate com o trailer do arquivo', () => {
    const rec = parseCieloEdiRecebiveis(cielo16);
    expect(rec).toHaveLength(16);
    // trailer do arquivo: líquido +10.027,38 · bruto +10.028,78
    expect(rec.reduce((s, r) => s + r.valorLiquido, 0)).toBeCloseTo(10027.38, 2);
    expect(rec.reduce((s, r) => s + r.valorBruto, 0)).toBeCloseTo(10028.78, 2);
    for (const r of rec) {
      expect(r.formaPagamento).toBe('Pix');
      expect(r.bandeira).toBe('Pix');
    }
  });

  it('mapeia campos da transação Pix comum', () => {
    const [primeiro] = parseCieloEdiRecebiveis(cielo16);
    expect(primeiro).toMatchObject({
      dataPagamento: '02/03/2026',
      dataVenda: '02/03/2026',
      estabelecimento: '1234567890',
      valorBruto: 200,
      valorTaxa: 0.1,
      valorLiquido: 199.9,
      autorizacao: 'E9040088820260302131856721392001', // Pix ID entra como "autorização" (dedupe)
      nsu: '656547',
      status: 'Pago',
    });
  });

  it('bloqueio judicial: Pix bloqueado + ajuste a débito se anulam', () => {
    const rec = parseCieloEdiRecebiveis(cielo16);
    const bloqueado = rec.find((r) => r.autorizacao === 'E78840071202603022308xVivdOsRf2j')!;
    const ajuste = rec.find((r) => r.autorizacao === 'E78840071202603022308xVivdOsRf2k')!;
    expect(bloqueado.status).toBe('Bloqueado');
    expect(bloqueado.valorLiquido).toBeCloseTo(199.9, 2);
    expect(ajuste.status).toBe('Bloqueado');
    expect(ajuste.valorLiquido).toBeCloseTo(-199.9, 2);
    // Pix IDs distintos → a dedupe por (nsu, data, autorização) não engole o ajuste
    expect(bloqueado.autorizacao).not.toBe(ajuste.autorizacao);
    expect(bloqueado.nsu).toBe(ajuste.nsu);
  });

  it('desbloqueio no dia seguinte: ajuste a crédito pago', () => {
    const rec = parseCieloEdiRecebiveis(cielo16Desbloqueio);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({
      dataPagamento: '03/03/2026',
      valorLiquido: 199.9,
      status: 'Pago',
      autorizacao: 'E78840071202603022308xVivdOsRf2l',
    });
  });
});
