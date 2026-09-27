// Cartão "Cliente VIP <casa>" — página pública (sem login). O token do link
// abre o cartão (nível, benefícios, Wallet), mas o CÓDIGO de desconto só sai
// no celular confirmado pelo WhatsApp do número do cartão: link encaminhado pra
// outra pessoa não gera desconto.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { vistaCartao } from '@/lib/fidelidade/vista';
import { appleConfigurada } from '@/lib/fidelidade/apple';
import { googleConfigurada } from '@/lib/fidelidade/google';
import { carregarPrograma } from '@/lib/fidelidade/config';
import { ApresentacaoPrograma } from '@/components/fidelidade/apresentacao';
import { BotoesAdesao, VouPagar } from './adesao';
import { aparelhoConfirmado, nomeCookie, telefoneMascarado } from '@/lib/fidelidade/aparelho';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cliente VIP',
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
  const confirmado = !!aparelhoConfirmado(c, (await cookies()).get(nomeCookie(c))?.value);
  const tel = telefoneMascarado(c.telefone);

  // Convite ainda não aceito: apresenta o programa e pede a adesão. O código
  // e a Wallet só aparecem depois do "Quero meu cartão".
  if (!c.aderidoEm && !v.bloqueado) {
    const { config: cfg } = await carregarPrograma(c.filialId);
    const primeiro = c.nome.trim().split(/\s+/)[0] || '';
    return (
      <main className="min-h-screen bg-[#f4efe6] px-4 py-8 text-slate-900">
        <div className="mx-auto w-full max-w-sm space-y-5">
          <div
            className="relative overflow-hidden rounded-2xl p-5 text-white shadow-xl"
            style={{ background: `linear-gradient(135deg, ${v.cor} 0%, ${v.cor}dd 60%, #00000055 140%)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fidelidade/sereia-branca.png" alt="" className="absolute -right-6 -bottom-4 w-40 opacity-20" />
            <div className="text-xs uppercase tracking-widest opacity-80">Convite</div>
            <h1 className="mt-1 text-2xl font-bold leading-tight">
              {primeiro ? `${primeiro}, ` : ''}você agora é {v.marca} {v.nivel}
            </h1>
            <p className="mt-2 text-sm opacity-90">
              Você é cliente do {v.casa} e a gente quer te ver mais vezes. Ative e ganhe {v.pct}% de desconto no Pix
              {v.bonusDiaUtil ? <> ({v.pct + v.bonusDiaUtil}% de segunda a sexta)</> : null} já na próxima visita.
            </p>
            {v.garantido && (
              <p className="mt-2 text-xs opacity-80">Categoria {v.nivel} garantida pra você pelo convite.</p>
            )}
          </div>
          <BotoesAdesao token={token} recusado={!!c.recusadoEm} telefone={tel} />
          <ApresentacaoPrograma cfg={cfg} destaque={v.nivelCodigo} casa={v.casa} />
        </div>
      </main>
    );
  }

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
            <div>
              <div className="text-[10px] uppercase tracking-widest opacity-70">Cliente VIP</div>
              <div className="text-lg font-bold tracking-wide">{v.casa}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest opacity-70">Nível</div>
              <div className="text-lg font-semibold">{v.nivel}</div>
            </div>
          </div>
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-widest opacity-70">Desconto no Pix</div>
            <div className="text-2xl font-bold">{v.bloqueado ? 'Bloqueado' : v.textoDesconto}</div>
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
          <>
            <VouPagar token={token} confirmado={confirmado} telefone={tel} pctHoje={pctHoje} />
            <div className="rounded-xl bg-white p-4 text-sm shadow-sm">
              <p>
                Hoje seu desconto é de <b>{pctHoje}%</b> no consumo
                {v.bonusHoje > 0 ? <> (inclui +{v.bonusHoje}% de dia de semana)</> : null}, pagando no <b>Pix</b>.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Na hora de pagar, toque em &quot;Vou pagar agora&quot; e digite o código na tela do Pix. Ele vale 10
                minutos, uma vez só, e só é gerado no seu celular — o cartão é pessoal. 1 uso por dia, só no {v.casa}.
              </p>
            </div>
          </>
        )}

        {!v.bloqueado && (v.prioridadeReserva || v.pctEspaco > 0) && (
          <div className="rounded-xl bg-white p-4 text-sm shadow-sm">
            <div className="font-medium">Seus benefícios {v.nivel}</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              {v.prioridadeReserva && <li>✓ Prioridade nas reservas (reserve com este telefone)</li>}
              {v.pctEspaco > 0 && <li>✓ {v.pctEspaco}% de desconto no aluguel de espaço pra eventos</li>}
            </ul>
            <a href="/cartao-prainha" className="mt-2 inline-block text-xs text-[#0F3A5F] underline">Ver o programa completo</a>
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
          Vale só no {v.casa}, pagando no Pix (cada casa do grupo tem o seu Cliente VIP). O desconto é sobre o consumo; a taxa de serviço
          continua sobre o valor cheio. Dias úteis = segunda a sexta, fora feriado.
        </p>
      </div>
    </main>
  );
}
