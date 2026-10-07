// Histórico de faturamento (VGV) — quanto todas as unidades da organização
// venderam, mês a mês, pra responder "o VGV está crescendo?".
//
// A aba tem senha própria (criada pelo dono), além do login e da permissão.
// Trancada, o servidor desenha só o cadeado e NÃO carrega número nenhum.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { exigirPermPage } from '@/lib/exigir-perm';
import {
  SENHA_MIN,
  VALIDADE_MS,
  organizacaoDaFilial,
  organizacoesDoUsuario,
} from '@/lib/faturamento-acesso';
import { PERM_HISTORICO, sessaoAcesso } from '@/lib/faturamento-acesso-sessao';
import { carregarHistorico, filiaisForaDoVgv, pendencias } from '@/lib/faturamento-historico';
import { chaveMes, faixasDeMeses, partesMes, rotuloMes, rotuloPeriodo } from '@/lib/faturamento-meses';
import { escolherFilial } from '@/lib/filial-ativa';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BarraAcesso, Cadeado, Cofre } from './acesso';
import { EventosCard, type EventoItem } from './eventos-card';
import { LancamentosGrid, type UnidadeGrade } from './lancamentos-grid';
import { Relatorio, listaNomes } from './relatorio';
import { AvisoPendencias, UnidadesCard, type ItemPendencia, type UnidadeItem } from './unidades';

export const dynamic = 'force-dynamic';

const ROTA = '/relatorios/historico-faturamento';

const PILL = 'rounded-md border px-3 py-1 text-xs';
const PILL_ATIVA = `${PILL} border-slate-900 bg-slate-900 text-white`;
const PILL_INATIVA = `${PILL} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

function horaBr(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/** 'HH:MM' enquanto a trava por senhas erradas estiver valendo. */
function travaAte(ate: Date | null): string | null {
  return ate && ate.getTime() > Date.now() ? horaBr(ate.getTime()) : null;
}

function Moldura({ email, children }: { email: string | undefined; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={email} />
      <section className="mx-auto max-w-7xl px-6 py-10">{children}</section>
    </main>
  );
}

export default async function HistoricoFaturamentoPage(props: {
  searchParams: Promise<{ filialId?: string; u?: string; ev?: string }>;
}) {
  const user = await exigirPermPage(PERM_HISTORICO);
  const sp = await props.searchParams;
  const filialIdUrl = typeof sp.filialId === 'string' ? sp.filialId : undefined;

  const filiais = await filiaisDoUsuario(user.id);
  const filial = await escolherFilial(filiais, filialIdUrl);
  const org = filial ? await organizacaoDaFilial(filial.id) : null;
  if (!org) {
    return (
      <Moldura email={user.email}>
        <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
      </Moldura>
    );
  }

  const [orgs, sessao] = await Promise.all([
    organizacoesDoUsuario(user.id),
    sessaoAcesso(org.id, user.id),
  ]);
  const dono = orgs.find((o) => o.id === org.id)?.dono === true;

  const titulo = (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Histórico de faturamento (VGV)</h1>
      <p className="mt-1 text-sm text-slate-600">
        {org.nome} — quanto todas as unidades venderam, mês a mês, e se está crescendo.
      </p>
    </div>
  );

  // Trancada: só o cadeado. Nada do histórico é lido do banco.
  if (sessao.abertaAte === null) {
    return (
      <Moldura email={user.email}>
        {titulo}
        <Cadeado
          organizacaoId={org.id}
          orgNome={org.nome}
          temSenha={sessao.temSenha}
          dono={dono}
          bloqueadaAte={travaAte(sessao.bloqueadoAte)}
          emailLogin={user.email ?? ''}
          senhaMin={SENHA_MIN}
          horasAberta={VALIDADE_MS / 3_600_000}
        />
      </Moldura>
    );
  }
  const abertaAte = sessao.abertaAte;

  const [h, foraDoVgv] = await Promise.all([carregarHistorico(org.id), filiaisForaDoVgv(org.id)]);
  const unidade = typeof sp.u === 'string' ? (h.unidades.find((u) => u.id === sp.u) ?? null) : null;
  const ids = unidade ? [unidade.id] : h.unidades.map((u) => u.id);
  const comEventos = sp.ev !== '0';
  const temEventos = h.lancamentos.some((l) => l.tipo === 'EXTRA' && ids.includes(l.unidadeId));
  const emBranco = pendencias(h).filter((p) => ids.includes(p.unidade.id));

  // O que os cartões de lançar e corrigir recebem: só dado simples (eles rodam
  // no navegador; o histórico inteiro não atravessa).
  const itensPendencia: ItemPendencia[] = emBranco.map((p) => ({
    unidadeId: p.unidade.id,
    nome: p.unidade.nome,
    meses: listaNomes(faixasDeMeses(p.meses).map((faixa) => rotuloPeriodo(faixa))),
    desde: p.blocoFinalDesde,
  }));
  const grade: UnidadeGrade[] = h.unidades.map((u) => {
    const valores: Record<string, number> = {};
    for (const [mes, c] of h.celulas.get(u.id) ?? []) {
      if (c.fonte === 'pdv' && c.base !== null) valores[mes] = c.base;
    }
    for (const l of h.lancamentos) {
      if (l.unidadeId !== u.id || l.tipo !== 'TOTAL') continue;
      const mes = chaveMes(l.ano, l.mes);
      if (!(mes in valores)) valores[mes] = l.valor;
    }
    return { id: u.id, nome: u.nome, pdvDesde: u.filialId !== null ? u.sistemaDesde : null, valores };
  });
  const nomeDaUnidade = new Map(h.unidades.map((u) => [u.id, u.nome]));
  const eventos: EventoItem[] = h.lancamentos
    .filter((l) => l.tipo === 'EXTRA')
    .map((l) => ({
      id: l.id,
      unidade: nomeDaUnidade.get(l.unidadeId) ?? '—',
      mes: chaveMes(l.ano, l.mes),
      valor: l.valor,
      observacao: l.observacao,
    }))
    .sort((a, b) => (a.mes < b.mes ? 1 : a.mes > b.mes ? -1 : 0));
  const unidadesDoVgv: UnidadeItem[] = h.unidades.map((u) => ({
    id: u.id,
    nome: u.nome,
    origem: u.filialId !== null && u.sistemaDesde ? `PDV desde ${rotuloMes(u.sistemaDesde)}` : 'Digitado mês a mês',
    encerradaDesde: u.encerradaDesde,
  }));
  // Só casa que o próprio usuário enxerga pode virar unidade com PDV.
  const filiaisLivres = foraDoVgv.filter((f) => filiais.some((x) => x.id === f.id));
  const anoMin = partesMes(h.primeiroMes).ano;
  const unidadeInicial = unidade?.id ?? emBranco[0]?.unidade.id ?? h.unidades[0]?.id ?? '';

  const link = (unidadeId: string | null, eventos: boolean): string => {
    const q = new URLSearchParams();
    if (filialIdUrl) q.set('filialId', filialIdUrl);
    if (unidadeId) q.set('u', unidadeId);
    if (!eventos) q.set('ev', '0');
    const s = q.toString();
    return s ? `${ROTA}?${s}` : ROTA;
  };

  return (
    <Moldura email={user.email}>
      <Cofre abertaAte={abertaAte}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          {titulo}
          <BarraAcesso
            organizacaoId={org.id}
            abertaAteRotulo={horaBr(abertaAte)}
            dono={dono}
            senhaMin={SENHA_MIN}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Unidade</span>
            <Link href={link(null, comEventos)} prefetch={false} className={unidade ? PILL_INATIVA : PILL_ATIVA}>
              Todas (VGV)
            </Link>
            {h.unidades.map((u) => (
              <Link
                key={u.id}
                href={link(u.id, comEventos)}
                prefetch={false}
                className={unidade?.id === u.id ? PILL_ATIVA : PILL_INATIVA}
              >
                {u.nome}
              </Link>
            ))}
          </div>
          {(temEventos || !comEventos) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Conta</span>
              <Link
                href={link(unidade?.id ?? null, true)}
                prefetch={false}
                className={comEventos ? PILL_ATIVA : PILL_INATIVA}
              >
                Com eventos e festas
              </Link>
              <Link
                href={link(unidade?.id ?? null, false)}
                prefetch={false}
                className={comEventos ? PILL_INATIVA : PILL_ATIVA}
              >
                Só operação
              </Link>
            </div>
          )}
        </div>

        <AvisoPendencias organizacaoId={org.id} itens={itensPendencia} />

        <div className="mt-6">
          <Relatorio
            h={h}
            ids={ids}
            comEventos={comEventos}
            unidade={unidade}
            rotuloUnidade={(u) => (
              <Link
                href={link(u.id, comEventos)}
                prefetch={false}
                className="font-medium text-slate-900 hover:text-sky-700 hover:underline"
              >
                {u.nome}
              </Link>
            )}
          />
        </div>

        <section id="lancar" className="mt-10 scroll-mt-6">
          <h2 className="text-lg font-semibold text-slate-900">Lançar e corrigir</h2>
          <p className="mt-1 text-sm text-slate-600">
            O que passa pelo PDV entra sozinho. Aqui você digita o resto: meses antigos, unidade sem sistema e
            eventos e festas. Salvou, o relatório acima já refaz a conta.
          </p>
          <div className="mt-4 space-y-6">
            {h.unidades.length > 0 && (
              <>
                <LancamentosGrid
                  key={unidade?.id ?? 'todas'}
                  organizacaoId={org.id}
                  unidades={grade}
                  anoMin={anoMin}
                  mesAtual={h.mesAtual}
                  unidadeInicial={unidadeInicial}
                />
                <EventosCard
                  key={`ev:${unidade?.id ?? 'todas'}`}
                  organizacaoId={org.id}
                  eventos={eventos}
                  unidades={h.unidades.map((u) => ({ id: u.id, nome: u.nome }))}
                  mesAtual={h.mesAtual}
                  anoMin={anoMin}
                  unidadeInicial={unidade?.id ?? h.unidades[0]?.id ?? ''}
                />
              </>
            )}
            <UnidadesCard
              organizacaoId={org.id}
              unidades={unidadesDoVgv}
              filiaisLivres={filiaisLivres}
              mesAtual={h.mesAtual}
              anoMin={anoMin}
            />
          </div>
        </section>

        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          Dados até hoje; {rotuloMes(h.mesAtual)} ainda está em andamento.
        </p>
      </Cofre>
    </Moldura>
  );
}
