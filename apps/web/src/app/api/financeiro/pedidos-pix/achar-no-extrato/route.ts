// POST /api/financeiro/pedidos-pix/achar-no-extrato — antes do "✓ Paguei no
// Inter: dar baixa", procura no extrato do Inter da casa (ou da E.B./Lelis) um
// débito do mesmo valor na data informada (±1 dia). Sem débito → não baixa.
// Pedido do dono (10/11/2026, rescisão do Waldenisson baixada sem pagar): "não
// baixar direto, só se tiver como conciliar". Cada débito do extrato serve uma
// baixa só: a marca `[extrato:<data>:<centavos>:...]` vai na observação da
// baixa e é contada pra não usar o mesmo débito duas vezes. Só leitura.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import {
  buscarExtratoInter,
  credenciaisInterEmpresa,
  resolverCredenciaisInter,
  resolverCredenciaisInterPagamentos,
  type InterCredenciais,
} from '@/lib/inter';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const EB = '69717762-31ef-4134-9b0c-6e1cd6e56d01';
const LELIS = '90cad0c0-1404-49d2-884e-4d6554fc10f8';

const Body = z.object({
  filialId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valor: z.number().positive(),
});

function somarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function credExtrato(filialId: string): InterCredenciais | null {
  if (filialId === EB) return credenciaisInterEmpresa('EB') ?? resolverCredenciaisInterPagamentos(filialId);
  if (filialId === LELIS)
    return credenciaisInterEmpresa('LELIS') ?? credenciaisInterEmpresa('LELES') ?? resolverCredenciaisInterPagamentos(filialId);
  return resolverCredenciaisInter(filialId);
}

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { filialId, data } = parsed.data;
  const centavos = Math.round(parsed.data.valor * 100);

  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, filialId)))
    return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });

  const hoje = hojeBr();
  const ini = somarDias(data, -1);
  const fimBruto = somarDias(data, 1);
  const fim = fimBruto > hoje ? hoje : fimBruto;

  // débitos do valor exato, por dia: primeiro o Inter ao vivo; se falhar, o
  // extrato já importado (lancamento_banco das casas / extrato_empresa da E.B.)
  const porDia = new Map<string, number>();
  let fonte = 'Inter ao vivo';
  let vivoOk = false;
  const cred = credExtrato(filialId);
  if (cred) {
    try {
      const trs = await buscarExtratoInter(cred, ini, fim);
      for (const t of trs) {
        if (t.tipoOperacao !== 'D') continue;
        if (Math.round(Math.abs(Number(t.valor)) * 100) !== centavos) continue;
        porDia.set(t.dataEntrada, (porDia.get(t.dataEntrada) ?? 0) + 1);
      }
      vivoOk = true;
    } catch {
      vivoOk = false;
    }
  }
  if (!vivoOk) {
    fonte = 'extrato importado';
    const rows = (filialId === EB
      ? await db.execute(sql`
          SELECT data_movimento::text AS d, count(*)::int AS n FROM extrato_empresa
          WHERE empresa = 'EB' AND tipo = 'D' AND round(abs(valor) * 100) = ${centavos}
            AND data_movimento BETWEEN ${ini}::date AND ${fim}::date
          GROUP BY 1`)
      : await db.execute(sql`
          SELECT data_movimento::text AS d, count(*)::int AS n FROM lancamento_banco
          WHERE filial_id = ${filialId} AND tipo = 'D' AND round(abs(valor) * 100) = ${centavos}
            AND data_movimento BETWEEN ${ini}::date AND ${fim}::date
          GROUP BY 1`)) as unknown as { d: string; n: number }[];
    for (const r of rows) porDia.set(r.d, r.n);
  }

  // débitos já usados por baixas anteriores desta tela (marca na observação)
  const usados = (await db.execute(sql`
    SELECT substring(observacao from '\\[extrato:(\\d{4}-\\d{2}-\\d{2}):') AS d,
           count(DISTINCT substring(observacao from '\\[extrato:[^\\]]+\\]'))::int AS n
    FROM conta_pagar_baixa
    WHERE filial_id = ${filialId}
      AND observacao LIKE ${`%[extrato:%:${centavos}:%`}
    GROUP BY 1`)) as unknown as { d: string | null; n: number }[];
  const usadoDia = new Map(usados.filter((u) => u.d).map((u) => [u.d!, u.n]));

  // prefere o dia informado, depois os vizinhos
  const ordem = [data, somarDias(data, -1), somarDias(data, 1)].filter((d) => d >= ini && d <= fim);
  for (const d of ordem) {
    const livres = (porDia.get(d) ?? 0) - (usadoDia.get(d) ?? 0);
    if (livres > 0) {
      const marca = `[extrato:${d}:${centavos}:${crypto.randomUUID().slice(0, 8)}]`;
      return NextResponse.json({ achou: true, dataDebito: d, fonte, marca });
    }
  }
  const semExtrato = !cred && !vivoOk;
  return NextResponse.json({
    achou: false,
    fonte,
    mensagem: semExtrato
      ? 'Esta casa não tem extrato do Inter no sistema pra conferir.'
      : `Não achei no extrato do Inter (${fonte}) uma saída de ${(centavos / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })} entre ${ini.split('-').reverse().join('/')} e ${fim.split('-').reverse().join('/')}.`,
  });
}
