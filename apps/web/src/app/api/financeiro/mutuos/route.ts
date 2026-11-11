// POST /api/financeiro/mutuos — empréstimo (mútuo) entre empresas do sistema
// (tela /financeiro/emprestimos). Uma ação por chamada:
//   { acao:'criar', credoraId, devedoraId, valor, data, dataDevolucao, observacao?, jaSaiu? }
//   { acao:'cancelar', mutuoId, motivo }
// Só o grupo Admin (mesmo critério de pagar Pix e de ver a E.B. no financeiro).
// A devolução não passa por aqui: é baixa na conta de devolução, pelo contas a pagar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ehAdmin } from '@/lib/usuario-admin';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { RecusaMutuo, cancelarMutuo, criarMutuo } from '@/lib/mutuo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function POST(request: Request) {
  const g = await exigirPermApi('conta_pagar.marcar_pago');
  if (g.error) return g.error;
  const user = g.user;
  if (!(await ehAdmin(user.id))) return err('empréstimo entre empresas é só para o Admin', 403);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return err('corpo inválido');
  const filiais = await filiaisDoFinanceiro(user.id);

  try {
    switch (String(b.acao ?? '')) {
      case 'criar': {
        const credora = filiais.find((f) => f.id === String(b.credoraId ?? ''));
        const devedora = filiais.find((f) => f.id === String(b.devedoraId ?? ''));
        if (!credora) return err('escolha quem empresta');
        if (!devedora) return err('escolha quem recebe');
        const data = String(b.data ?? '');
        const dataDevolucao = String(b.dataDevolucao ?? '');
        if (!YMD.test(data)) return err('data do empréstimo inválida');
        if (!YMD.test(dataDevolucao)) return err('data de devolução inválida');
        const m = await criarMutuo({
          usuarioId: user.id,
          credora: { id: credora.id, nome: credora.nome, cnpj: credora.cnpj ?? '' },
          devedora: { id: devedora.id, nome: devedora.nome, cnpj: devedora.cnpj ?? '' },
          valor: Number(b.valor),
          data,
          dataDevolucao,
          observacao: String(b.observacao ?? '').trim().slice(0, 500) || null,
          jaSaiu: b.jaSaiu === true,
        });
        return NextResponse.json({ ok: true, id: m.id, numero: m.numero });
      }
      case 'cancelar': {
        const mutuoId = String(b.mutuoId ?? '');
        const motivo = String(b.motivo ?? '').trim().slice(0, 500);
        if (motivo.length < 3) return err('diga o motivo do cancelamento');
        const [m] = await db
          .select({ c: schema.mutuo.filialCredoraId, d: schema.mutuo.filialDevedoraId })
          .from(schema.mutuo)
          .where(eq(schema.mutuo.id, mutuoId))
          .limit(1);
        if (!m) return err('empréstimo não encontrado', 404);
        if (!filiais.some((f) => f.id === m.c) || !filiais.some((f) => f.id === m.d)) return err('sem acesso a esse empréstimo', 403);
        await cancelarMutuo({ usuarioId: user.id, mutuoId, motivo });
        return NextResponse.json({ ok: true });
      }
      default:
        return err('ação desconhecida');
    }
  } catch (e) {
    if (e instanceof RecusaMutuo) return err(e.message);
    throw e;
  }
}
