// Painel do cartão fidelidade: regras, convites (criação em lote) e ações
// sobre o cartão. Tudo no escopo da ORGANIZAÇÃO da filial ativa.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { orgDoUsuario } from '@/lib/fidelidade/admin';
import { candidatosConvite } from '@/lib/fidelidade/candidatos';
import { carregarPrograma, normalizarConfig, nivelPorCodigo, type FidelidadeConfig } from '@/lib/fidelidade/config';
import { avisarWallet, criarCartao, tocarPass, trocarCodigo } from '@/lib/fidelidade/nucleo';
import { gerarCodigo } from '@/lib/fidelidade/codigo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PERM: Record<string, string> = {
  candidatos: 'fidelidade.read',
  criar: 'fidelidade.create',
  convidado: 'fidelidade.create',
  novo_codigo: 'fidelidade.create',
  config: 'fidelidade.configurar',
  bloquear: 'fidelidade.configurar',
  desbloquear: 'fidelidade.configurar',
  garantir: 'fidelidade.configurar',
};

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status });
const dataOk = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return erro('unauthorized', 401);

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  const perm = PERM[acao];
  if (!perm) return erro('ação desconhecida');
  if (!(await podeUsuario(user.id, perm))) return erro(`sem permissao: ${perm}`, 403);

  const org = await orgDoUsuario(user.id, typeof b?.filialId === 'string' ? b.filialId : null);
  if (!org) return erro('sem filial', 403);
  const { config: cfg } = await carregarPrograma(org.organizacaoId);

  if (acao === 'candidatos') {
    const lista = await candidatosConvite(org.organizacaoId, cfg.janelaDias, Math.max(2, Number(b?.minimo) || 2));
    return NextResponse.json({ ok: true, candidatos: lista });
  }

  if (acao === 'config') {
    const config = normalizarConfig(b?.config as Partial<FidelidadeConfig>);
    const ativo = b?.ativo !== false;
    await db
      .insert(schema.fidelidadePrograma)
      .values({ organizacaoId: org.organizacaoId, ativo, config, atualizadoEm: new Date() })
      .onConflictDoUpdate({
        target: schema.fidelidadePrograma.organizacaoId,
        set: { ativo, config, atualizadoEm: new Date() },
      });
    return NextResponse.json({ ok: true, config, ativo });
  }

  if (acao === 'criar') {
    const pessoas = Array.isArray(b?.pessoas) ? (b.pessoas as Array<Record<string, unknown>>).slice(0, 500) : [];
    if (!pessoas.length) return erro('ninguém selecionado');
    const filiaisOk = new Set(org.filiais.map((f) => f.id));
    const criados: Array<{ id: string; nome: string; telefone: string; token: string; novo: boolean }> = [];
    const falhas: Array<{ nome: string; erro: string }> = [];
    for (const p of pessoas) {
      const nome = String(p.nome || '');
      try {
        const nivelMin = nivelPorCodigo(cfg, typeof p.nivelMinimo === 'string' ? p.nivelMinimo : null);
        const filialOrigem = typeof p.filialId === 'string' && filiaisOk.has(p.filialId) ? p.filialId : org.filialId;
        const { cartao, novo } = await criarCartao({
          organizacaoId: org.organizacaoId,
          nome,
          telefone: String(p.telefone || ''),
          cpf: typeof p.cpf === 'string' ? p.cpf : null,
          // o 1º nível todo mundo já tem — só grava garantia acima dele
          nivelMinimo: nivelMin && nivelMin.minVisitas > 0 ? nivelMin.codigo : null,
          nivelMinimoAte: dataOk(p.nivelMinimoAte),
          origem: p.manual ? 'manual' : 'convite',
          filialOrigemId: filialOrigem,
          origemDetalhe: typeof p.origemDetalhe === 'string' ? p.origemDetalhe.slice(0, 300) : null,
        });
        criados.push({ id: cartao.id, nome: cartao.nome, telefone: cartao.telefone, token: cartao.token, novo });
      } catch (e) {
        falhas.push({ nome, erro: (e as Error).message });
      }
    }
    return NextResponse.json({ ok: true, criados, falhas });
  }

  // ---- ações sobre um cartão
  const cartaoId = typeof b?.cartaoId === 'string' ? b.cartaoId : '';
  const [c] = cartaoId
    ? await db
        .select()
        .from(schema.fidelidadeCartao)
        .where(and(eq(schema.fidelidadeCartao.id, cartaoId), eq(schema.fidelidadeCartao.organizacaoId, org.organizacaoId)))
        .limit(1)
    : [];
  if (!c) return erro('cartão não encontrado', 404);

  if (acao === 'convidado') {
    await db.update(schema.fidelidadeCartao).set({ convidadoEm: new Date() }).where(eq(schema.fidelidadeCartao.id, c.id));
    return NextResponse.json({ ok: true });
  }

  if (acao === 'novo_codigo') {
    if (c.status !== 'ativo') return erro('cartão bloqueado');
    const codigo = await trocarCodigo(c.id, org.organizacaoId);
    await avisarWallet(c.id);
    return NextResponse.json({ ok: true, codigo });
  }

  if (acao === 'bloquear' || acao === 'desbloquear') {
    const status = acao === 'bloquear' ? 'bloqueado' : 'ativo';
    // desbloquear: o código antigo pode ter sido sorteado pra outro cartão
    // ativo nesse meio tempo (índice único) — aí sai com código novo
    for (let t = 0; ; t++) {
      try {
        await db
          .update(schema.fidelidadeCartao)
          .set({ status, passAtualizadoEm: new Date(), ...(t > 0 ? { codigo: gerarCodigo(), codigoGeradoEm: new Date() } : {}) })
          .where(eq(schema.fidelidadeCartao.id, c.id));
        break;
      } catch (e) {
        if (status !== 'ativo' || t >= 8 || !/unique|duplicate/i.test(String((e as Error)?.message))) throw e;
      }
    }
    await avisarWallet(c.id);
    return NextResponse.json({ ok: true, status });
  }

  if (acao === 'garantir') {
    const nivel = nivelPorCodigo(cfg, typeof b?.nivelMinimo === 'string' ? b.nivelMinimo : null);
    const ate = nivel ? dataOk(b?.nivelMinimoAte) : null;
    await db
      .update(schema.fidelidadeCartao)
      .set({ nivelMinimo: nivel && nivel.minVisitas > 0 ? nivel.codigo : null, nivelMinimoAte: ate })
      .where(eq(schema.fidelidadeCartao.id, c.id));
    await tocarPass(c.id);
    await avisarWallet(c.id);
    return NextResponse.json({ ok: true });
  }

  return erro('ação desconhecida');
}
