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

  // ATÉ QUANDO O EXTRATO COBRE — o dia que o ARQUIVO cobre, não a maior
  // data_venda que entrou.
  //
  // O arquivo da Cielo publicado no dia D (CIELO03D_<ec>_..._<D>.TXT, importado
  // ~11:30) traz o movimento do dia D-1 — e mais uma ou outra linha DATADA COMO
  // D: venda da noite que a Cielo carimbou no dia seguinte. Medido em toda a
  // era EDI (2.451 linhas, 2 filiais): TODA linha é datada D-1 ou D em relação
  // ao próprio arquivo, nenhuma mais velha — nenhum arquivo traz venda
  // atrasada. Então o arquivo de D fecha o dia D-1, e só ele.
  //
  // Com `max(data_venda)` uma única linha mal datada anunciava o dia D inteiro
  // como coberto: em 06/09/2026 a nuvem tinha 1 linha de 06/09 (NSU 74001, que
  // no PDV é venda de 05/09 19:33) contra 195 de 05/09, e a conferência da loja
  // acusou o cartão da mesa 110 (NSU 81593, R$ 82,30) de `sem_par` — "sumiu
  // dinheiro" — quando o certo era `extrato_atrasado`, que fecha sozinho quando
  // o arquivo chegar. Na Tabuará a distorção é rotina: 256 de 604 linhas do EDI
  // são mal datadas.
  //
  // Linha sem data de arquivo no caminho (CSV baixado do portal à mão) cai na
  // regra antiga — ali não há período pra ler, e o upload manual é do dia.
  const arquivoOrigem = schema.vendaAdquirente.arquivoOrigem;
  const coberturaDoArquivo = sql`coalesce(
    coalesce(
      to_date(substring(${arquivoOrigem} from '_([0-9]{8})[.]TXT$'), 'YYYYMMDD'),
      substring(${arquivoOrigem} from '/([0-9]{4}-[0-9]{2}-[0-9]{2})/')::date
    ) - 1,
    ${schema.vendaAdquirente.dataVenda}
  )`;

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
      .select({ ate: sql<string | null>`max(${coberturaDoArquivo})::text` })
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
    /** Último dia FECHADO pelo arquivo da Cielo (= data do último arquivo - 1).
     *  Até aqui a loja pode confiar na ausência e chamar de `sem_par`; depois,
     *  falta de par só significa "o arquivo desse dia ainda não chegou". */
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
