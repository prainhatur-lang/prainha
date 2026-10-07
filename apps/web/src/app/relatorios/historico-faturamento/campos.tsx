'use client';

// Seletor de mês da aba Histórico de faturamento (VGV).

import { MESES_CURTOS, chaveMes, partesMes } from '@/lib/faturamento-meses';
import { CAMPO } from './estilos';

/**
 * Mês + ano em dois seletores — o <input type="month"> não existe no Safari
 * nem no Firefox de mesa. `max` ('YYYY-MM') segura o mês que ainda não chegou.
 */
export function SeletorMes({
  valor,
  onChange,
  anoMin,
  max,
  disabled,
}: {
  valor: string;
  onChange: (mes: string) => void;
  anoMin: number;
  max: string;
  disabled?: boolean;
}) {
  const { ano, mes } = partesMes(valor);
  const fim = partesMes(max);
  const anos: number[] = [];
  for (let a = fim.ano; a >= Math.min(anoMin, ano); a--) anos.push(a);
  // Trocar o ano pode cair num mês que ainda não chegou: recua pro último que vale.
  const acertar = (a: number, m: number) => {
    const k = chaveMes(a, m);
    onChange(k > max ? max : k);
  };
  return (
    <span className="inline-flex gap-1">
      <select
        aria-label="Mês"
        value={mes}
        disabled={disabled}
        onChange={(e) => acertar(ano, Number(e.target.value))}
        className={CAMPO}
      >
        {MESES_CURTOS.map((m, i) => (
          <option key={m} value={i + 1} disabled={chaveMes(ano, i + 1) > max}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label="Ano"
        value={ano}
        disabled={disabled}
        onChange={(e) => acertar(Number(e.target.value), mes)}
        className={CAMPO}
      >
        {anos.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </span>
  );
}
