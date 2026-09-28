'use client';

// "Entra 1 garrafa — essa garrafa tem quantos ml?"
//
// A compra entra por embalagem (garrafa, galão, pacote, caixa) e o estoque anda
// em ml/g. O tamanho muda de compra pra compra — o vinagre pode vir em meio
// litro ou em 1 litro, o gin em 750 ou em 1 L —, então em vez de pedir um
// "fator ×1000" (que ninguém entende e, errado, estraga o estoque), a tela
// pergunta com palavras e mostra a conta pronta:
//   1 CX = 6 garrafas de 750 ml  →  12 CX entram 54.000 ml no estoque.
// O valor devolvido é o mesmo fator de sempre (ml/g por unidade da nota).

import { useEffect, useState } from 'react';

type Unidade = 'ml' | 'l' | 'g' | 'kg' | 'un' | string;

const TAMANHOS: Record<'ml' | 'g', { rotulo: string; valor: number }[]> = {
  ml: [
    { rotulo: '350 ml', valor: 350 },
    { rotulo: '500 ml (meio litro)', valor: 500 },
    { rotulo: '750 ml', valor: 750 },
    { rotulo: '1 litro', valor: 1000 },
    { rotulo: '5 litros', valor: 5000 },
  ],
  g: [
    { rotulo: '500 g', valor: 500 },
    { rotulo: '1 kg', valor: 1000 },
    { rotulo: '2 kg', valor: 2000 },
    { rotulo: '5 kg', valor: 5000 },
  ],
};

const EMBALAGENS = ['garrafa', 'galão', 'lata', 'pacote', 'pote', 'unidade'];

/** Unidade da nota que costuma ser um volume com várias dentro (caixa, fardo). */
function ehAgrupada(u: string): boolean {
  return /^(cx|caixa|fd|fardo|pct|pc|pac|dz|duzia|kit|emb|sc|saco)\b/i.test(u.trim());
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** ml/g → unidade do estoque (l/kg dividem por 1000). */
function paraEstoque(tamanhoPequeno: number, estoque: Unidade): number {
  return estoque === 'l' || estoque === 'kg' ? tamanhoPequeno / 1000 : tamanhoPequeno;
}

export function ConversaoEmbalagem({
  unidadeCompra,
  unidadeEstoque,
  fatorInicial,
  qtdCompra,
  onChange,
  embalagemInicial,
  mostrarCaixa,
}: {
  /** Como vem na nota/fornecedor: "UN", "CX", "GF", "garrafa"… */
  unidadeCompra: string;
  /** Unidade do estoque do insumo: ml, l, g, kg, un. */
  unidadeEstoque: Unidade;
  fatorInicial: number | null;
  /** Quantidade da nota, pra mostrar o total que entra. */
  qtdCompra?: number;
  /** Fator (unidade do estoque por 1 unidade da compra) ou null se incompleto. */
  onChange: (fator: number | null) => void;
  embalagemInicial?: string;
  /** false = só "1 garrafa tem quantos ml" (ex.: converter o cadastro). */
  mostrarCaixa?: boolean;
}) {
  const u = (unidadeEstoque || 'un').toLowerCase();
  const porMedida = u === 'ml' || u === 'l' || u === 'g' || u === 'kg';
  const pequena: 'ml' | 'g' = u === 'g' || u === 'kg' ? 'g' : 'ml';
  const compra = (unidadeCompra || 'UN').trim();
  const f0 = fatorInicial && fatorInicial > 0 ? fatorInicial : null;

  const [embalagem, setEmbalagem] = useState(
    embalagemInicial ?? (pequena === 'g' ? 'pacote' : 'garrafa'),
  );
  const [caixa, setCaixa] = useState(mostrarCaixa !== false && ehAgrupada(compra));
  const [dentro, setDentro] = useState(porMedida ? '1' : String(f0 ?? 1));
  // Tamanho sempre em ml/g (quem compra pensa "750 ml", não "0,75 l").
  const [tamanho, setTamanho] = useState(() => {
    if (!porMedida || !f0) return '';
    return String(u === 'l' || u === 'kg' ? f0 * 1000 : f0);
  });

  function calcular(d: string, t: string): number | null {
    const nDentro = Number(d.replace(',', '.'));
    if (!Number.isFinite(nDentro) || nDentro <= 0) return null;
    if (!porMedida) return nDentro;
    const nTam = Number(t.replace(',', '.'));
    if (!Number.isFinite(nTam) || nTam <= 0) return null;
    return (caixa ? nDentro : 1) * paraEstoque(nTam, u);
  }

  // Avisa o valor de partida (o que foi lido na nota ou já estava salvo) —
  // senão o pai fica com null até alguém mexer e o botão não habilita.
  useEffect(() => {
    onChange(calcular(dentro, tamanho));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mudar(d: string, t: string) {
    setDentro(d);
    setTamanho(t);
    onChange(calcular(d, t));
  }

  const fator = calcular(dentro, tamanho);
  const plural = (n: number, s: string) => (n === 1 ? s : s.endsWith('ão') ? s.replace(/ão$/, 'ões') : `${s}s`);
  const nDentro = Number(dentro.replace(',', '.')) || 0;

  // Estoque em unidade: só "quantas vêm dentro".
  if (!porMedida) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-700">
          Quantas unidades vêm em <strong>1 {compra}</strong>?
        </p>
        <input
          inputMode="decimal"
          value={dentro}
          onChange={(e) => mudar(e.target.value, tamanho)}
          className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
        <Resultado compra={compra} fator={fator} unidade={u} qtdCompra={qtdCompra} />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {mostrarCaixa !== false && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
          <span>
            Na compra vem <strong>1 {compra}</strong> =
          </span>
          <button
            type="button"
            onClick={() => {
              setCaixa(false);
              onChange(calcularSem(false));
            }}
            className={`rounded-full border px-2.5 py-0.5 ${!caixa ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
          >
            1 {embalagem}
          </button>
          <button
            type="button"
            onClick={() => {
              setCaixa(true);
              onChange(calcularSem(true));
            }}
            className={`rounded-full border px-2.5 py-0.5 ${caixa ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
          >
            caixa/fardo com várias
          </button>
        </div>
      )}

      {caixa && (
        <label className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
          Quantas {plural(2, embalagem)} vêm em 1 {compra}?
          <input
            inputMode="decimal"
            value={dentro}
            onChange={(e) => mudar(e.target.value, tamanho)}
            className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      )}

      <div>
        <p className="text-xs text-slate-700">
          <select
            value={embalagem}
            onChange={(e) => setEmbalagem(e.target.value)}
            className="mr-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
            aria-label="Tipo de embalagem"
          >
            {[...new Set([embalagem, ...EMBALAGENS])].map((e) => (
              <option key={e} value={e}>
                {e === embalagem ? `1 ${e}` : e}
              </option>
            ))}
          </select>
          tem quantos <strong>{pequena}</strong>?
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            inputMode="decimal"
            value={tamanho}
            onChange={(e) => mudar(dentro, e.target.value)}
            placeholder={pequena === 'ml' ? 'ex.: 750' : 'ex.: 1000'}
            className="w-24 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <span className="text-xs text-slate-500">{pequena}</span>
          {TAMANHOS[pequena].map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => mudar(dentro, String(t.valor))}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                Number(tamanho) === t.valor
                  ? 'border-sky-600 bg-sky-50 text-sky-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          Olhe no rótulo. {pequena === 'ml' ? '1 litro = 1000 ml · meio litro = 500 ml.' : '1 kg = 1000 g.'}
        </p>
      </div>

      <Resultado
        compra={compra}
        fator={fator}
        unidade={u}
        qtdCompra={qtdCompra}
        detalhe={
          fator && caixa && nDentro > 0
            ? `${fmt(nDentro)} ${plural(nDentro, embalagem)} de ${tamanho} ${pequena}`
            : fator
              ? `1 ${embalagem} de ${tamanho} ${pequena}`
              : undefined
        }
      />
    </div>
  );

  function calcularSem(comCaixa: boolean): number | null {
    const nTam = Number(tamanho.replace(',', '.'));
    if (!Number.isFinite(nTam) || nTam <= 0) return null;
    const d = comCaixa ? Number(dentro.replace(',', '.')) : 1;
    if (!Number.isFinite(d) || d <= 0) return null;
    return d * paraEstoque(nTam, u);
  }
}

function Resultado({
  compra,
  fator,
  unidade,
  qtdCompra,
  detalhe,
}: {
  compra: string;
  fator: number | null;
  unidade: string;
  qtdCompra?: number;
  detalhe?: string;
}) {
  if (!fator) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Preencha acima pra ver quanto entra no estoque.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <div>
        1 {compra}
        {detalhe ? ` (${detalhe})` : ''} = <strong>{fmt(fator)} {unidade}</strong>
      </div>
      {qtdCompra != null && qtdCompra > 0 && (
        <div className="mt-0.5">
          {fmt(qtdCompra)} {compra} → entram <strong className="text-sm">{fmt(qtdCompra * fator)} {unidade}</strong> no estoque
        </div>
      )}
    </div>
  );
}

/** Frase curta pra exibir uma conversão já gravada: "1 CX = 9.000 ml". */
export function textoConversao(unidadeCompra: string | null, fator: number, unidadeEstoque: string | null) {
  return `1 ${unidadeCompra || 'UN'} = ${fmt(fator)} ${unidadeEstoque || 'un'}`;
}

/** Resumo do que vai acontecer no estoque, em uma frase. */
export function resumoEntrada(opts: {
  qtdCompra?: number | null;
  unidadeCompra: string | null;
  fator: number | null;
  unidadeEstoque: string | null;
  produto: string;
}): string | null {
  const { fator, produto } = opts;
  if (!fator || fator <= 0) return null;
  const compra = opts.unidadeCompra || 'UN';
  const un = opts.unidadeEstoque || 'un';
  if (opts.qtdCompra != null && opts.qtdCompra > 0) {
    return `Vão entrar ${fmt(opts.qtdCompra * fator)} ${un} de ${produto} no estoque (${fmt(opts.qtdCompra)} ${compra} × ${fmt(fator)} ${un}).`;
  }
  return `Cada 1 ${compra} de ${produto} vai entrar como ${fmt(fator)} ${un} no estoque.`;
}

/** Botão de salvar em 2 toques: o 1º mostra o resultado final em palavras
 *  ("Vão entrar 9.000 ml de Gin…") e só o "Sim, está certo" grava. Depois
 *  que o estoque entra errado, desfazer é trabalho — então confere antes. */
export function BotaoConfirmarConversao({
  resumo,
  rotulo,
  pending,
  onConfirmar,
  type = 'button',
}: {
  resumo: string | null;
  rotulo: string;
  pending?: boolean;
  onConfirmar: () => void;
  /** 'submit' pra usar dentro de <form> (o form dispara no "Sim"). */
  type?: 'button' | 'submit';
}) {
  const [conferindo, setConferindo] = useState(false);
  if (!conferindo || !resumo) {
    return (
      <button
        type="button"
        disabled={pending || !resumo}
        onClick={() => setConferindo(true)}
        className="flex-1 rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {rotulo}
      </button>
    );
  }
  return (
    <div className="flex-1 space-y-2 rounded-md border-2 border-amber-300 bg-amber-50 p-3">
      <p className="text-sm text-amber-950">
        <strong>Confira:</strong> {resumo}
      </p>
      <p className="text-[11px] text-amber-800">Está certo?</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConferindo(false)}
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          Não, corrigir
        </button>
        <button
          type={type}
          onClick={type === 'button' ? onConfirmar : undefined}
          disabled={pending}
          className="flex-1 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Sim, está certo'}
        </button>
      </div>
    </div>
  );
}
