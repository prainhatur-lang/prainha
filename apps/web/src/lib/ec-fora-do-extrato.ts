// ECs da Cielo cujo dinheiro cai numa conta que o sistema NAO le.
//
// A perna Banco compara a agenda da Cielo com lancamento_banco, que hoje so
// tem o Inter. O EC online do Prainha Bar (2774134484 — Pix do QR da mesa) e'
// pago pela Cielo no Banco do Brasil: procurar esses Pix no Inter nunca acha o
// credito certo e, quando acha um de valor igual, e' Pix de cliente. Em
// 12/10/2026 o dono descobriu que esse dinheiro entrava no BB sem a conciliacao
// acusar a falta no Inter.
//
// O destino fica no cadastro do EC (filial.taxas.ecs[].bancoDestino). Se a
// filial nao tem conta_bancaria desse banco COM lancamento carregado, o EC esta
// "fora do extrato": o motor nao casa nada dele e a perna Banco abre excecao
// dizendo onde o dinheiro cai.

import { db, schema } from '@concilia/db';
import type { TaxasFilial } from '@concilia/db/schema';
import { eq, sql } from 'drizzle-orm';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\bbanco\b|\bdo\b|\bde\b|\bda\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Mapa EC -> nome do banco de destino, so dos ECs fora do extrato carregado. */
export async function ecsForaDoExtrato(
  filialId: string,
  taxas: TaxasFilial | null | undefined,
): Promise<Map<string, string>> {
  const fora = new Map<string, string>();
  const comDestino = (taxas?.ecs ?? []).filter((e) => e.codigo && e.bancoDestino?.trim());
  if (comDestino.length === 0) return fora;

  const contas = await db
    .select({ banco: schema.contaBancaria.banco })
    .from(schema.contaBancaria)
    .where(
      sql`${eq(schema.contaBancaria.filialId, filialId)} and exists (select 1 from ${schema.lancamentoBanco} where ${schema.lancamentoBanco.contaBancariaId} = ${schema.contaBancaria.id})`,
    );
  const carregados = contas.map((c) => norm(c.banco));

  for (const e of comDestino) {
    const destino = norm(e.bancoDestino!);
    const temExtrato = carregados.some((b) => b === destino || b.includes(destino) || destino.includes(b));
    if (!temExtrato) fora.set(e.codigo, e.bancoDestino!.trim());
  }
  return fora;
}
