// "Atualizar agora" do /balanco: pede a foto direto pra loja (Tailscale, mesma
// assinatura da conferência de caixa) e grava — sem esperar os 10 min do loop.
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaCaixa } from '@/lib/caixa-loja';
import { pareceBalanco, salvarBalanco } from '@/lib/balanco';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await exigirPermApi('dashboard.read');
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => ({}))) as { filialId?: string };
  const filiais = await filiaisDoUsuario(auth.user.id);
  const alvo = body.filialId ? filiais.filter((f) => f.id === body.filialId) : filiais;
  if (!alvo.length) return NextResponse.json({ ok: false, erro: 'filial não acessível' }, { status: 403 });

  const resultados = await Promise.all(
    alvo.map(async (f) => {
      const r = await chamarLojaCaixa(f.id, '/api/central/caixa/balanco');
      if (!r.ok) return { filialId: f.id, nome: f.nome, ok: false, erro: r.erro ?? 'loja não respondeu' };
      if (!pareceBalanco(r.balanco)) {
        return { filialId: f.id, nome: f.nome, ok: false, erro: 'a loja ainda não tem o balanço (precisa atualizar o vendas-local)' };
      }
      try {
        const s = await salvarBalanco(f.id, r.balanco);
        return { filialId: f.id, nome: f.nome, ok: true, dia: s.dia };
      } catch (err) {
        return { filialId: f.id, nome: f.nome, ok: false, erro: err instanceof Error ? err.message : 'erro ao gravar' };
      }
    }),
  );
  return NextResponse.json({ ok: resultados.some((x) => x.ok), resultados });
}
