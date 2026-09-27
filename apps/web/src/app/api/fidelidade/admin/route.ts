// Painel do cartão fidelidade: regras, convites (criação em lote) e ações
// sobre o cartão. Tudo no escopo da ORGANIZAÇÃO da filial ativa.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { orgDoUsuario } from '@/lib/fidelidade/admin';
import { candidatosConvite, type Regiao } from '@/lib/fidelidade/candidatos';
import { carregarPrograma, normalizarConfig, nivelPorCodigo, type FidelidadeConfig } from '@/lib/fidelidade/config';
import { avisarWallet, criarCartao, tocarPass, trocarCodigo } from '@/lib/fidelidade/nucleo';
import { gerarCodigo } from '@/lib/fidelidade/codigo';
import { dadosDoCartao } from '@/lib/fidelidade/nucleo';
import { conviteFidelidadeConfigurado, enviarConviteFidelidade } from '@/lib/whatsapp-otp';
import { brDateStart, hojeBr } from '@/lib/datas';

/** Teto de convites por dia (template de marketing). Número novo na Meta
 *  começa em 250 conversas iniciadas/24h; mandar demais derruba a qualidade. */
const CONVITES_DIA = Math.max(1, Number(process.env.FIDELIDADE_CONVITES_DIA) || 200);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PERM: Record<string, string> = {
  candidatos: 'fidelidade.read',
  criar: 'fidelidade.create',
  convidado: 'fidelidade.create',
  enviar_convites: 'fidelidade.create',
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
    const regiao: Regiao = b?.regiao === 'aracaju' || b?.regiao === 'grande' ? b.regiao : 'todos';
    // sem filtro de região o mínimo é 2 (senão vem a base inteira do Tagme)
    const minimo = Math.max(regiao === 'todos' ? 2 : 0, Math.floor(Number(b?.minimo ?? 2) || 0));
    const lista = await candidatosConvite(org.organizacaoId, cfg.janelaDias, minimo, regiao);
    return NextResponse.json({ ok: true, candidatos: lista });
  }

  if (acao === 'enviar_convites') {
    if (!conviteFidelidadeConfigurado()) {
      return erro('Template do convite não configurado (WHATSAPP_FIDELIDADE_TEMPLATE). Use o botão do WhatsApp (wa.me).');
    }
    const ids = Array.isArray(b?.cartaoIds) ? (b.cartaoIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
    if (!ids.length) return erro('nenhum cartão');
    const [{ n: jaHoje }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.fidelidadeCartao)
      .where(and(
        eq(schema.fidelidadeCartao.organizacaoId, org.organizacaoId),
        gte(schema.fidelidadeCartao.convidadoEm, brDateStart(hojeBr())),
      ));
    let saldo = CONVITES_DIA - (Number(jaHoje) || 0);
    if (saldo <= 0) return erro(`Limite de ${CONVITES_DIA} convites por dia atingido. Continue amanhã.`);
    const cartoes = await db
      .select()
      .from(schema.fidelidadeCartao)
      .where(and(
        eq(schema.fidelidadeCartao.organizacaoId, org.organizacaoId),
        inArray(schema.fidelidadeCartao.id, ids),
        eq(schema.fidelidadeCartao.status, 'ativo'),
        isNull(schema.fidelidadeCartao.aderidoEm),
        isNull(schema.fidelidadeCartao.recusadoEm),
      ));
    const enviados: string[] = [];
    const falhas: Array<{ id: string; nome: string; erro: string }> = [];
    let pulados = ids.length - cartoes.length;
    for (const c of cartoes) {
      if (saldo <= 0) { pulados++; continue; }
      // só celular (11 dígitos com o 9) recebe WhatsApp
      if (!/^\d{2}9\d{8}$/.test(c.telefone)) {
        falhas.push({ id: c.id, nome: c.nome, erro: 'não é celular' });
        await db.update(schema.fidelidadeCartao).set({ conviteErro: 'não é celular' }).where(eq(schema.fidelidadeCartao.id, c.id));
        continue;
      }
      try {
        const { estado } = await dadosDoCartao(c);
        await enviarConviteFidelidade(`55${c.telefone}`, {
          nome: c.nome.trim().split(/\s+/)[0] || 'cliente',
          nivel: estado.nivel.nome,
          pct: estado.nivel.pct,
          token: c.token,
        });
        await db
          .update(schema.fidelidadeCartao)
          .set({ convidadoEm: new Date(), conviteErro: null })
          .where(eq(schema.fidelidadeCartao.id, c.id));
        enviados.push(c.id);
        saldo--;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 500);
        falhas.push({ id: c.id, nome: c.nome, erro: msg });
        await db.update(schema.fidelidadeCartao).set({ conviteErro: msg }).where(eq(schema.fidelidadeCartao.id, c.id));
        // token/template com problema: para o lote em vez de errar 50 vezes
        if (/ 401| 403|template|#132/i.test(msg)) break;
      }
    }
    return NextResponse.json({ ok: true, enviados, falhas, pulados, restanteHoje: Math.max(0, saldo) });
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
          cidade: typeof p.cidade === 'string' ? p.cidade : null,
          bairro: typeof p.bairro === 'string' ? p.bairro : null,
          // cartão feito na hora pro cliente que pediu = já aderiu
          aderido: !!p.manual,
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
