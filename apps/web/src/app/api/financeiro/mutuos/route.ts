// POST /api/financeiro/mutuos — empréstimo (mútuo) entre empresas do sistema
// (tela /financeiro/emprestimos). Uma ação por chamada:
//   { acao:'criar', credoraId, devedoraId, valor, data, dataDevolucao, observacao?, jaSaiu? }
//   { acao:'cancelar', mutuoId, motivo }
//   { acao:'pix', filialId, chave, favorecido?, banco? }  — chave PRINCIPAL da empresa (lib/empresa-pix)
//   { acao:'pix-add', filialId, chave, banco?, favorecido? } — mais uma chave (outro banco)
//   { acao:'pix-principal', chaveId } · { acao:'pix-banco', chaveId, banco } · { acao:'pix-remover', chaveId }
// Só o grupo Admin (mesmo critério de pagar Pix e de ver a E.B. no financeiro).
// A devolução não passa por aqui: é baixa na conta de devolução, pelo contas a pagar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ehAdmin } from '@/lib/usuario-admin';
import { filiaisDoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { RecusaMutuo, cancelarMutuo, criarMutuo } from '@/lib/mutuo';
import {
  RecusaEmpresaPix,
  adicionarChaveDaEmpresa,
  definirBancoDaChave,
  definirPixDaEmpresa,
  filialDaChave,
  removerChaveDaEmpresa,
  tornarChavePrincipal,
} from '@/lib/empresa-pix';

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
      case 'pix': {
        const empresa = filiais.find((f) => f.id === String(b.filialId ?? ''));
        if (!empresa) return err('empresa não encontrada', 404);
        const r = await definirPixDaEmpresa({
          usuarioId: user.id,
          filialId: empresa.id,
          chave: String(b.chave ?? ''),
          favorecido: String(b.favorecido ?? '').trim().slice(0, 200) || null,
          ...(typeof b.banco === 'string' ? { banco: b.banco } : {}),
        });
        return NextResponse.json({ ok: true, cadastros: r.cadastros });
      }
      case 'pix-add': {
        const empresa = filiais.find((f) => f.id === String(b.filialId ?? ''));
        if (!empresa) return err('empresa não encontrada', 404);
        const r = await adicionarChaveDaEmpresa({
          usuarioId: user.id,
          filialId: empresa.id,
          chave: String(b.chave ?? ''),
          banco: String(b.banco ?? '').trim() || null,
          favorecido: String(b.favorecido ?? '').trim().slice(0, 200) || null,
        });
        return NextResponse.json({ ok: true, cadastros: r.cadastros, principal: r.principal });
      }
      case 'pix-principal':
      case 'pix-banco':
      case 'pix-remover': {
        const chaveId = String(b.chaveId ?? '');
        const dona = /^[0-9a-f-]{36}$/i.test(chaveId) ? await filialDaChave(chaveId) : null;
        if (!dona || !filiais.some((f) => f.id === dona)) return err('chave não encontrada', 404);
        if (b.acao === 'pix-principal') {
          const r = await tornarChavePrincipal({ usuarioId: user.id, chaveId });
          return NextResponse.json({ ok: true, cadastros: r.cadastros });
        }
        if (b.acao === 'pix-banco') await definirBancoDaChave({ chaveId, banco: String(b.banco ?? '') });
        else await removerChaveDaEmpresa({ usuarioId: user.id, chaveId });
        return NextResponse.json({ ok: true });
      }
      default:
        return err('ação desconhecida');
    }
  } catch (e) {
    if (e instanceof RecusaMutuo || e instanceof RecusaEmpresaPix) return err(e.message);
    throw e;
  }
}
