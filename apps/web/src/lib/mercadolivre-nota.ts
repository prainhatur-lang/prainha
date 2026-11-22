// Liga cada compra do Mercado Livre (montada pelos e-mails) à NF-e que o
// vendedor emitiu e que já chega sozinha pela SEFAZ (nota_compra, DF-e).
//
// Achado de 22/11/2026: as NF-e das compras do ML caem na SEFAZ no CNPJ de quem
// comprou (hoje a E.B. Serviços) e o CNPJ do vendedor no e-mail ("vendedorDoc")
// é o emit_cnpj da nota. Por isso a entrada no estoque vai PELA NOTA que já
// existe — criar "pedido sem nota" pra compra do ML daria estoque e conta em dobro.
//
// Casa por: CNPJ do vendedor = emit_cnpj, nota de -3 a +20 dias da compra. Um
// pedido pode vir em várias notas (a CHP mandou 8 pro mesmo pedido): com total,
// junta as notas mais perto da data até o total; sem total, as do dia mais perto.
// Sem CNPJ no e-mail, só por valor exato e só NF-e modelo 55 com número (uma
// nota só, sem empate). Só leitura.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface PedidoParaNota {
  pedido: string;
  data: string; // YYYY-MM-DD (BRT)
  total: number | null;
  vendedorDoc: string | null;
}

export interface NotaML {
  notaId: string;
  numero: number | null;
  emissao: string | null; // YYYY-MM-DD
  valor: number;
  itens: number;
  lancados: number;
  contasPagar: number;
}

export interface NotaDoPedido {
  notas: NotaML[];
  emitente: string | null;
  casa: string | null;
  como: 'cnpj' | 'valor';
  valor: number;
  itens: number;
  lancados: number;
  contasPagar: number;
}

interface LinhaNota {
  id: string;
  numero: number | null;
  modelo: number | null;
  emit_cnpj: string | null;
  emit_nome: string | null;
  emissao: string | null;
  valor: string | null;
  casa: string | null;
  itens: number;
  lancados: number;
  contas: number;
}

function dias(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export async function notasDasComprasML(pedidos: PedidoParaNota[]): Promise<Map<string, NotaDoPedido>> {
  const out = new Map<string, NotaDoPedido>();
  if (!pedidos.length) return out;
  const ordem = [...pedidos].sort((a, b) => a.data.localeCompare(b.data));
  const desde = ordem[0]!.data;

  const notas = (await db.execute(sql`
    SELECT n.id::text, n.numero, n.modelo, n.emit_cnpj, coalesce(n.emit_fantasia, n.emit_nome) AS emit_nome,
           (n.data_emissao AT TIME ZONE 'America/Sao_Paulo')::date::text AS emissao,
           n.valor_total::text AS valor, f.nome AS casa,
           (SELECT count(*)::int FROM nota_compra_item i WHERE i.nota_compra_id = n.id) AS itens,
           (SELECT count(*)::int FROM nota_compra_item i
             WHERE i.nota_compra_id = n.id
               AND EXISTS (SELECT 1 FROM movimento_estoque m WHERE m.nota_compra_item_id = i.id)) AS lancados,
           (SELECT count(*)::int FROM conta_pagar c WHERE c.nota_compra_id = n.id AND c.data_delete IS NULL) AS contas
      FROM nota_compra n
      LEFT JOIN filial f ON f.id = n.filial_id
     WHERE n.data_emissao >= (${desde}::date - 3)
       AND coalesce(n.situacao, 'AUTORIZADA') NOT IN ('CANCELADA', 'DENEGADA')
  `)) as unknown as LinhaNota[];

  const usadas = new Set<string>();
  const montar = (ns: LinhaNota[], como: 'cnpj' | 'valor'): NotaDoPedido => {
    const lista: NotaML[] = ns
      .map((n) => ({
        notaId: n.id,
        numero: n.numero,
        emissao: n.emissao,
        valor: Number(n.valor ?? 0),
        itens: Number(n.itens),
        lancados: Number(n.lancados),
        contasPagar: Number(n.contas),
      }))
      .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
    for (const n of ns) usadas.add(n.id);
    return {
      notas: lista,
      emitente: ns[0]!.emit_nome,
      casa: [...new Set(ns.map((n) => n.casa).filter(Boolean))].join(', ') || null,
      como,
      valor: lista.reduce((s, n) => s + n.valor, 0),
      itens: lista.reduce((s, n) => s + n.itens, 0),
      lancados: lista.reduce((s, n) => s + n.lancados, 0),
      contasPagar: lista.reduce((s, n) => s + n.contasPagar, 0),
    };
  };
  const distancia = (p: PedidoParaNota, n: LinhaNota) => (n.emissao ? dias(p.data, n.emissao) : 999);
  const naJanela = (p: PedidoParaNota, n: LinhaNota) => {
    const d = distancia(p, n);
    return d >= -3 && d <= 20;
  };

  // 1) CNPJ do vendedor
  for (const p of ordem) {
    const doc = soDigitos(p.vendedorDoc);
    if (doc.length !== 14) continue;
    const cands = notas
      .filter((n) => !usadas.has(n.id) && soDigitos(n.emit_cnpj) === doc && naJanela(p, n))
      .sort((a, b) => Math.abs(distancia(p, a)) - Math.abs(distancia(p, b)));
    if (!cands.length) continue;
    let escolhidas: LinhaNota[];
    if (p.total != null) {
      escolhidas = [];
      let soma = 0;
      for (const n of cands) {
        const v = Number(n.valor ?? 0);
        if (soma + v <= p.total + 0.5) {
          escolhidas.push(n);
          soma += v;
        }
      }
      if (!escolhidas.length) escolhidas = [cands[0]!];
    } else {
      const dia = cands[0]!.emissao;
      escolhidas = cands.filter((n) => n.emissao === dia);
    }
    out.set(p.pedido, montar(escolhidas, 'cnpj'));
  }

  // 2) Valor exato, só NF-e de verdade (modelo 55, com número, emitente com CNPJ)
  for (const p of ordem) {
    if (out.has(p.pedido) || p.total == null) continue;
    const c = notas.filter(
      (n) =>
        !usadas.has(n.id) &&
        n.modelo === 55 &&
        n.numero != null &&
        soDigitos(n.emit_cnpj).length === 14 &&
        Math.abs(Number(n.valor) - p.total!) < 0.005 &&
        naJanela(p, n),
    );
    if (c.length !== 1) continue; // valor repetido em duas notas: não chuta
    out.set(p.pedido, montar(c, 'valor'));
  }

  return out;
}
