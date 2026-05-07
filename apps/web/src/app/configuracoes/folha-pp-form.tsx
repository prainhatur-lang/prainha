'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Props {
  filialId: string;
  ppEmpresa: number;
  ppGerente: number;
  ppFuncionarios: number;
}

export function FolhaPpForm({ filialId, ppEmpresa: initE, ppGerente: initG, ppFuncionarios: initF }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [empresa, setEmpresa] = useState(initE);
  const [gerente, setGerente] = useState(initG);
  const [funcs, setFuncs] = useState(initF);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const soma = empresa + gerente + funcs;
  const somaOk = Math.abs(soma - 10) < 0.01;
  const dirty = empresa !== initE || gerente !== initG || funcs !== initF;

  function salvar() {
    setMsg(null);
    if (!somaOk) {
      setMsg({ tipo: 'erro', texto: `Soma deve ser 10 (atual: ${soma.toFixed(2)})` });
      return;
    }
    start(async () => {
      const r = await fetch('/api/folha-equipe/configuracao/pp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          ppEmpresa: empresa,
          ppGerente: gerente,
          ppFuncionarios: funcs,
        }),
      });
      if (r.ok) {
        setMsg({ tipo: 'ok', texto: 'Salvo ✓' });
        router.refresh();
      } else {
        setMsg({ tipo: 'erro', texto: await r.text() });
      }
    });
  }

  return (
    <div>
      <p className="mt-0.5 text-xs text-slate-500">
        Como o 10% (taxa de serviço) é dividido entre Empresa, Gerente e Funcionários. Soma deve ser 10pp.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Field label="Empresa (pp)" hint={`${(empresa * 10).toFixed(0)}% do 10%`}>
          <input
            type="number"
            step="0.01"
            min={0}
            max={10}
            value={empresa}
            onChange={(e) => setEmpresa(Number(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Gerente (pp)" hint={`${(gerente * 10).toFixed(0)}% do 10%`}>
          <input
            type="number"
            step="0.01"
            min={0}
            max={10}
            value={gerente}
            onChange={(e) => setGerente(Number(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Funcionários (pp)" hint={`${(funcs * 10).toFixed(0)}% do 10%`}>
          <input
            type="number"
            step="0.01"
            min={0}
            max={10}
            value={funcs}
            onChange={(e) => setFuncs(Number(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className={`text-xs ${somaOk ? 'text-emerald-600' : 'text-rose-600'}`}>
          Soma: {soma.toFixed(2)} pp {somaOk ? '✓' : '✗ — precisa ser 10'}
        </p>
        <div className="flex items-center gap-3">
          <Link
            href={`/folha-equipe/configuracao?filialId=${filialId}`}
            className="text-xs text-blue-600 hover:underline"
          >
            Outras configurações da folha →
          </Link>
          <button
            type="button"
            onClick={salvar}
            disabled={pending || !somaOk || !dirty}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
          >
            {pending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`mt-3 rounded-md border p-2 text-xs ${
            msg.tipo === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {msg.texto}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}
