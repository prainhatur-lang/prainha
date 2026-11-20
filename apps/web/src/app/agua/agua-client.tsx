'use client';

// Tela "Água do Prainha" (visualização). Atualiza sozinha a cada 30 s.

import { useEffect, useState } from 'react';
import type { AguaBomba, AguaEstado } from '@/lib/agua';

const INTERVALO_MS = 30_000;
const FUSO = 'America/Maceio';

const CAIXAS = [
  { chave: 'nivelTerrea', nome: 'Térrea', cap: 5000, nota: 'recebe dos poços e decanta' },
  { chave: 'nivelIntermediaria', nome: 'Intermediária', cap: 10000, nota: 'irrigação' },
  { chave: 'nivelSuperior', nome: 'Superior', cap: 10000, nota: 'consumo do restaurante' },
] as const;

const litros = (pct: number | null, cap: number) =>
  pct == null ? '—' : Math.round((pct * cap) / 100).toLocaleString('pt-BR');

const TOM = {
  ok: { texto: 'text-emerald-700', borda: 'border-emerald-600', faixa: 'border-l-emerald-600' },
  aviso: { texto: 'text-amber-700', borda: 'border-amber-500', faixa: 'border-l-amber-500' },
  critico: { texto: 'text-red-700', borda: 'border-red-600', faixa: 'border-l-red-600' },
  fraco: { texto: 'text-slate-500', borda: 'border-slate-200', faixa: 'border-l-slate-300' },
} as const;
type Tom = keyof typeof TOM;

function estadoBomba(b: AguaBomba, amp: number | null, correnteZero: number): [Tom, string] {
  if (b.falha) return ['critico', 'Desarmada'];
  if ((amp ?? 0) > correnteZero) return ['ok', 'Ligada'];
  if (!b.liberada) return ['aviso', 'Bloqueada'];
  return ['fraco', 'Parada'];
}

export function AguaClient({ inicial }: { inicial: AguaEstado | null }) {
  const [estado, setEstado] = useState<AguaEstado | null>(inicial);
  const [agora, setAgora] = useState<number | null>(null);

  useEffect(() => {
    setAgora(Date.now());
    let cancel = false;
    async function carregar() {
      try {
        const r = await fetch('/api/agua/estado', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (cancel) return;
        setEstado(d?.estado ?? null);
        setAgora(Date.now());
      } catch {
        /* mantém o que já está na tela */
      }
    }
    const t = setInterval(carregar, INTERVALO_MS);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, []);

  if (!estado) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Água do Prainha</h1>
        <p className="mt-2 text-sm text-slate-500">O controle da água não está instalado neste sistema.</p>
      </section>
    );
  }

  const { leitura, bombas, alarmes, config } = estado;
  const correnteZero = config.corrente_zero ?? 0.3;
  const superiorCritico = config.superior_critico ?? 20;
  const maxTentativas = config.max_tentativas ?? 3;
  const semLeitura = !leitura;
  const criticos = alarmes.some((a) => a.gravidade === 'critico');
  const idadeMin = leitura && agora ? (agora - new Date(leitura.criadoEm).getTime()) / 60_000 : null;

  const tomGeral: Tom = semLeitura ? 'fraco' : alarmes.length ? (criticos ? 'critico' : 'aviso') : 'ok';
  const tituloGeral = semLeitura
    ? 'Aguardando a instalação do quadro'
    : alarmes.length
      ? criticos
        ? 'Atenção: há problema no sistema'
        : 'Avisos'
      : 'Tudo funcionando';

  // null = ainda não dá pra saber (quadro sem leitura)
  const checklist: [string, boolean | null][] = [
    ['Leituras chegando (menos de 5 min)', semLeitura ? null : idadeMin != null && idadeMin < 5],
    [
      `Caixa superior acima de ${superiorCritico}%`,
      leitura?.nivelSuperior == null ? null : leitura.nivelSuperior >= superiorCritico,
    ],
    [
      'Válvulas V1 e V2 (pelo menos uma aberta)',
      semLeitura || (leitura.v1Aberta == null && leitura.v2Aberta == null)
        ? null
        : !!(leitura.v1Aberta || leitura.v2Aberta),
    ],
    ['Bombas sem falha', bombas.every((b) => !b.falha)],
    ['Todas as bombas em automático e liberadas', bombas.every((b) => b.modo === 'auto' && b.liberada)],
  ];

  const valvula = (v: boolean | null | undefined) => (v == null ? '—' : v ? 'aberta' : 'fechada');
  const pressao = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR'));

  return (
    <section className="mx-auto grid max-w-5xl gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Água do Prainha</h1>
        <p className="text-sm text-slate-500">
          Caixas, bombas dos poços e de recalque. Cópia do servidor da loja, atualizada a cada minuto — na loja a
          tela Água funciona mesmo sem internet.
        </p>
      </div>

      <div className={`rounded-xl border bg-white p-4 ${TOM[tomGeral].borda}`}>
        <div className={`text-xl font-semibold ${TOM[tomGeral].texto}`}>{tituloGeral}</div>
        {semLeitura && (
          <p className="mt-1 text-sm text-slate-600">
            Nenhuma leitura chegou ainda. Os níveis, as pressões e a corrente das bombas aparecem aqui quando a placa
            do quadro estiver gravando no servidor da loja. Até lá nenhum aviso é disparado.
          </p>
        )}
        {alarmes.map((a) => (
          <div key={a.id} className="mt-2 text-sm text-slate-800">
            <b className={a.gravidade === 'critico' ? 'text-red-700' : 'text-amber-700'}>{a.titulo}.</b> {a.detalhe}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Caixas</h2>
        <div className="grid grid-cols-3 gap-3">
          {CAIXAS.map((c) => {
            const pct = leitura ? leitura[c.chave] : null;
            const altura = Math.max(0, Math.min(100, pct ?? 0));
            return (
              <div key={c.nome} className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{c.nome}</div>
                <div className="relative mt-1.5 h-36 overflow-hidden rounded-b-xl border-2 border-t-0 border-slate-500 bg-sky-100">
                  <div className="absolute inset-x-0 bottom-0 bg-sky-500" style={{ height: `${altura}%` }} />
                  <div className="absolute inset-x-0 top-2 text-center text-2xl font-semibold text-slate-900">
                    {pct == null ? '—' : `${Math.round(pct)}%`}
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {litros(pct, c.cap)} de {c.cap.toLocaleString('pt-BR')} L
                </div>
                <div className="hidden text-xs text-slate-400 sm:block">{c.nota}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-sm text-slate-500">
          V1 térrea {valvula(leitura?.v1Aberta)} · V2 irrigação {valvula(leitura?.v2Aberta)} · Pressão nos filtros:{' '}
          {pressao(leitura?.pressao1)} / {pressao(leitura?.pressao2)} / {pressao(leitura?.pressao3)} bar
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Bombas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {bombas.map((b) => {
            const amp = leitura?.correntes[b.id] ?? null;
            const [tom, rotulo] = semLeitura ? (['fraco', 'Sem leitura'] as [Tom, string]) : estadoBomba(b, amp, correnteZero);
            return (
              <div key={b.id} className={`rounded-lg border border-l-4 border-slate-200 p-3 ${TOM[tom].faixa}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-slate-900">{b.nome}</b>
                  <span className={`text-sm font-semibold ${TOM[tom].texto}`}>{rotulo}</span>
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {amp == null ? '—' : amp.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} A
                </div>
                <div className="text-xs text-slate-500">
                  Fases {b.fases ?? '—'} · chave em{' '}
                  {b.modo === 'auto' ? 'Automático' : b.modo === 'manual' ? 'Manual' : '0'}
                  {b.falha ? ` · ${b.falha.replace(/_/g, ' ')}, tentativa ${b.tentativas} de ${maxTentativas}` : ''}
                </div>
                {!b.temDisjuntor && <div className="mt-1 text-xs text-amber-700">Disjuntor inteligente ainda não cadastrado</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Checklist do sistema</h2>
        {checklist.map(([nome, ok]) => (
          <div key={nome} className="flex gap-3 border-b border-slate-100 py-1.5 text-sm text-slate-800">
            <b className={`w-20 shrink-0 ${ok == null ? 'text-slate-400' : ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {ok == null ? 'Sem leitura' : ok ? 'OK' : 'Problema'}
            </b>
            {nome}
          </div>
        ))}
        <div className="mt-2 text-xs text-slate-500">
          Última leitura:{' '}
          {leitura ? new Date(leitura.criadoEm).toLocaleString('pt-BR', { timeZone: FUSO }) : 'nenhuma ainda'}
        </div>
      </div>
    </section>
  );
}
