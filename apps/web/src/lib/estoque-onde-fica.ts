// ONDE FICA O ESTOQUE — regra do dono (16/11/2026): "ou é um insumo ou é o
// produto propriamente dito. Quando ele estiver habilitado para insumo, ele não
// pode ter produto, ou é um ou é outro."
//
// Produto de VENDA cuja ficha técnica baixa de um insumo que controla estoque
// não guarda saldo próprio: a venda baixa no insumo, então entrada e ajuste
// também são no insumo. (Em 11/11/2026 os vinhos da Mar ficaram com o saldo em
// dobro: o Pedido Lelis entrou no insumo e o ajuste manual no produto de venda.)
//
// Insumo produzido (tipo INSUMO com ficha própria, ex.: molho) fica de fora:
// ele guarda o próprio saldo, que entra pela produção.
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@concilia/db';
import type { ExecDb } from '@/lib/custo-medio';

export interface InsumoDoEstoque {
  insumoId: string;
  nome: string;
  saldo: number;
  quantidade: number;
  unidade: string;
}

export interface OndeFicaEstoque {
  /** insumos (que controlam estoque) de onde a venda deste produto baixa */
  insumos: InsumoDoEstoque[];
  /** revenda 1:1 (uma linha só, 1 unidade): a entrada do produto vai pra este insumo */
  destinoId: string | null;
}

const VAZIO: OndeFicaEstoque = { insumos: [], destinoId: null };

export async function ondeFicaEstoque(produtoId: string, exec: ExecDb = db): Promise<OndeFicaEstoque> {
  const insumo = alias(schema.produto, 'insumo');
  const linhas = await exec
    .select({
      tipo: schema.produto.tipo,
      insumoId: insumo.id,
      nome: insumo.nome,
      saldo: insumo.estoqueAtual,
      quantidade: schema.fichaTecnica.quantidade,
      unidade: schema.fichaTecnica.unidade,
    })
    .from(schema.fichaTecnica)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.fichaTecnica.produtoId))
    .innerJoin(insumo, eq(insumo.id, schema.fichaTecnica.insumoId))
    .where(
      and(
        eq(schema.fichaTecnica.produtoId, produtoId),
        eq(schema.fichaTecnica.baixaEstoque, true),
        eq(insumo.controlaEstoque, true),
      ),
    );
  if (linhas.length === 0 || linhas[0]!.tipo === 'INSUMO') return VAZIO;

  const insumos: InsumoDoEstoque[] = linhas
    .filter((l) => l.insumoId !== produtoId)
    .map((l) => ({
      insumoId: l.insumoId,
      nome: l.nome ?? '',
      saldo: Number(l.saldo ?? 0),
      quantidade: Number(l.quantidade ?? 0),
      unidade: (l.unidade ?? '').trim().toLowerCase(),
    }));
  if (insumos.length === 0) return VAZIO;

  const unico = insumos.length === 1 ? insumos[0]! : null;
  const umPraUm = !!unico && unico.quantidade === 1 && (unico.unidade === '' || unico.unidade === 'un');
  return { insumos, destinoId: umPraUm ? unico!.insumoId : null };
}

/** Produto que recebe a entrada: o insumo da revenda 1:1, senão o próprio. */
export async function produtoQueRecebeEntrada(produtoId: string, exec: ExecDb = db): Promise<string> {
  const o = await ondeFicaEstoque(produtoId, exec);
  return o.destinoId ?? produtoId;
}

export function nomesDosInsumos(o: OndeFicaEstoque): string {
  return o.insumos.map((i) => i.nome).filter(Boolean).join(', ');
}
