// Campanha de convite pelo WhatsApp (ex.: abertura da Prainha Mar): resumo,
// carga da lista, envio de teste e envio em lotes. Só entra quem tem acesso
// à casa que está convidando.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { casaDoUsuario } from '@/lib/fidelidade/admin';
import { campanhaWhatsAppConfigurada } from '@/lib/whatsapp-otp';
import { CAMPANHAS, carregarLista, enviarLote, enviarTeste, recolocarFalhas, resumoCampanha } from '@/lib/campanha';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PERM: Record<string, string> = {
  resumo: 'fidelidade.read',
  carregar: 'fidelidade.create',
  teste: 'fidelidade.create',
  enviar: 'fidelidade.create',
  recolocar: 'fidelidade.create',
};

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return erro('unauthorized', 401);

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  const perm = PERM[acao];
  if (!perm) return erro('ação desconhecida');
  if (!(await podeUsuario(user.id, perm))) return erro(`sem permissao: ${perm}`, 403);

  const c = CAMPANHAS[typeof b?.campanha === 'string' ? b.campanha : ''];
  if (!c) return erro('campanha desconhecida');
  const org = await casaDoUsuario(user.id, c.filialId);
  if (!org || !org.filiais.some((f) => f.id === c.filialId)) return erro('sem acesso a essa casa', 403);

  if (acao === 'resumo') return NextResponse.json({ ok: true, ...(await resumoCampanha(c)) });

  if (acao === 'carregar') {
    const novos = await carregarLista(c);
    return NextResponse.json({ ok: true, novos, ...(await resumoCampanha(c)) });
  }

  if (acao === 'recolocar') {
    const n = await recolocarFalhas(c);
    return NextResponse.json({ ok: true, recolocados: n, ...(await resumoCampanha(c)) });
  }

  if (!campanhaWhatsAppConfigurada()) return erro('WhatsApp não configurado neste ambiente.');

  if (acao === 'teste') {
    try {
      const id = await enviarTeste(c, String(b?.telefone ?? ''), String(b?.nome ?? ''));
      return NextResponse.json({ ok: true, waMessageId: id });
    } catch (e) {
      return erro((e as Error).message);
    }
  }

  // enviar
  const qtd = Math.max(1, Math.min(100, Number(b?.qtd) || 50));
  const grupo = typeof b?.grupo === 'string' && b.grupo ? b.grupo : null;
  const r = await enviarLote(c, qtd, grupo);
  return NextResponse.json({ ok: true, ...r, ...(await resumoCampanha(c)) });
}
