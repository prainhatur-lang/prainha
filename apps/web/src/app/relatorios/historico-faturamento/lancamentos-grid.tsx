'use client';

// Grade de valores por mês da aba Histórico de faturamento (VGV): o que não vem
// do PDV (meses antigos, unidade sem sistema) se digita aqui, um ano por vez.

import { useState, type FormEvent } from 'react';
import { MESES_CURTOS, chaveMes, partesMes, rotuloMes, somaMeses } from '@/lib/faturamento-meses';
import { brl, formatValorBr, parseValorBr } from '@/lib/format';
import { BOTAO, CAMPO, CARTAO } from './estilos';
import { useAcao } from './usar-acao';

export interface UnidadeGrade {
  id: string;
  nome: string;
  /** Mês ('YYYY-MM') a partir do qual o PDV responde — dali em diante não se digita. null = tudo digitado. */
  pdvDesde: string | null;
  /** O número de cada mês que tem número (do PDV ou digitado), por 'YYYY-MM'. */
  valores: Record<string, number>;
}

/** O mesmo teto da rota (numeric(14,2)). */
const VALOR_MAX = 999_999_999_999;
const ANO_PISO = 2000;

type Lido = { ok: true; valor: number | null } | { ok: false };

/** Campo vazio = mês sem número (null). Texto que não é valor, ou negativo = inválido. */
function ler(texto: string): Lido {
  const t = texto.trim();
  if (!t) return { ok: true, valor: null };
  const n = parseValorBr(t);
  if (n === null || n < 0 || n > VALOR_MAX) return { ok: false };
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

const centavos = (v: number | null): number | null => (v === null ? null : Math.round(v * 100));

function GradeAno({
  organizacaoId,
  unidade,
  ano,
  mesAtual,
  onSalvo,
}: {
  organizacaoId: string;
  unidade: UnidadeGrade;
  ano: number;
  mesAtual: string;
  onSalvo: (quantos: number) => void;
}) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const meses = MESES_CURTOS.map((_, i) => chaveMes(ano, i + 1));
  const antes = (mes: string): number | null => unidade.valores[mes] ?? null;
  const [textos, setTextos] = useState<string[]>(() =>
    meses.map((m) => {
      const v = antes(m);
      return v === null ? '' : formatValorBr(v);
    }),
  );
  const doPdv = (mes: string) => unidade.pdvDesde !== null && mes >= unidade.pdvDesde && mes <= mesAtual;
  const travado = (mes: string) => mes > mesAtual || doPdv(mes);

  const mudancas: Array<{ mes: number; valor: number | null }> = [];
  const invalidos: string[] = [];
  let total = 0;
  meses.forEach((mes, i) => {
    if (travado(mes)) {
      total += antes(mes) ?? 0;
      return;
    }
    const l = ler(textos[i] ?? '');
    if (!l.ok) {
      invalidos.push(mes);
      return;
    }
    total += l.valor ?? 0;
    if (centavos(l.valor) !== centavos(antes(mes))) mudancas.push({ mes: i + 1, valor: l.valor });
  });

  const mudar = (i: number, texto: string) => {
    setErro(null);
    setTextos((atual) => atual.map((t, n) => (n === i ? texto : t)));
  };
  /** Ao sair do campo, reescreve no formato de dinheiro ("3490" → "3.490,00"). */
  const arrumar = (i: number) => {
    const l = ler(textos[i] ?? '');
    if (!l.ok || l.valor === null) return;
    const certo = formatValorBr(l.valor);
    setTextos((atual) => atual.map((t, n) => (n === i ? certo : t)));
  };

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (invalidos.length > 0) {
      setErro(`Confira o valor de ${invalidos.map((m) => rotuloMes(m)).join(', ')}.`);
      return;
    }
    if (mudancas.length === 0) return;
    const apagados = mudancas.filter((m) => m.valor === null).map((m) => rotuloMes(chaveMes(ano, m.mes)));
    if (
      apagados.length > 0 &&
      !window.confirm(
        `${apagados.join(', ')} de ${unidade.nome} vai ficar em branco (sem número) e sai da comparação.\n\n` +
          'Se a unidade vendeu zero, digite 0 em vez de apagar.\n\nApagar mesmo assim?',
      )
    ) {
      return;
    }
    const ok = await rodar('lancamento', {
      organizacaoId,
      acao: 'meses',
      unidadeId: unidade.id,
      ano,
      valores: mudancas,
    });
    if (ok) onSalvo(mudancas.length);
  }

  return (
    <form onSubmit={salvar} className="px-4 pb-4 pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {meses.map((mes, i) => {
          const pdv = doPdv(mes);
          const l = ler(textos[i] ?? '');
          const mudou = !travado(mes) && l.ok && centavos(l.valor) !== centavos(antes(mes));
          const marca = travado(mes) ? '' : !l.ok ? 'ring-2 ring-rose-300' : mudou ? 'ring-2 ring-sky-300' : '';
          return (
            <label key={mes} className="block">
              <span className="flex items-baseline justify-between gap-2 text-xs font-medium text-slate-600">
                {MESES_CURTOS[i]}
                {pdv ? (
                  <span className="text-[10px] font-normal text-slate-400">PDV</span>
                ) : mes === mesAtual ? (
                  <span className="text-[10px] font-normal text-slate-400">em andamento</span>
                ) : null}
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={textos[i] ?? ''}
                disabled={ocupado || travado(mes)}
                placeholder={mes > mesAtual ? '—' : pdv ? '' : 'em branco'}
                onChange={(e) => mudar(i, e.target.value)}
                onBlur={() => arrumar(i)}
                className={`${CAMPO} mt-1 w-full text-right tabular-nums ${marca}`}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={ocupado || mudancas.length === 0} className={BOTAO}>
          {ocupado
            ? 'Salvando…'
            : mudancas.length > 0
              ? `Salvar ${mudancas.length} ${mudancas.length === 1 ? 'mês' : 'meses'}`
              : 'Salvar'}
        </button>
        <span className="text-sm text-slate-600">
          Total de {ano}: <b className="font-semibold text-slate-900">{brl(total)}</b>
        </span>
        {erro && <span className="text-sm font-medium text-rose-700">{erro}</span>}
      </div>
    </form>
  );
}

export function LancamentosGrid({
  organizacaoId,
  unidades,
  anoMin,
  mesAtual,
  unidadeInicial,
}: {
  organizacaoId: string;
  unidades: UnidadeGrade[];
  /** Ano do primeiro mês do histórico. */
  anoMin: number;
  mesAtual: string;
  unidadeInicial: string;
}) {
  const anoAtual = partesMes(mesAtual).ano;
  // Um ano antes do primeiro que existe, pra dar pra lançar mais pra trás.
  const piso = Math.max(ANO_PISO, Math.min(anoMin, anoAtual) - 1);
  /** Ano em que a grade abre: o corrente, ou o último que se digita quando a casa hoje é do PDV. */
  const anoDe = (u: UnidadeGrade | undefined): number =>
    u?.pdvDesde ? Math.min(anoAtual, Math.max(piso, partesMes(somaMeses(u.pdvDesde, -1)).ano)) : anoAtual;

  const [unidadeId, setUnidadeId] = useState(unidadeInicial);
  const unidade = unidades.find((u) => u.id === unidadeId) ?? unidades[0];
  const [ano, setAno] = useState(() => anoDe(unidade));
  const [salvo, setSalvo] = useState<string | null>(null);
  if (!unidade) return null;

  const anos: number[] = [];
  for (let a = anoAtual; a >= piso; a--) anos.push(a);
  // Quando o servidor devolve os números gravados, a grade recomeça deles.
  const assinatura = MESES_CURTOS.map((_, i) => unidade.valores[chaveMes(ano, i + 1)] ?? '').join('|');

  const pdv = unidade.pdvDesde;
  const tudoPdv = pdv !== null && chaveMes(ano, 1) >= pdv;

  return (
    <div className={CARTAO}>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Valores por mês</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            O total vendido no mês, sem eventos e festas (esses entram no cartão de baixo).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Unidade"
            value={unidade.id}
            onChange={(e) => {
              const proxima = unidades.find((u) => u.id === e.target.value);
              setUnidadeId(e.target.value);
              setAno(anoDe(proxima));
              setSalvo(null);
            }}
            className={CAMPO}
          >
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
          <select
            aria-label="Ano"
            value={ano}
            onChange={(e) => {
              setAno(Number(e.target.value));
              setSalvo(null);
            }}
            className={CAMPO}
          >
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="px-4 pt-2 text-xs text-slate-500">
        {tudoPdv
          ? `Em ${ano} todos os meses de ${unidade.nome} vêm do PDV — não há o que digitar. `
          : pdv !== null
            ? `De ${rotuloMes(pdv)} em diante os valores de ${unidade.nome} vêm do PDV e não se digitam. `
            : ''}
        Campo em branco = mês sem número (fica fora da comparação). Vendeu zero? Digite 0.
      </p>
      <GradeAno
        key={`${unidade.id}:${ano}:${assinatura}`}
        organizacaoId={organizacaoId}
        unidade={unidade}
        ano={ano}
        mesAtual={mesAtual}
        onSalvo={(n) =>
          setSalvo(`Salvo: ${n} ${n === 1 ? 'mês' : 'meses'} de ${unidade.nome} em ${ano}. O relatório acima já conta com isso.`)
        }
      />
      {salvo && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs font-medium text-emerald-700">{salvo}</p>
      )}
    </div>
  );
}
