// GET /api/loja/cielo-extrato?f&e&s&de&ate — vendas do extrato Cielo (EDI)
// da filial no período, pra loja conferir cartão lançado NA MÃO (sem NSU) no
// fechamento automático de caixa de maquininha.
//
// Por que existe: o operador às vezes passa o cartão fora do app da LIO e
// registra o pagamento manualmente no caixa, sem NSU. O dinheiro está no
// extrato da Cielo (que o central importa via EDI), mas a loja não tinha como
// saber — e o caixa ficava aberto pra sempre reprovado por "sem NSU". Este
// endpoint dá à loja a segunda prova: par por valor+dia+tipo no extrato.
//
// Auth: mesma assinatura HMAC dos outros /api/loja/* (escopo 'cielo-extrato').
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const f = url.searchParams.get('f') ?? '';
  const e = Number(url.searchParams.get('e'));
  const s = url.searchParams.get('s') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(f) || e * 1000 < Date.now() || !confere([f, 'cielo-extrato', String(e)], s)) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const de = url.searchParams.get('de') ?? '';
  const ate = url.searchParams.get('ate') ?? '';
  if (!YMD.test(de) || !YMD.test(ate) || de > ate) {
    return NextResponse.json({ ok: false, erro: 'período inválido (de/ate YYYY-MM-DD)' }, { status: 400 });
  }

  const { db, schema } = await import('@concilia/db');
  const { and, eq, gte, lte, sql } = await import('drizzle-orm');

  const [vendas, [cobertura]] = await Promise.all([
    db
      .select({
        data: sql<string>`${schema.vendaAdquirente.dataVenda}::text`,
        hora: schema.vendaAdquirente.horaVenda,
        valor: schema.vendaAdquirente.valorBruto,
        forma: schema.vendaAdquirente.formaPagamento,
        nsu: schema.vendaAdquirente.nsu,
      })
      .from(schema.vendaAdquirente)
      .where(
        and(
          eq(schema.vendaAdquirente.filialId, f),
          gte(schema.vendaAdquirente.dataVenda, de),
          lte(schema.vendaAdquirente.dataVenda, ate),
        ),
      ),
    db
      .select({ ate: sql<string | null>`max(${schema.vendaAdquirente.dataVenda})::text` })
      .from(schema.vendaAdquirente)
      .where(eq(schema.vendaAdquirente.filialId, f)),
  ]);

  // tipo normalizado pra loja não depender do texto livre do EDI
  const tipoDe = (forma: string | null): 'credito' | 'debito' | 'outro' => {
    const t = (forma ?? '').toLowerCase();
    if (t.includes('déb') || t.includes('deb')) return 'debito';
    if (t.includes('créd') || t.includes('cred')) return 'credito';
    return 'outro';
  };

  return NextResponse.json({
    ok: true,
    /** Até que dia o extrato está importado — antes disso a loja pode confiar
     *  na ausência; depois, "sem par" só significa "ainda não importado". */
    extrato_ate: cobertura?.ate ?? null,
    vendas: vendas.map((v) => ({
      data: v.data,
      hora: v.hora,
      valor: Number(v.valor),
      tipo: tipoDe(v.forma),
      nsu: String(v.nsu),
    })),
  });
}
