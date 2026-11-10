// Conferência dos Pix da Sicredi: todo Pix lançado no caixa pelo provedor
// Sicredi (forma Pix, autorização = E2E do BACEN, sem NSU da Cielo) tem que
// ter o MESMO E2E entre os Pix recebidos que a API Pix da Sicredi devolveu
// (lancamento_banco da conta 748, gravado pela cron pix-sicredi). Não achou
// = falta. Nunca casa por valor aproximado. Só leitura.

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte, min } from 'drizzle-orm';
import { CODIGO_BANCO_SICREDI } from './sicredi-pix';
import { dateToBrYmd } from './datas';

const ehE2E = (a: string | null): a is string => !!a && a.length === 32 && /^E\d{8}/.test(a);

export interface PixSicrediFalta {
  pagamentoId: string;
  e2e: string;
  valor: number;
  quando: string; // ISO
  dia: string; // YYYY-MM-DD BRT
  pedido: number | null;
  /** o E2E existe no extrato de OUTRA conta da casa (ex.: Inter) */
  outraConta: boolean;
}

export interface PixSicrediConferencia {
  /** primeiro dia com Pix da Sicredi lido pela API */
  desde: string;
  conferidos: { qtd: number; valor: number };
  faltas: PixSicrediFalta[];
  valorFalta: number;
}

/** null = a casa ainda não tem a API Pix da Sicredi lendo (nada a conferir). */
export async function conferirPixSicredi(filialId: string): Promise<PixSicrediConferencia | null> {
  const [ini] = await db
    .select({ desde: min(schema.lancamentoBanco.dataMovimento) })
    .from(schema.lancamentoBanco)
    .innerJoin(schema.contaBancaria, eq(schema.contaBancaria.id, schema.lancamentoBanco.contaBancariaId))
    .where(and(eq(schema.lancamentoBanco.filialId, filialId), eq(schema.contaBancaria.codigoBanco, CODIGO_BANCO_SICREDI)));
  if (!ini?.desde) return null;
  const desde = ini.desde;

  // Pix de menos de 2h pode ainda não ter passado pela cron (30 em 30 min).
  const ate = new Date(Date.now() - 2 * 3600 * 1000);
  const pags = await db
    .select({
      id: schema.pagamento.id,
      valor: schema.pagamento.valor,
      quando: schema.pagamento.dataPagamento,
      aut: schema.pagamento.numeroAutorizacaoCartao,
      forma: schema.pagamento.formaPagamento,
      pedido: schema.pagamento.codigoPedidoExterno,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, new Date(`${desde}T03:00:00Z`)),
        lte(schema.pagamento.dataPagamento, ate),
        isNull(schema.pagamento.nsuTransacao),
      ),
    );
  const pix = pags.filter((p) => ehE2E(p.aut) && (p.forma == null || /pix/i.test(p.forma)));
  if (pix.length === 0) return { desde, conferidos: { qtd: 0, valor: 0 }, faltas: [], valorFalta: 0 };

  const e2es = [...new Set(pix.map((p) => p.aut!))];
  const achadoSicredi = new Set<string>();
  const achadoOutra = new Set<string>();
  for (let i = 0; i < e2es.length; i += 1000) {
    const rows = await db
      .select({ e2e: schema.lancamentoBanco.idTransacao, banco: schema.contaBancaria.codigoBanco })
      .from(schema.lancamentoBanco)
      .innerJoin(schema.contaBancaria, eq(schema.contaBancaria.id, schema.lancamentoBanco.contaBancariaId))
      .where(
        and(
          eq(schema.lancamentoBanco.filialId, filialId),
          eq(schema.lancamentoBanco.tipo, 'C'),
          inArray(schema.lancamentoBanco.idTransacao, e2es.slice(i, i + 1000)),
        ),
      );
    for (const r of rows) {
      if (!r.e2e) continue;
      if (r.banco === CODIGO_BANCO_SICREDI) achadoSicredi.add(r.e2e);
      else achadoOutra.add(r.e2e);
    }
  }

  const faltas: PixSicrediFalta[] = [];
  let qtdOk = 0;
  let valorOk = 0;
  for (const p of pix) {
    const v = Number(p.valor);
    if (achadoSicredi.has(p.aut!)) {
      qtdOk++;
      valorOk += v;
      continue;
    }
    faltas.push({
      pagamentoId: p.id,
      e2e: p.aut!,
      valor: v,
      quando: p.quando!.toISOString(),
      dia: dateToBrYmd(p.quando!),
      pedido: p.pedido,
      outraConta: achadoOutra.has(p.aut!),
    });
  }
  faltas.sort((a, b) => b.quando.localeCompare(a.quando));
  return {
    desde,
    conferidos: { qtd: qtdOk, valor: +valorOk.toFixed(2) },
    faltas,
    valorFalta: +faltas.filter((f) => !f.outraConta).reduce((s, f) => s + f.valor, 0).toFixed(2),
  };
}
