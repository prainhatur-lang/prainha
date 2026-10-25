'use client';

import { useState } from 'react';

export interface TemaCasa {
  fundo: string;
  fundo2: string;
  texto: string;
  suave: string;
  destaque: string;
  destaqueTexto: string;
  cartao: string;
  cartaoTexto: string;
  escuro: boolean;
  frase: string;
  imagem: string | null;
  selo: string | null;
}

const VALORES = [100, 150, 200, 300, 500];
const serif = { fontFamily: 'var(--font-serif-vp)' };
const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2 });

function mascaraFone(s: string): string {
  const d = s.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function PresentearClient(p: {
  casa: string;
  nomeCasa: string;
  site: string;
  tema: TemaCasa;
  minimo: number;
  maximo: number;
}) {
  const t = p.tema;
  const [valor, setValor] = useState<number>(200);
  const [outro, setOutro] = useState(false);
  const [outroTxt, setOutroTxt] = useState('');
  const [para, setPara] = useState('');
  const [de, setDe] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [fone, setFone] = useState('');
  const [isca, setIsca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valorFinal = outro ? Number(outroTxt.replace(/\./g, '').replace(',', '.')) || 0 : valor;
  const valorOk = valorFinal >= p.minimo && valorFinal <= p.maximo;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!valorOk) return setErro(`Escolha um valor entre ${brl(p.minimo)} e ${brl(p.maximo)}.`);
    if (para.trim().length < 2) return setErro('Diga pra quem é o presente.');
    if (de.trim().length < 2) return setErro('Diga seu nome.');
    if (fone.replace(/\D/g, '').length < 10) return setErro('Informe seu WhatsApp com DDD.');
    setEnviando(true);
    try {
      const r = await fetch('/api/presentear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          casa: p.casa,
          valor: valorFinal,
          presenteados: para,
          compradorNome: de,
          compradorTelefone: fone,
          mensagem,
          site: isca,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) {
        setErro(d.error ?? 'Não deu certo agora — tente de novo.');
        setEnviando(false);
        return;
      }
      window.location.href = `/presente/${d.token}`;
    } catch {
      setErro('Sem conexão — tente de novo.');
      setEnviando(false);
    }
  }

  const campo = {
    background: t.escuro ? 'rgba(255,255,255,0.04)' : '#FFFFFF',
    borderColor: t.escuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
    color: t.texto,
  };

  return (
    <main
      className="min-h-screen antialiased [font-family:var(--font-sans-vp)]"
      style={{ background: t.fundo, color: t.texto }}
    >
      {/* Topo */}
      <section className="relative overflow-hidden" style={{ background: t.fundo2 }}>
        {t.imagem && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.imagem} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${t.fundo}aa, ${t.fundo})` }} />
          </>
        )}
        {!t.imagem && (
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-2xl"
            style={{ background: t.destaque }}
          />
        )}
        <div className="relative mx-auto max-w-5xl px-4 pb-10 pt-10 text-center sm:px-8 sm:pt-16">
          <a href={p.site} className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.35em]" style={{ color: t.destaque }}>
            {t.selo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.selo} alt="" className="h-7 w-7" />
            )}
            {p.nomeCasa}
          </a>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl leading-tight sm:text-6xl" style={serif}>
            Dê um presente para <span className="italic" style={{ color: t.destaque }}>quem você ama</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed" style={{ color: t.suave }}>
            {t.frase} Escolha o valor, escreva um cartão e pague no Pix — o vale chega na hora, pronto pra encaminhar.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 pb-20 pt-6 sm:px-8 md:grid-cols-[1fr_1.1fr] md:items-start">
        {/* Cartão (prévia ao vivo) */}
        <div className="md:sticky md:top-6">
          <div
            className="relative aspect-[1.6/1] w-full overflow-hidden rounded-2xl p-6 shadow-2xl sm:p-7"
            style={{ background: t.cartao, color: t.cartaoTexto }}
          >
            <div
              className="pointer-events-none absolute -bottom-16 -right-10 h-48 w-48 rounded-full opacity-20"
              style={{ border: `18px solid ${t.cartaoTexto}` }}
            />
            <div className="flex items-start justify-between">
              <span className="text-[11px] uppercase tracking-[0.3em] opacity-90">Vale-presente</span>
              <span className="text-2xl" aria-hidden>
                🎁
              </span>
            </div>
            <div className="mt-3 text-sm opacity-90" style={serif}>
              {p.nomeCasa}
            </div>
            <div className="mt-4 text-4xl font-semibold sm:text-5xl" style={serif}>
              {valorOk ? brl(valorFinal) : 'R$ —'}
            </div>
            <div className="absolute inset-x-6 bottom-5 flex items-end justify-between gap-3 text-sm sm:inset-x-7">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.25em] opacity-75">Para</div>
                <div className="truncate text-base" style={serif}>
                  {para.trim() || 'Quem você ama'}
                </div>
              </div>
              <div className="min-w-0 text-right">
                <div className="text-[10px] uppercase tracking-[0.25em] opacity-75">De</div>
                <div className="truncate text-base" style={serif}>
                  {de.trim() || 'Você'}
                </div>
              </div>
            </div>
          </div>
          {mensagem.trim() && (
            <p
              className="mt-4 whitespace-pre-line rounded-xl px-5 py-4 text-[15px] italic leading-relaxed"
              style={{ ...serif, background: t.fundo2, color: t.texto }}
            >
              “{mensagem.trim()}”
            </p>
          )}
          <ul className="mt-6 space-y-2 text-sm" style={{ color: t.suave }}>
            <li>✓ Vale como crédito em tudo da casa: comida, bebida e os 10%.</li>
            <li>✓ Pagou, o vale aparece na hora com o código — é só encaminhar o link.</li>
            <li>✓ Quer o cartão impresso? Avise na chegada: a gente imprime com a sua mensagem.</li>
          </ul>
        </div>

        {/* Formulário */}
        <form onSubmit={enviar} className="space-y-6">
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: t.destaque }}>
              1 · Escolha o valor
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {VALORES.map((v) => {
                const ativo = !outro && valor === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setOutro(false);
                      setValor(v);
                    }}
                    className="rounded-xl border px-2 py-3.5 text-lg font-semibold transition"
                    style={
                      ativo
                        ? { background: t.destaque, borderColor: t.destaque, color: t.destaqueTexto }
                        : campo
                    }
                  >
                    {brl(v)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setOutro(true)}
                className="rounded-xl border px-2 py-3.5 text-base font-semibold transition"
                style={outro ? { background: t.destaque, borderColor: t.destaque, color: t.destaqueTexto } : campo}
              >
                Outro valor
              </button>
            </div>
            {outro && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border px-4" style={campo}>
                <span style={{ color: t.suave }}>R$</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={outroTxt}
                  onChange={(e) => setOutroTxt(e.target.value.replace(/[^\d,.]/g, ''))}
                  placeholder={`de ${p.minimo} a ${p.maximo.toLocaleString('pt-BR')}`}
                  className="w-full bg-transparent py-3.5 text-lg outline-none"
                />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: t.destaque }}>
              2 · O cartão
            </div>
            <input
              value={para}
              onChange={(e) => setPara(e.target.value)}
              maxLength={120}
              placeholder="Para quem é o presente? (ex.: Ana e Pedro)"
              className="w-full rounded-xl border px-4 py-3.5 outline-none"
              style={campo}
            />
            <input
              value={de}
              onChange={(e) => setDe(e.target.value)}
              maxLength={120}
              placeholder="Seu nome"
              className="w-full rounded-xl border px-4 py-3.5 outline-none"
              style={campo}
            />
            <textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Mensagem do cartão (opcional) — ex.: Feliz aniversário! Aproveitem a noite ❤"
              className="w-full resize-none rounded-xl border px-4 py-3.5 outline-none"
              style={campo}
            />
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: t.destaque }}>
              3 · Seu WhatsApp
            </div>
            <input
              value={fone}
              onChange={(e) => setFone(mascaraFone(e.target.value))}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(79) 99999-9999"
              className="w-full rounded-xl border px-4 py-3.5 outline-none"
              style={campo}
            />
            <p className="text-xs" style={{ color: t.suave }}>
              Só pra gente falar com você se precisar. O vale chega nesta tela, logo depois do Pix.
            </p>
            {/* Isca de robô: escondida de gente. */}
            <input
              tabIndex={-1}
              autoComplete="off"
              value={isca}
              onChange={(e) => setIsca(e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
              aria-hidden
              name="site"
            />
          </div>

          {erro && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600">{erro}</p>}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-full px-6 py-4 text-lg font-semibold shadow-lg transition hover:opacity-90 disabled:opacity-60"
            style={{ background: t.destaque, color: t.destaqueTexto }}
          >
            {enviando ? 'Gerando o Pix…' : `Presentear com ${valorOk ? brl(valorFinal) : 'o vale'} · pagar no Pix`}
          </button>
          <p className="text-center text-xs" style={{ color: t.suave }}>
            Pagamento por Pix. Sem cadastro, sem senha.
          </p>
        </form>
      </div>

      <footer className="pb-10 text-center text-xs" style={{ color: t.suave }}>
        <a href={p.site} className="hover:underline">
          ← Voltar para {p.nomeCasa}
        </a>
      </footer>
    </main>
  );
}
