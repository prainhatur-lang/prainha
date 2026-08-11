// Validação de cupom promocional do delivery.
//
// Regras: ativo, dentro da validade (datas BRT), limite total de usos,
// limite por cliente (telefone), subtotal mínimo e "só primeira compra".
// O contador `usados` incrementa quando o pedido é PAGO, não na criação.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { hojeBr } from '@/lib/datas';
import { STATUS_PAGOS, ehPrimeiraCompra } from './frete';

export interface CupomAplicado {
  ok: boolean;
  erro?: string;
  cupomId?: string;
  codigo?: string;
  tipo?: 'percentual' | 'fixo' | 'frete_gratis';
  /** Desconto em centavos sobre o SUBTOTAL (0 pra frete_gratis). */
  descontoCentavos: number;
  freteGratis: boolean;
  /** Texto amigável ("10% de desconto", "R$ 15 de desconto", "frete grátis"). */
  label?: string;
}

const FALHA = (erro: string): CupomAplicado => ({
  ok: false,
  erro,
  descontoCentavos: 0,
  freteGratis: false,
});

export async function validarCupom(params: {
  filialId: string;
  codigo: string;
  telefone: string;
  subtotalCentavos: number;
}): Promise<CupomAplicado> {
  const codigo = params.codigo.trim().toUpperCase();
  if (!codigo) return FALHA('Digite o código do cupom.');

  const [cupom] = await db
    .select()
    .from(schema.deliveryCupom)
    .where(
      and(
        eq(schema.deliveryCupom.filialId, params.filialId),
        eq(schema.deliveryCupom.codigo, codigo),
      ),
    )
    .limit(1);

  if (!cupom || !cupom.ativo) return FALHA('Cupom não encontrado ou inativo.');

  const hoje = hojeBr();
  if (cupom.validadeInicio && hoje < cupom.validadeInicio) {
    return FALHA('Esse cupom ainda não começou a valer.');
  }
  if (cupom.validadeFim && hoje > cupom.validadeFim) {
    return FALHA('Esse cupom expirou.');
  }
  if (cupom.usosMax != null && cupom.usados >= cupom.usosMax) {
    return FALHA('Esse cupom já atingiu o limite de usos.');
  }
  if (cupom.minimoPedido != null) {
    const minimo = Math.round(Number(cupom.minimoPedido) * 100);
    if (params.subtotalCentavos < minimo) {
      return FALHA(
        `Esse cupom vale pra pedidos a partir de R$ ${Number(cupom.minimoPedido).toFixed(2).replace('.', ',')}.`,
      );
    }
  }
  if (cupom.usosPorCliente != null && params.telefone) {
    const [{ usos }] = await db
      .select({ usos: sql<number>`count(*)::int` })
      .from(schema.deliveryPedido)
      .where(
        and(
          eq(schema.deliveryPedido.cupomId, cupom.id),
          eq(schema.deliveryPedido.clienteTelefone, params.telefone),
          inArray(schema.deliveryPedido.status, STATUS_PAGOS),
        ),
      );
    if (usos >= cupom.usosPorCliente) {
      return FALHA('Você já usou esse cupom.');
    }
  }
  if (cupom.primeiraCompraApenas && params.telefone) {
    if (!(await ehPrimeiraCompra(params.filialId, params.telefone))) {
      return FALHA('Esse cupom vale só pra primeira compra.');
    }
  }

  const tipo = cupom.tipo as 'percentual' | 'fixo' | 'frete_gratis';
  const valor = Number(cupom.valor);
  let descontoCentavos = 0;
  let label = '';
  if (tipo === 'percentual') {
    descontoCentavos = Math.min(
      Math.round((params.subtotalCentavos * valor) / 100),
      params.subtotalCentavos,
    );
    label = `${valor % 1 === 0 ? valor.toFixed(0) : valor} % de desconto`;
  } else if (tipo === 'fixo') {
    descontoCentavos = Math.min(Math.round(valor * 100), params.subtotalCentavos);
    label = `R$ ${valor.toFixed(2).replace('.', ',')} de desconto`;
  } else {
    label = 'Frete grátis';
  }

  return {
    ok: true,
    cupomId: cupom.id,
    codigo,
    tipo,
    descontoCentavos,
    freteGratis: tipo === 'frete_gratis',
    label,
  };
}
