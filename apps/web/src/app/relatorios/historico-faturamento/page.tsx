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
import { carregarHistorico, pendencias } from '@/lib/faturamento-historico';
import { faixasDeMeses, rotuloMes, rotuloPeriodo } from '@/lib/faturamento-meses';
import { escolherFilial } from '@/lib/filial-ativa';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BarraAcesso, Cadeado, Cofre } from './acesso';
import { Relatorio, listaNomes } from './relatorio';

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

  const h = await carregarHistorico(org.id);
  const unidade = typeof sp.u === 'string' ? (h.unidades.find((u) => u.id === sp.u) ?? null) : null;
  const ids = unidade ? [unidade.id] : h.unidades.map((u) => u.id);
  const comEventos = sp.ev !== '0';
  const temEventos = h.lancamentos.some((l) => l.tipo === 'EXTRA' && ids.includes(l.unidadeId));
  const emBranco = pendencias(h).filter((p) => ids.includes(p.unidade.id));

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

        {emBranco.length > 0 && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Meses sem número lançado</p>
            <ul className="mt-1 space-y-0.5">
              {emBranco.map((p) => (
                <li key={p.unidade.id}>
                  <b className="font-medium">{p.unidade.nome}:</b>{' '}
                  {listaNomes(faixasDeMeses(p.meses).map((faixa) => rotuloPeriodo(faixa)))}.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-800">
              Enquanto estiverem em branco, esses meses ficam fora da comparação — dos dois lados.
            </p>
          </div>
        )}

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

        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          Dados até hoje; {rotuloMes(h.mesAtual)} ainda está em andamento.
        </p>
      </Cofre>
    </Moldura>
  );
}
