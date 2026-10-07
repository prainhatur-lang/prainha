// POST /api/relatorios/historico-faturamento/acesso — a senha da aba Histórico
// de faturamento (VGV). Quem cria, troca e redefine é só o DONO.
//
// Body: { organizacaoId, acao, senha?, senhaNova?, senhaLogin? }
//   definir   — primeira senha (senhaNova)
//   entrar    — abre a aba (senha)
//   trancar   — fecha a aba neste navegador
//   trocar    — senha atual (senha) + nova (senhaNova)
//   redefinir — "esqueci": senha de LOGIN do dono (senhaLogin) + nova (senhaNova)
//
// Nenhuma senha é registrada em log nem devolvida.

import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  conferirSenha,
  criarSenha,
  lerAcesso,
  registrarTentativa,
  trocarSenha,
  validarSenhaNova,
} from '@/lib/faturamento-acesso';
import { apagarPasse, gravarPasse, guardaAba } from '@/lib/faturamento-acesso-sessao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function bloqueado(ate: Date) {
  return NextResponse.json(
    {
      error: 'Muitas tentativas erradas. A aba fica trancada por alguns minutos.',
      bloqueadoAte: ate.getTime(),
    },
    { status: 429 },
  );
}

function errada(restantes: number, ate: Date | null, qual: string) {
  if (ate) return bloqueado(ate);
  return NextResponse.json(
    {
      error:
        restantes === 1
          ? `${qual} incorreta. Resta 1 tentativa.`
          : `${qual} incorreta. Restam ${restantes} tentativas.`,
      restantes,
    },
    { status: 401 },
  );
}

const soDono = () =>
  NextResponse.json({ error: 'Só o dono cria ou troca essa senha.' }, { status: 403 });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    organizacaoId?: unknown;
    acao?: unknown;
    senha?: unknown;
    senhaNova?: unknown;
    senhaLogin?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });

  const g = await guardaAba(body.organizacaoId, false);
  if (g.error) return g.error;
  const { user, org } = g;

  switch (body.acao) {
    case 'trancar': {
      await apagarPasse();
      return NextResponse.json({ ok: true });
    }

    case 'definir': {
      if (!org.dono) return soDono();
      const invalida = validarSenhaNova(body.senhaNova);
      if (invalida) return NextResponse.json({ error: invalida }, { status: 400 });
      const segredo = await criarSenha(org.id, user.id, body.senhaNova as string);
      if (!segredo) {
        return NextResponse.json(
          { error: 'A senha já foi criada. Use "Trocar senha" ou "Esqueci a senha".' },
          { status: 409 },
        );
      }
      const abertaAte = await gravarPasse(org.id, user.id, segredo);
      return NextResponse.json({ ok: true, abertaAte });
    }

    case 'entrar': {
      if (typeof body.senha !== 'string' || !body.senha) {
        return NextResponse.json({ error: 'Digite a senha.' }, { status: 400 });
      }
      const r = await conferirSenha(org.id, body.senha);
      if (!r.ok) {
        if (r.motivo === 'sem-senha') {
          return NextResponse.json({ error: 'A senha ainda não foi criada.' }, { status: 409 });
        }
        if (r.motivo === 'bloqueado') return bloqueado(r.ate);
        return errada(r.restantes, r.ate, 'Senha');
      }
      const abertaAte = await gravarPasse(org.id, user.id, r.segredo);
      return NextResponse.json({ ok: true, abertaAte });
    }

    case 'trocar': {
      if (!org.dono) return soDono();
      if (typeof body.senha !== 'string' || !body.senha) {
        return NextResponse.json({ error: 'Digite a senha atual.' }, { status: 400 });
      }
      const invalida = validarSenhaNova(body.senhaNova);
      if (invalida) return NextResponse.json({ error: invalida }, { status: 400 });
      const r = await conferirSenha(org.id, body.senha);
      if (!r.ok) {
        if (r.motivo === 'sem-senha') {
          return NextResponse.json({ error: 'A senha ainda não foi criada.' }, { status: 409 });
        }
        if (r.motivo === 'bloqueado') return bloqueado(r.ate);
        return errada(r.restantes, r.ate, 'Senha atual');
      }
      const segredo = await trocarSenha(org.id, user.id, body.senhaNova as string);
      if (!segredo) return NextResponse.json({ error: 'não deu pra trocar' }, { status: 500 });
      const abertaAte = await gravarPasse(org.id, user.id, segredo);
      return NextResponse.json({ ok: true, abertaAte });
    }

    case 'redefinir': {
      if (!org.dono) return soDono();
      if (!user.email) {
        return NextResponse.json({ error: 'usuário sem e-mail de login' }, { status: 400 });
      }
      if (typeof body.senhaLogin !== 'string' || !body.senhaLogin) {
        return NextResponse.json({ error: 'Digite a sua senha de login.' }, { status: 400 });
      }
      const invalida = validarSenhaNova(body.senhaNova);
      if (invalida) return NextResponse.json({ error: invalida }, { status: 400 });
      if (!(await lerAcesso(org.id))) {
        return NextResponse.json({ error: 'A senha ainda não foi criada.' }, { status: 409 });
      }
      // Conta como tentativa (mesma trava da senha da aba) antes de conferir.
      const t = await registrarTentativa(org.id);
      if (t.estado === 'sem-senha') {
        return NextResponse.json({ error: 'A senha ainda não foi criada.' }, { status: 409 });
      }
      if (t.estado === 'bloqueado') return bloqueado(t.ate);

      // Re-autentica a senha de LOGIN do próprio dono — client isolado, sem
      // persistir sessão (mesmo jeito da reabertura de folha).
      const verifier = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { error: authErr } = await verifier.auth.signInWithPassword({
        email: user.email,
        password: body.senhaLogin,
      });
      if (authErr) return errada(t.restantes, t.ate, 'Senha de login');

      // trocarSenha zera as tentativas e troca o segredo (passes antigos caem).
      const segredo = await trocarSenha(org.id, user.id, body.senhaNova as string);
      if (!segredo) return NextResponse.json({ error: 'não deu pra redefinir' }, { status: 500 });
      const abertaAte = await gravarPasse(org.id, user.id, segredo);
      return NextResponse.json({ ok: true, abertaAte });
    }

    default:
      return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
  }
}
