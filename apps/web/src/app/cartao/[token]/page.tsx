// Cartão fidelidade do cliente — página pública (sem login); o token do link
// é a senha do cartão. Mostra nível, código de uso único e os botões da
// Apple Wallet / Google Wallet.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { vistaCartao } from '@/lib/fidelidade/vista';
import { appleConfigurada } from '@/lib/fidelidade/apple';
import { googleConfigurada } from '@/lib/fidelidade/google';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cartão Prainha',
  robots: { index: false, follow: false },
};

export default async function CartaoPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!token || token.length < 16) notFound();
  const [c] = await db.select().from(schema.fidelidadeCartao).where(eq(schema.fidelidadeCartao.token, token)).limit(1);
  if (!c) notFound();
  if (!c.abertoEm) {
    await db.update(schema.fidelidadeCartao).set({ abertoEm: new Date() }).where(eq(schema.fidelidadeCartao.id, c.id));
  }
  const v = await vistaCartao(c);
  const pctHoje = v.pct + v.bonusHoje;
  const progresso = v.proximo
    ? Math.min(100, Math.round((v.visitas / (v.visitas + v.faltam || 1)) * 100))
    : 100;

  return (
    <main className="min-h-screen bg-[#f4efe6] px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-sm space-y-5">
        <div
          className="relative overflow-hidden rounded-2xl p-5 text-white shadow-xl"
          style={{ background: `linear-gradient(135deg, ${v.cor} 0%, ${v.cor}dd 60%, #00000055 140%)`, aspectRatio: '1.586' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fidelidade/sereia-branca.png" alt="" className="absolute -right-6 bottom-2 w-44 opacity-20" />
          <div className="flex items-start justify-between">
            <div className="text-lg font-bold tracking-wide">Prainha</div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest opacity-70">Nível</div>
              <div className="text-lg font-semibold">{v.nivel}</div>
            </div>
          </div>
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-widest opacity-70">Código pro Pix</div>
            <div className="font-mono text-4xl font-bold tracking-[0.3em]">{v.bloqueado ? '----' : v.codigo}</div>
          </div>
          <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between text-sm">
            <div>
              <div className="font-medium">{v.nome}</div>
              <div className="font-mono text-xs opacity-70">{v.numero}</div>
            </div>
            <div className="text-right text-2xl font-bold">{pctHoje}%</div>
          </div>
        </div>

        {v.bloqueado ? (
          <p className="rounded-lg bg-red-100 p-3 text-sm text-red-800">Este cartão está bloqueado. Fale com a gerência.</p>
        ) : (
          <div className="rounded-xl bg-white p-4 text-sm shadow-sm">
            <p>
              Hoje seu desconto é de <b>{pctHoje}%</b> no consumo
              {v.bonusHoje > 0 ? <> (inclui +{v.bonusHoje}% de dia de semana)</> : null}.
              Na hora de pagar no <b>Pix</b>, digite o código <b className="font-mono">{v.codigo}</b>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              O código muda depois de cada uso — a Wallet atualiza sozinha. 1 uso por dia, nas 3 casas.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          {appleConfigurada() && (
            <a
              href={`/api/wallet/apple/pass/${token}`}
              className="flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 font-medium text-white"
            >
              Adicionar à Apple Wallet
            </a>
          )}
          {googleConfigurada() && (
            <a
              href={`/api/wallet/google/${token}`}
              className="flex items-center justify-center gap-2 rounded-xl bg-[#1a73e8] px-4 py-3 font-medium text-white"
            >
              Salvar no Google Wallet
            </a>
          )}
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{v.visitas} visita{v.visitas === 1 ? '' : 's'} nos últimos {v.janelaDias} dias</span>
            <span className="text-xs text-slate-500">{v.textoProximo}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${progresso}%`, background: v.cor }} />
          </div>
          {v.garantido && (
            <p className="mt-2 text-xs text-slate-500">Nível {v.nivel} garantido por convite.</p>
          )}
          <ul className="mt-4 space-y-1.5 text-sm">
            {v.niveis.map((n) => (
              <li key={n.nome} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: n.cor }} />
                  <span className={n.nome === v.nivel ? 'font-semibold' : ''}>{n.nome}</span>
                  <span className="text-xs text-slate-400">{n.minVisitas === 0 ? 'entrada' : `${n.minVisitas}+ visitas`}</span>
                </span>
                <span className="font-medium">
                  {n.pct}%{v.bonusDiaUtil ? <span className="text-xs text-slate-500"> · {n.pct + v.bonusDiaUtil}% seg–sex</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="px-2 text-center text-xs text-slate-500">
          Vale no Prainha Bar, Tabuará e Prainha Mar, pagando no Pix. O desconto é sobre o consumo; a taxa de serviço
          continua sobre o valor cheio. Dias úteis = segunda a sexta, fora feriado.
        </p>
      </div>
    </main>
  );
}
