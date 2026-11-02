'use client';

// "Monte o seu plano" do /conheca: o cliente marca só os módulos que quer e vê o
// preço do mês. Se um pacote sair mais barato que avulso, mostra o pacote.
// Preços = tabela de 02/11/2026 (mesma do page.tsx).

import { useState } from 'react';

const FAIXAS = [
  { v: 0, t: '1 maquininha', base: 199 },
  { v: 1, t: '2 a 5', base: 199 },
  { v: 2, t: '6 a 10', base: 349 },
  { v: 3, t: '11 a 20', base: 549 },
];

const MODS: { k: string; t: string; d: string; preco: number }[] = [
  { k: 'fiscal', t: 'Fiscal', d: 'NFC-e, NF-e e nota de compra', preco: 99 },
  { k: 'retaguarda', t: 'Retaguarda', d: 'Estoque, cotação e custo do prato', preco: 149 },
  { k: 'financeiro', t: 'Financeiro', d: 'Contas, conciliação e caixa', preco: 149 },
  { k: 'delivery', t: 'Delivery', d: 'iFood e site de delivery', preco: 99 },
  { k: 'relacionamento', t: 'Relacionamento', d: 'Reservas, VIP e avaliações', preco: 129 },
  { k: 'rh', t: 'Equipe (RH)', d: 'Escala, ponto e folha', preco: 99 },
  { k: 'atendimento', t: 'Atendimento virtual', d: 'Atendente no WhatsApp', preco: 249 },
];

// Pacote = base + módulos com desconto. Preço por faixa (1–5, 6–10, 11–20).
const PACOTES: { k: string; t: string; mods: string[]; precos: number[] }[] = [
  { k: 'essencial', t: 'Essencial', mods: ['fiscal'], precos: [279, 429, 629] },
  { k: 'gestao', t: 'Gestão', mods: ['fiscal', 'retaguarda', 'financeiro'], precos: [499, 649, 849] },
  { k: 'completo', t: 'Completo', mods: MODS.map((m) => m.k), precos: [699, 849, 1049] },
];

const brl = (n: number) => n.toLocaleString('pt-BR');

export function MontePlano() {
  const [faixa, setFaixa] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [func, setFunc] = useState(10);

  const toggle = (k: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const idx = faixa <= 1 ? 0 : faixa - 1; // índice no preço dos pacotes
  const base = FAIXAS[faixa]!.base;
  const extraRh = sel.has('rh') ? 5 * Math.max(0, func) : 0;
  const avulso = base + MODS.filter((m) => sel.has(m.k)).reduce((a, m) => a + m.preco, 0) + extraRh;

  // Menor pacote que cobre o que foi marcado e sai mais barato que avulso.
  const pacote = PACOTES.filter((p) => [...sel].every((k) => p.mods.includes(k)))
    .map((p) => ({ ...p, total: p.precos[idx]! + extraRh }))
    .filter((p) => p.total < avulso)
    .sort((a, b) => a.total - b.total)[0];

  const total = pacote ? pacote.total : avulso;
  const gratis = faixa === 0 && sel.size === 0;
  const planoForm = gratis ? 'gratis' : pacote ? pacote.k : 'nao_sei';

  return (
    <div className="mt-6 grid gap-5 rounded-2xl bg-white p-5 ring-1 ring-black/5 sm:p-6 lg:grid-cols-[1fr_300px]">
      <div>
        <p className="text-sm font-semibold">Quantas maquininhas?</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FAIXAS.map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFaixa(f.v)}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold ring-1 ${
                faixa === f.v ? 'bg-[#0f2a33] text-white ring-[#0f2a33]' : 'bg-white ring-black/15 hover:bg-[#f6f4ef]'
              }`}
            >
              {f.t}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold">
          Base (sempre incluída): <span className="font-normal text-[#5a6878]">garçom, caixa, cozinha na tela e cardápio no QR</span>
        </p>
        <p className="mt-4 text-sm font-semibold">Some só o que precisar:</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {MODS.map((m) => {
            const on = sel.has(m.k);
            return (
              <label
                key={m.k}
                className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ${
                  on ? 'bg-[#e2f2f3] ring-[#0b7a83]/50' : 'ring-black/10 hover:bg-[#f6f4ef]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(m.k)}
                  className="mt-1 h-4 w-4 accent-[#0b7a83]"
                />
                <span className="flex-1">
                  <span className="flex justify-between gap-2 text-[15px] font-semibold">
                    {m.t}
                    <span className="whitespace-nowrap text-[#0b7a83]">+R$ {m.preco}</span>
                  </span>
                  <span className="block text-[13px] text-[#5a6878]">{m.d}</span>
                </span>
              </label>
            );
          })}
        </div>
        {sel.has('rh') && (
          <label className="mt-3 flex items-center gap-3 text-sm font-semibold">
            Funcionários
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={func}
              onChange={(e) => setFunc(Number(e.target.value) || 0)}
              className="w-24 rounded-lg border border-black/15 px-3 py-2 text-[16px]"
            />
            <span className="font-normal text-[#5a6878]">R$ 5 cada</span>
          </label>
        )}
      </div>

      <div className="flex flex-col rounded-xl bg-[#0f2a33] p-5 text-white">
        <p className="text-sm text-white/70">Seu plano por mês</p>
        {gratis ? (
          <>
            <p className="mt-1 text-4xl font-bold">R$ 0</p>
            <p className="mt-2 text-sm text-white/80">
              Plano Grátis: 1 maquininha, até R$ 20 mil vendidos por mês. Acima disso, R$ 199.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-4xl font-bold tabular-nums">R$ {brl(total)}</p>
            {pacote ? (
              <p className="mt-2 text-sm text-[#f2b134]">
                No pacote {pacote.t} sai R$ {brl(avulso - total)} mais barato que avulso.
              </p>
            ) : (
              <p className="mt-2 text-sm text-white/70">Base R$ {base}{sel.size > 0 ? ' + módulos' : ''}.</p>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-white/60">
          Implantação assistida é opcional (R$ 500, uma vez).
        </p>
        <a
          href={`?plano=${planoForm}#comecar`}
          className="mt-auto block rounded-lg bg-[#f2b134] px-4 py-3 text-center font-semibold text-[#1b2430] hover:bg-[#f5c158] max-lg:mt-5"
        >
          {gratis ? 'Começar grátis' : 'Quero esse plano'}
        </a>
      </div>
    </div>
  );
}
