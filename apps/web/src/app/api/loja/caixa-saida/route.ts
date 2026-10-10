// Despesa paga com dinheiro da gaveta → conta a pagar JÁ PAGA no Financeiro.
//
// No tempo do Consumer a "Despesa" do caixa criava a conta a pagar na hora
// (CONTASPAGAR, competência 'cx') e ela subia pelo sync. Com as casas em banco
// próprio o lançamento ficou só na loja: diária, compra e Uber pagos da gaveta
// sumiram do contas a pagar. Esta rota devolve isso — e é por ela que o caixa
// busca (e cadastra) quem recebe, já que o cadastro de fornecedor mora na nuvem.
//
// Quem chama é o vendas-local, com a assinatura HMAC dos canais loja↔nuvem
// (escopo próprio 'caixa-saida').
//
//   GET  ?f&e&s&q=nome        → { fornecedores: [{ id, nome, doc, casa }] }
//   POST { f, e, s, saidas: [{ ref, valor, quando, motivo, recebedor,
//          fornecedor_id?, lancou?, caixa? }] } → { ok, feitas: [ref...] }
//
// Idempotente por (filial, codigo_referencia 'caixa:<ref>'): a loja reenvia até
// receber o ok, e reenviar não duplica. Só CRIA — nunca mexe numa conta que já
// existe (o financeiro pode ter classificado ou corrigido na mão).

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { dateToBrYmd } from '@/lib/datas';
import { fornecedoresParaLancar, garantirFornecedorNaFilial } from '@/lib/fornecedor-unico';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ESCOPO = 'caixa-saida';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function autoriza(f: string, e: number, s: string): NextResponse | null {
  if (!UUID.test(f) || !Number.isFinite(e)) return NextResponse.json({ error: 'parâmetros' }, { status: 400 });
  if (e * 1000 < Date.now()) return NextResponse.json({ error: 'expirado' }, { status: 403 });
  if (!confere([f, ESCOPO, String(e)], s)) return NextResponse.json({ error: 'assinatura' }, { status: 403 });
  return null;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export async function GET(request: Request) {
  const u = new URL(request.url);
  const f = String(u.searchParams.get('f') || '');
  const neg = autoriza(f, Number(u.searchParams.get('e') || 0), String(u.searchParams.get('s') || ''));
  if (neg) return neg;
  const q = semAcento(String(u.searchParams.get('q') || ''));
  if (q.length < 2) return NextResponse.json({ ok: true, fornecedores: [] });
  const todos = await fornecedoresParaLancar(f);
  const achados = todos
    .filter((x) => semAcento(x.nome ?? '').includes(q))
    // quem começa com o que foi digitado vem primeiro; da própria casa antes das outras
    .sort((a, b) => {
      const pa = semAcento(a.nome ?? '').startsWith(q) ? 0 : 1;
      const pb = semAcento(b.nome ?? '').startsWith(q) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (a.casa ? 1 : 0) - (b.casa ? 1 : 0);
    })
    .slice(0, 12)
    .map((x) => ({ id: x.id, nome: x.nome, doc: x.cnpjOuCpf, casa: x.casa }));
  return NextResponse.json({ ok: true, fornecedores: achados });
}

/** Acha na casa o cadastro com esse nome (sem acento/caixa) ou cria um novo —
 *  é o "cadastrar direto no caixa". Fica fora da lista de compras. */
async function fornecedorPeloNome(filialId: string, nome: string): Promise<string | null> {
  const alvo = semAcento(nome);
  if (alvo.length < 2) return null;
  const daCasa = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(and(eq(schema.fornecedor.filialId, filialId), isNull(schema.fornecedor.dataDelete)));
  const igual = daCasa.find((x) => semAcento(x.nome ?? '') === alvo);
  if (igual) return igual.id;
  const [novo] = await db
    .insert(schema.fornecedor)
    .values({ filialId, nome: nome.trim().slice(0, 200) })
    .returning({ id: schema.fornecedor.id });
  return novo?.id ?? null;
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const f = String(b?.f || '');
  const neg = autoriza(f, Number(b?.e || 0), String(b?.s || ''));
  if (neg) return neg;
  const saidas: unknown[] = Array.isArray(b?.saidas) ? b.saidas.slice(0, 50) : [];

  const feitas: string[] = [];
  const erros: Array<{ ref: string; erro: string }> = [];
  for (const bruto of saidas) {
    const s = (bruto ?? {}) as Record<string, unknown>;
    const ref = String(s.ref ?? '').trim().slice(0, 40);
    if (!ref) continue;
    try {
      const valor = Math.round(Number(s.valor) * 100) / 100;
      const quando = new Date(String(s.quando || ''));
      if (!(valor > 0) || !Number.isFinite(quando.getTime())) { erros.push({ ref, erro: 'valor/data inválidos' }); continue; }
      const codigoReferencia = `caixa:${ref}`;
      const [ja] = await db
        .select({ id: schema.contaPagar.id })
        .from(schema.contaPagar)
        .where(and(eq(schema.contaPagar.filialId, f), eq(schema.contaPagar.codigoReferencia, codigoReferencia)))
        .limit(1);
      if (ja) { feitas.push(ref); continue; }

      const motivo = String(s.motivo ?? '').trim().slice(0, 300) || 'sem motivo';
      const recebedor = String(s.recebedor ?? '').trim().slice(0, 200);
      const lancou = String(s.lancou ?? '').trim().slice(0, 80);
      const caixa = String(s.caixa ?? '').trim().slice(0, 30);

      let fornecedorId: string | null = null;
      const fid = String(s.fornecedor_id ?? '');
      if (UUID.test(fid)) {
        // cadastro único: se for de outra casa, acha/cria a linha desta
        fornecedorId = await garantirFornecedorNaFilial(fid, f, db, { ativarCompras: false }).catch(() => null);
      }
      if (!fornecedorId && recebedor) fornecedorId = await fornecedorPeloNome(f, recebedor);

      const dia = dateToBrYmd(quando); // dia em que o dinheiro saiu, em BRT
      const v = valor.toFixed(2);
      await db.transaction(async (tx) => {
        const [conta] = await tx
          .insert(schema.contaPagar)
          .values({
            filialId: f,
            fornecedorId,
            categoriaId: null,
            descricao: `Saída do caixa · ${motivo}`,
            observacao: [
              'Paga em dinheiro da gaveta (despesa lançada no caixa da loja).',
              recebedor ? `Recebeu: ${recebedor}.` : '',
              lancou ? `Lançou: ${lancou}.` : '',
              caixa ? `Caixa ${caixa}.` : '',
            ].filter(Boolean).join(' '),
            valor: v,
            dataVencimento: dia,
            dataPagamento: dia,
            valorPago: v,
            competencia: dia.slice(0, 7),
            codigoReferencia,
            origem: 'MANUAL',
            dataCadastro: quando,
          })
          .returning({ id: schema.contaPagar.id });
        if (conta) {
          await tx.insert(schema.contaPagarBaixa).values({
            filialId: f,
            contaPagarId: conta.id,
            data: dia,
            valor: v,
            observacao: 'Paga em dinheiro da gaveta',
          });
        }
      });
      feitas.push(ref);
    } catch (e) {
      erros.push({ ref, erro: (e as Error).message.slice(0, 200) });
    }
  }
  return NextResponse.json({ ok: true, feitas, erros });
}
