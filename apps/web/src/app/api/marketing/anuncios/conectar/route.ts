// POST /api/marketing/anuncios/conectar
//   { filialId, token? | usarOutraCasa?: true }            → confere a chave e lista as contas de anúncio
//   { filialId, token? | usarOutraCasa?: true, contaId }   → grava a conta escolhida pra casa
// A chave é de usuário do sistema do Gerenciador de Negócios (ads_read + ads_management).

import { NextResponse } from 'next/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { acessoMarketingApi } from '@/lib/marketing/acesso';
import { chaveDeOutraCasa, ligacaoAnuncios, salvarLigacaoAnuncios } from '@/lib/marketing/anuncios-ligacao';
import { conferirChave, contasInstagramDaConta, ErroMeta } from '@/lib/marketing/meta-ads';
import { ligacaoRede } from '@/lib/marketing/ligacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    token?: string;
    usarOutraCasa?: boolean;
    contaId?: string;
  };
  const acesso = await acessoMarketingApi(b.filialId);
  if (acesso.error) return acesso.error;
  const { user, casa } = acesso;

  let token = (b.token ?? '').trim();
  if (!token && b.usarOutraCasa) {
    const casas = await filiaisDoUsuario(user.id);
    token = (await chaveDeOutraCasa(casas.map((c) => c.id), casa.id)) ?? '';
  }
  if (!token) token = (await ligacaoAnuncios(casa.id))?.accessToken ?? '';
  if (!token) return NextResponse.json({ error: 'Cole a chave do usuário do sistema.' }, { status: 400 });

  try {
    const quem = await conferirChave(token);
    if (!b.contaId) {
      return NextResponse.json({ ok: true, usuario: quem.nome, permissoes: quem.permissoes, contas: quem.contas });
    }
    const conta = quem.contas.find((c) => c.id === b.contaId);
    if (!conta) return NextResponse.json({ error: 'Essa chave não enxerga essa conta de anúncios.' }, { status: 400 });

    // Instagram que impulsiona: o mesmo @ já conectado no /marketing, se a conta enxergar
    const igs = await contasInstagramDaConta(token, conta.id).catch(() => []);
    const igCasa = await ligacaoRede(casa.id, 'instagram').catch(() => null);
    const ig =
      igs.find((i) => igCasa && (i.igId === igCasa.contaId || (i.usuario && i.usuario === igCasa.usuario))) ??
      (igs.length === 1 ? igs[0] : undefined);

    await salvarLigacaoAnuncios(
      casa.id,
      {
        accessToken: token,
        contaId: conta.id,
        contaNome: conta.nome,
        usuario: quem.nome,
        igId: ig?.igId ?? '',
        paginaId: ig?.paginaId ?? '',
      },
      user.id,
    );
    return NextResponse.json({ ok: true, conta: conta.nome, instagram: ig?.usuario ?? null });
  } catch (e) {
    const msg = e instanceof ErroMeta ? e.message : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
