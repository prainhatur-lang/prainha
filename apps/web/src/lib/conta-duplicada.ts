// Trava de conta a pagar em dobro (27/10/2026).
//
// Caso: Pescados Rio Mar, pedido nº 2560, R$ 7.171,10 no Bar. A conta foi
// digitada na mão em 17/10 no cadastro "PESCADOS RIO MAR LTDA" e em 27/10 o
// pedido com foto entrou no cadastro "Pescados Mar Azul/ Pescados Rio Mar" —
// mesma empresa (mesmo grupo econômico, mesma chave Pix), dois cadastros. O
// aproveitamento da conta manual só olhava o MESMO fornecedor e criou outra.
//
// Regra do dono: mesma empresa + mesmo valor + mesmo número de pedido = mesma
// compra. Não pode virar duas contas.

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Ids dos cadastros desta casa que são a MESMA empresa do fornecedor:
 *  mesmo grupo econômico, mesmo CNPJ/CPF ou mesma chave Pix. Inclui ele mesmo. */
export async function fornecedoresMesmaEmpresa(
  filialId: string,
  fornecedorId: string,
): Promise<string[]> {
  const [f] = await db
    .select({
      grupo: schema.fornecedor.grupoEconomicoId,
      doc: schema.fornecedor.cnpjOuCpf,
      pix: schema.fornecedor.chavePix,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!f) return [fornecedorId];
  const doc = soDigitos(f.doc);
  const pix = (f.pix ?? '').trim();
  const conds = [eq(schema.fornecedor.id, fornecedorId)];
  if (f.grupo) conds.push(eq(schema.fornecedor.grupoEconomicoId, f.grupo));
  if (doc.length >= 11) {
    conds.push(sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\\D', '', 'g') = ${doc}`);
  }
  if (pix.length >= 5) conds.push(sql`trim(coalesce(${schema.fornecedor.chavePix}, '')) = ${pix}`);
  const rows = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(and(eq(schema.fornecedor.filialId, filialId), or(...conds)));
  const ids = new Set(rows.map((r) => r.id));
  ids.add(fornecedorId);
  return [...ids];
}

/** Números (3+ dígitos, sem zero à esquerda) que aparecem num texto. */
export function numerosDoTexto(...textos: (string | number | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of textos) {
    if (t == null) continue;
    // Datas e anos não são número de pedido ("aluguel 10/2026" todo mês).
    const limpo = String(t)
      .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b\d{1,2}\/\d{4}\b/g, ' ');
    for (const m of limpo.match(/\d{3,}/g) ?? []) {
      const n = m.replace(/^0+/, '');
      if (n.length < 3) continue;
      if (/^20\d\d$/.test(n)) continue;
      out.add(n);
    }
  }
  return [...out];
}

export interface ContaMesmoPedido {
  id: string;
  descricao: string | null;
  valor: string;
  dataVencimento: string | null;
  notaCompraId: string | null;
  fornecedor: string | null;
  numero: string;
  /** true = o número bateu com o pedido/NF-e ligado à conta (não só o histórico). */
  pelaNota: boolean;
}

/** Conta viva desta casa, da mesma empresa, com o mesmo valor e o mesmo número
 *  de pedido/nota (no histórico, na observação, na referência ou na nota ligada). */
export async function acharContaMesmoPedido(opts: {
  filialId: string;
  fornecedorId: string | null;
  valor: string | number;
  numeros: string[];
  ignorarNotaCompraId?: string | null;
}): Promise<ContaMesmoPedido | null> {
  if (!opts.fornecedorId || !opts.numeros.length) return null;
  const numeros = new Set(opts.numeros.map((n) => n.replace(/^0+/, '')).filter(Boolean));
  if (!numeros.size) return null;
  const ids = await fornecedoresMesmaEmpresa(opts.filialId, opts.fornecedorId);
  const valor = Number(opts.valor).toFixed(2);
  const rows = await db
    .select({
      id: schema.contaPagar.id,
      descricao: schema.contaPagar.descricao,
      observacao: schema.contaPagar.observacao,
      codigoReferencia: schema.contaPagar.codigoReferencia,
      valor: schema.contaPagar.valor,
      dataVencimento: schema.contaPagar.dataVencimento,
      notaCompraId: schema.contaPagar.notaCompraId,
      notaNumero: schema.notaCompra.numero,
      fornecedor: schema.fornecedor.nome,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.notaCompra, eq(schema.notaCompra.id, schema.contaPagar.notaCompraId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(
      and(
        eq(schema.contaPagar.filialId, opts.filialId),
        inArray(schema.contaPagar.fornecedorId, ids),
        eq(schema.contaPagar.valor, valor),
        isNull(schema.contaPagar.dataDelete),
      ),
    );
  // Pedido/NF-e lançado vem primeiro (trava firme); depois o histórico manual.
  let achado: ContaMesmoPedido | null = null;
  for (const r of rows) {
    if (opts.ignorarNotaCompraId && r.notaCompraId === opts.ignorarNotaCompraId) continue;
    const daNota = r.notaNumero != null ? String(r.notaNumero).replace(/^0+/, '') : '';
    const pelaNota = !!daNota && numeros.has(daNota);
    const achados = numerosDoTexto(r.descricao, r.observacao, r.codigoReferencia);
    const n = pelaNota ? daNota : achados.find((x) => numeros.has(x));
    if (n) {
      const c: ContaMesmoPedido = {
        id: r.id,
        descricao: r.descricao,
        valor: String(r.valor),
        dataVencimento: r.dataVencimento ? String(r.dataVencimento) : null,
        notaCompraId: r.notaCompraId,
        fornecedor: r.fornecedor,
        numero: n,
        pelaNota,
      };
      if (pelaNota) return c;
      achado ??= c;
    }
  }
  return achado;
}

export function msgContaDuplicada(c: ContaMesmoPedido): string {
  const v = Number(c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Já existe conta do pedido nº ${c.numero} de ${c.fornecedor ?? 'este fornecedor'} no mesmo valor (R$ ${v}): "${c.descricao ?? ''}". Mesma empresa, mesmo valor e mesmo número é a mesma compra — não lança de novo.`;
}
