// Loja aberta / fechada / pausada no iFood — as TRÊS casas numa tela só.
//
//   GET  → estado de cada filial que o usuário enxerga
//   GET ?merchants=1 → lojas que cada credencial enxerga no iFood (é o jeito
//          de descobrir o merchant_id de uma casa recém-autorizada no Portal)
//   GET ?detalhes=<filialId> → cadastro da loja no iFood + horário de funcionamento
//   POST { filialId, acao: 'pausar' | 'retomar', minutos?, motivo?, id? }
//   POST { filialId, acao: 'horarios', turnos: [{dia, inicio, duracao}] }
//          → reescreve a semana no iFood (exige configuracao.editar)
//
// Por que na nuvem e não só no vendas-local: Tabuará e Prainha Mar não rodam
// vendas-local. Pra elas o app.prainhabar.com é o único caminho de API.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { configsIfoodTodas } from '@/lib/ifood-credenciais';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { explicarErroIfood } from '@/lib/ifood-api';
import {
  statusLoja, pausarLoja, retomarLoja, merchantsDoApp, detalhesLoja, horariosLoja, salvarHorarios, validarTurnos,
} from '@/lib/ifood-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const minhas = await filiaisDoUsuario(user.id);
  const nomes = new Map(minhas.map((f) => [f.id, f.nome]));
  const todas = (await configsIfoodTodas()).filter((c) => nomes.has(c.filialId));

  const sp = new URL(request.url).searchParams;
  const detalhesDe = sp.get('detalhes');
  if (detalhesDe) {
    const c = todas.find((x) => x.filialId === detalhesDe);
    if (!c) return NextResponse.json({ error: 'filial sem credencial do iFood' }, { status: 400 });
    if (!c.merchantId) return NextResponse.json({ error: 'filial sem merchant_id' }, { status: 400 });
    // As duas leituras falham independentes: sem uma, a outra ainda ajuda.
    const [det, hor] = await Promise.allSettled([detalhesLoja(c, c.merchantId), horariosLoja(c, c.merchantId)]);
    return NextResponse.json({
      detalhes: det.status === 'fulfilled' ? det.value : null,
      erroDetalhes: det.status === 'rejected' ? explicarErroIfood(det.reason).mensagem : null,
      turnos: hor.status === 'fulfilled' ? hor.value : null,
      erroTurnos: hor.status === 'rejected' ? explicarErroIfood(hor.reason).mensagem : null,
    });
  }

  if (sp.get('merchants') === '1') {
    // Uma consulta por CREDENCIAL: casas do mesmo app veriam a mesma lista.
    const vistos = new Set<string>();
    const grupos: Array<{ clientId: string; lojas: Array<{ id: string; nome: string; razao: string }>; erro?: string }> = [];
    for (const c of todas) {
      if (!c.clientId || !c.clientSecret || vistos.has(c.clientId)) continue;
      vistos.add(c.clientId);
      try {
        grupos.push({ clientId: c.clientId, lojas: await merchantsDoApp(c) });
      } catch (e) {
        grupos.push({ clientId: c.clientId, lojas: [], erro: explicarErroIfood(e).mensagem });
      }
    }
    return NextResponse.json({ grupos });
  }

  // Uma casa lenta ou com 403 não pode segurar a tela das outras.
  const filiais = await Promise.all(
    todas.map(async (c) => {
      const comum = { filialId: c.filialId, nome: nomes.get(c.filialId) ?? '', merchantId: c.merchantId, ativo: c.ativo };
      if (!c.clientId || !c.clientSecret) {
        return { ...comum, sabe: false, semModulo: false, aberta: null, pausada: false,
          titulo: 'sem credencial', detalhe: 'falta client_id/client_secret nesta casa', motivos: [], pausas: [] };
      }
      if (!c.merchantId) {
        return { ...comum, sabe: false, semModulo: false, aberta: null, pausada: false,
          titulo: 'sem merchant_id', detalhe: 'a loja desta casa ainda não foi apontada — use "descobrir lojas"', motivos: [], pausas: [] };
      }
      try {
        return { ...comum, ...(await statusLoja(c, c.merchantId)) };
      } catch (e) {
        return { ...comum, sabe: false, semModulo: false, aberta: null, pausada: false,
          titulo: 'não consegui consultar a loja', detalhe: (e as Error).message.slice(0, 240), motivos: [], pausas: [] };
      }
    }),
  );

  return NextResponse.json({ filiais });
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const corpo = (await request.json().catch(() => ({}))) as {
    filialId?: string; acao?: string; minutos?: number; motivo?: string; id?: string;
    turnos?: Array<{ dia?: string; inicio?: string; duracao?: number }>;
  };
  const filialId = String(corpo.filialId ?? '');
  const acao = String(corpo.acao ?? '');
  if (!filialId) return NextResponse.json({ error: 'filialId' }, { status: 400 });

  // Pausar a casa errada é o estrago fácil de cometer: confere o acesso antes.
  const minhas = await filiaisDoUsuario(user.id);
  if (!minhas.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'sem acesso a esta filial' }, { status: 403 });
  }

  const c = (await configsIfoodTodas()).find((x) => x.filialId === filialId);
  if (!c) return NextResponse.json({ error: 'filial sem credencial do iFood' }, { status: 400 });
  if (!c.merchantId) return NextResponse.json({ error: 'filial sem merchant_id' }, { status: 400 });

  try {
    if (acao === 'pausar') {
      const r = await pausarLoja(c, c.merchantId, Number(corpo.minutos ?? 30), String(corpo.motivo ?? ''));
      return NextResponse.json({ ok: true, ...r });
    }
    if (acao === 'retomar') {
      const r = await retomarLoja(c, c.merchantId, corpo.id ? String(corpo.id) : undefined);
      return NextResponse.json({ ok: true, ...r });
    }
    if (acao === 'horarios') {
      // Horário é cadastro da casa, não operação de caixa: um PUT errado deixa a
      // loja fechada no iFood a semana inteira.
      if (!(await podeUsuario(user.id, 'configuracao.editar'))) {
        return NextResponse.json({ error: 'mudar horário no iFood exige permissão de configuração' }, { status: 403 });
      }
      const turnos = (corpo.turnos ?? []).map((t) => ({
        dia: String(t.dia ?? ''),
        inicio: String(t.inicio ?? ''),
        duracao: Number(t.duracao),
      }));
      if (turnos.length === 0) {
        return NextResponse.json({ error: 'sem nenhum turno a loja ficaria fechada a semana inteira no iFood' }, { status: 400 });
      }
      const invalido = validarTurnos(turnos);
      if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });
      return NextResponse.json({ ok: true, turnos: await salvarHorarios(c, c.merchantId, turnos) });
    }
    return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
  } catch (e) {
    const x = explicarErroIfood(e, 'Merchant');
    return NextResponse.json({ error: x.mensagem, semModulo: x.semModulo, codigo: x.codigo }, { status: x.status });
  }
}
