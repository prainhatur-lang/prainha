'use client';

import { PAISES_TEL, bandeira, ddiDoPais, formatarTelDigitando, type PaisTel } from '@/lib/telefone-pais';

// Campo de WhatsApp com o país na frente (🇧🇷 +55 de saída). O seletor é o
// <select> nativo invisível por cima da bandeira — no celular abre a lista do
// sistema com o nome dos países, e fechado ocupa só "🇧🇷 +55".
export function TelefonePaisInput({
  pais,
  onPais,
  valor,
  onValor,
  placeholder,
  className = '',
  inputClassName = '',
}: {
  pais: PaisTel;
  onPais: (cc: PaisTel, textoReformatado: string) => void;
  valor: string;
  onValor: (texto: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <span className={`flex min-w-0 gap-1 ${className}`}>
      <span
        className="relative flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2 text-sm text-slate-700"
        title="País do telefone — troque se o cliente for de fora"
      >
        <span>{bandeira(pais)}</span>
        <span className="font-mono text-xs">+{ddiDoPais(pais)}</span>
        <span className="text-[9px] text-slate-400">▾</span>
        <select
          value={pais}
          onChange={(e) => {
            const cc = e.target.value as PaisTel;
            onPais(cc, formatarTelDigitando(cc, valor.replace(/\D/g, '')));
          }}
          aria-label="País do telefone"
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {PAISES_TEL.map((p) => (
            <option key={p.cc} value={p.cc}>
              {bandeira(p.cc)} {p.nome} (+{ddiDoPais(p.cc)})
            </option>
          ))}
        </select>
      </span>
      <input
        value={valor}
        onChange={(e) => onValor(formatarTelDigitando(pais, e.target.value, valor))}
        placeholder={placeholder ?? (pais === 'BR' ? '(79) 99999-9999' : 'número com código de área')}
        inputMode="tel"
        autoComplete="tel-national"
        className={`min-w-0 flex-1 ${inputClassName}`}
      />
    </span>
  );
}
