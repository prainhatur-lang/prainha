// POST /api/cotacao/[id]/ajustar-resposta
// Gestor acerta uma resposta que não se compara com o pedido (dono 21/10/2026,
// cotação #38 do Bar): item pedido em cx/peça e o fornecedor deu o preço do kg
// sem dizer o peso, ou escreveu "c/ 16 cx" querendo dizer caixa de 16 kg.
// Sem acerto, a aprovação escolhe o menor número e manda pedido errado
// (coxa a R$ 9,99 a caixa). O preço que o fornecedor digitou NÃO muda — só o
// jeito de converter pra unidade do item.
//
// Body: { cotacaoFornecedorId, cotacaoItemId, modo, pesoKg? }
//   modo 'peso'             → preço é do kg; 1 {un} pesa pesoKg → preço da {un} = preço × peso
//   modo 'preco_da_unidade' → o número já é o preço da {un} (fornecedor errou o rótulo)
//   modo 'uma_de_n_kg'      → "c/ N" era o peso: o preço é de 1 {un} de N kg
//   modo 'juntas'           → "c/ N" era mesmo N {un} juntas: a conta fica como está
// Só enquanto a cotação não foi aprovada.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

const TRAVADAS = new Set(['APROVADA', 'CONCLUIDA', 'CANCELADA']);
type Modo = 'peso' | 'preco_da_unidade' | 'uma_de_n_kg' | 'juntas';

function fmtKg(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id: cotacaoId } = await params;
  let body: { cotacaoFornecedorId?: string; cotacaoItemId?: string; modo?: Modo; pesoKg?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const modo = body.modo;
  if (!body.cotacaoFornecedorId || !body.cotacaoItemId || !modo)
    return NextResponse.json({ error: 'cotacaoFornecedorId, cotacaoItemId e modo obrigatorios' }, { status: 400 });
  if (!['peso', 'preco_da_unidade', 'uma_de_n_kg', 'juntas'].includes(modo))
    return NextResponse.json({ error: 'modo inválido' }, { status: 400 });
  const peso = Number(body.pesoKg);
  if (modo === 'peso' && (!Number.isFinite(peso) || peso <= 0 || peso > 1000))
    return NextResponse.json({ error: 'peso em kg inválido' }, { status: 400 });

  const [cot] = await db
    .select({ id: schema.cotacao.id, filialId: schema.cotacao.filialId, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotação não encontrada' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === cot.filialId))
    return NextResponse.json({ error: 'filial sem acesso' }, { status: 403 });
  if (TRAVADAS.has(cot.status))
    return NextResponse.json({ error: 'cotação já aprovada/cancelada — não muda mais' }, { status: 400 });

  // Item e convocação têm que ser desta cotação.
  const [item] = await db
    .select({ id: schema.cotacaoItem.id, unidade: schema.cotacaoItem.unidade })
    .from(schema.cotacaoItem)
    .where(and(eq(schema.cotacaoItem.id, body.cotacaoItemId), eq(schema.cotacaoItem.cotacaoId, cotacaoId)))
    .limit(1);
  const [cf] = await db
    .select({ id: schema.cotacaoFornecedor.id })
    .from(schema.cotacaoFornecedor)
    .where(
      and(eq(schema.cotacaoFornecedor.id, body.cotacaoFornecedorId), eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId)),
    )
    .limit(1);
  if (!item || !cf) return NextResponse.json({ error: 'item ou fornecedor fora desta cotação' }, { status: 404 });

  const [resp] = await db
    .select({
      id: schema.cotacaoRespostaItem.id,
      preco: schema.cotacaoRespostaItem.precoUnitario,
      fator: schema.cotacaoRespostaItem.fatorConversao,
      embalagem: schema.cotacaoRespostaItem.unidadeFornecedor,
    })
    .from(schema.cotacaoRespostaItem)
    .where(
      and(
        eq(schema.cotacaoRespostaItem.cotacaoFornecedorId, cf.id),
        eq(schema.cotacaoRespostaItem.cotacaoItemId, item.id),
      ),
    )
    .limit(1);
  const preco = resp?.preco != null ? Number(resp.preco) : NaN;
  if (!resp || !Number.isFinite(preco) || preco <= 0)
    return NextResponse.json({ error: 'esse fornecedor não deu preço nesse item' }, { status: 404 });

  const un = item.unidade;
  const fatorAtual = Number(resp.fator) || 1;
  const nAtual = (resp.embalagem ?? '').match(/c\/\s*([\d.,]+)/)?.[1] ?? String(fatorAtual);
  let fator: number;
  let norm: number;
  let rotulo: string;
  if (modo === 'peso') {
    fator = 1 / peso;
    norm = preco * peso;
    rotulo = `kg (1 ${un} ≈ ${fmtKg(peso)} kg)`;
  } else if (modo === 'preco_da_unidade') {
    fator = 1;
    norm = preco;
    rotulo = `✓ preço da ${un}`;
  } else if (modo === 'uma_de_n_kg') {
    fator = 1;
    norm = preco;
    rotulo = `✓ 1 ${un} de ${nAtual} kg`;
  } else {
    fator = fatorAtual;
    norm = preco / fatorAtual;
    rotulo = `✓ ${nAtual} ${un} juntas`;
  }

  await db
    .update(schema.cotacaoRespostaItem)
    .set({
      fatorConversao: fator.toFixed(6),
      precoUnitarioNormalizado: norm.toFixed(6),
      unidadeFornecedor: rotulo.slice(0, 40),
    })
    .where(eq(schema.cotacaoRespostaItem.id, resp.id));

  return NextResponse.json({ ok: true, precoNorm: norm, rotulo });
}
