'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Initial {
  ppEmpresa: number;
  ppGerente: number;
  ppFuncionarios: number;
  taxaDiaristaHora: number;
  auxTransporteAtivo: boolean;
  auxTransporteValorHora: number | null;
  auxTransporteDias: Record<string, boolean> | null;
  categoriaComissaoId: string | null;
  categoriaDiariaId: string | null;
  categoriaGratificacaoId: string | null;
  categoriaTransporteId: string | null;
  diaPagamento: number;
}

interface Categoria {
  id: string;
  label: string;
}

interface Props {
  filialId: string;
  filialNome: string;
  initial: Initial;
  categorias: Categoria[];
}

const DIAS_SEMANA: { key: string; label: string; num: number }[] = [
  { key: 'seg', label: 'Seg', num: 1 },
  { key: 'ter', label: 'Ter', num: 2 },
  { key: 'qua', label: 'Qua', num: 3 },
  { key: 'qui', label: 'Qui', num: 4 },
  { key: 'sex', label: 'Sex', num: 5 },
  { key: 'sab', label: 'Sáb', num: 6 },
  { key: 'dom', label: 'Dom', num: 7 },
];

export function ConfiguracaoForm({ filialId, filialNome, initial, categorias }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const [ppEmpresa, setPpEmpresa] = useState(initial.ppEmpresa);
  const [ppGerente, setPpGerente] = useState(initial.ppGerente);
  const [ppFuncionarios, setPpFuncionarios] = useState(initial.ppFuncionarios);
  const [taxaDiaristaHora, setTaxaDiaristaHora] = useState(initial.taxaDiaristaHora);
  const [auxTransporteAtivo, setAuxTransporteAtivo] = useState(initial.auxTransporteAtivo);
  const [auxTransporteValorHora, setAuxTransporteValorHora] = useState(
    initial.auxTransporteValorHora ?? 0,
  );
  const [auxTransporteDias, setAuxTransporteDias] = useState<Record<string, boolean>>(
    initial.auxTransporteDias ?? { seg: false, ter: false, qua: false, qui: false, sex: false, sab: false, dom: false },
  );
  const [catComissao, setCatComissao] = useState(initial.categoriaComissaoId ?? '');
  const [catDiaria, setCatDiaria] = useState(initial.categoriaDiariaId ?? '');
  const [catGratificacao, setCatGratificacao] = useState(initial.categoriaGratificacaoId ?? '');
  const [catTransporte, setCatTransporte] = useState(initial.categoriaTransporteId ?? '');
  const [diaPagamento, setDiaPagamento] = useState(initial.diaPagamento);

  const somaPP = ppEmpresa + ppGerente + ppFuncionarios;
  const somaOk = Math.abs(somaPP - 10) < 0.01;

  function salvar() {
    setMsg(null);
    if (!somaOk) {
      setMsg({ tipo: 'erro', texto: `Soma dos pp deve ser 10 (atual: ${somaPP.toFixed(2)})` });
      return;
    }
    startTransition(async () => {
      const r = await fetch('/api/folha-equipe/configuracao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          ppEmpresa,
          ppGerente,
          ppFuncionarios,
          taxaDiaristaHora,
          auxTransporteAtivo,
          auxTransporteValorHora: auxTransporteAtivo ? auxTransporteValorHora : null,
          auxTransporteDias: auxTransporteAtivo ? auxTransporteDias : null,
          categoriaComissaoId: catComissao || null,
          categoriaDiariaId: catDiaria || null,
          categoriaGratificacaoId: catGratificacao || null,
          categoriaTransporteId: catTransporte || null,
          diaPagamento,
        }),
      });
      if (r.ok) {
        setMsg({ tipo: 'ok', texto: 'Configuração salva ✓' });
        router.refresh();
      } else {
        const err = await r.text();
        setMsg({ tipo: 'erro', texto: `Erro: ${err}` });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Divisão dos 10pp */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Divisão dos 10% (em pp — pontos percentuais)
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          O 10% arrecadado em taxa de serviço é dividido em 10 pontos percentuais. A soma dos 3 valores deve ser 10.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Empresa">
            <NumInput value={ppEmpresa} onChange={setPpEmpresa} step={0.01} />
          </Field>
          <Field label="Gerente">
            <NumInput value={ppGerente} onChange={setPpGerente} step={0.01} />
          </Field>
          <Field label="Funcionários">
            <NumInput value={ppFuncionarios} onChange={setPpFuncionarios} step={0.01} />
          </Field>
        </div>
        <p className={`mt-3 text-sm font-medium ${somaOk ? 'text-emerald-600' : 'text-rose-600'}`}>
          Soma: {somaPP.toFixed(2)} pp {somaOk ? '✓' : '✗ — precisa ser 10'}
        </p>
      </section>

      {/* Diaristas */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Diaristas</h2>
        <Field label="Taxa padrão (R$ por hora trabalhada)">
          <NumInput value={taxaDiaristaHora} onChange={setTaxaDiaristaHora} step={0.01} prefix="R$" />
        </Field>
        <p className="mt-2 text-xs text-slate-500">
          Pessoas com papel &quot;diarista&quot; recebem essa taxa × horas trabalhadas, além da comissão.
          Pode ser sobrescrito por pessoa.
        </p>
      </section>

      {/* Transporte */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Auxílio transporte</h2>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={auxTransporteAtivo}
            onChange={(e) => setAuxTransporteAtivo(e.target.checked)}
            className="h-4 w-4"
          />
          Ativar auxílio transporte
        </label>
        {auxTransporteAtivo && (
          <div className="mt-4 space-y-3">
            <Field label="Valor (R$ por hora)">
              <NumInput value={auxTransporteValorHora} onChange={setAuxTransporteValorHora} step={0.01} prefix="R$" />
            </Field>
            <Field label="Dias da semana em que paga">
              <div className="flex gap-2">
                {DIAS_SEMANA.map((d) => (
                  <label
                    key={d.key}
                    className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs ${
                      auxTransporteDias[d.key] ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={auxTransporteDias[d.key] ?? false}
                      onChange={(e) =>
                        setAuxTransporteDias({ ...auxTransporteDias, [d.key]: e.target.checked })
                      }
                      className="hidden"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}
      </section>

      {/* Categorias */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Categorias do plano de contas
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Quais categorias usar ao gerar lançamentos no contas a pagar (1 lançamento por pessoa por categoria aplicável).
        </p>
        <div className="space-y-3">
          <Field label="Comissão (10% rateado)">
            <CategoriaSelect value={catComissao} onChange={setCatComissao} options={categorias} />
          </Field>
          <Field label="Diária (R$/h × horas)">
            <CategoriaSelect value={catDiaria} onChange={setCatDiaria} options={categorias} />
          </Field>
          <Field label="Gratificação (acréscimo manual)">
            <CategoriaSelect value={catGratificacao} onChange={setCatGratificacao} options={categorias} />
          </Field>
          <Field label="Auxílio transporte (se ativo)">
            <CategoriaSelect value={catTransporte} onChange={setCatTransporte} options={categorias} />
          </Field>
        </div>
        {categorias.length === 0 && (
          <p className="mt-3 text-sm text-amber-700">
            Nenhuma categoria de folha encontrada nessa filial. Cadastre &quot;Comissão&quot;, &quot;Diaria&quot;,
            &quot;Gratificação&quot; e &quot;Vale Transporte&quot; no plano de contas do Consumer.
          </p>
        )}
      </section>

      {/* Pagamento */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Pagamento</h2>
        <Field label="Dia da semana em que paga a folha (semana anterior)">
          <select
            value={diaPagamento}
            onChange={(e) => setDiaPagamento(Number(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {DIAS_SEMANA.map((d) => (
              <option key={d.num} value={d.num}>
                {d.label === 'Seg' ? 'Segunda-feira' : d.label === 'Ter' ? 'Terça-feira' : d.label === 'Qua' ? 'Quarta-feira' : d.label === 'Qui' ? 'Quinta-feira' : d.label === 'Sex' ? 'Sexta-feira' : d.label === 'Sáb' ? 'Sábado' : 'Domingo'}
              </option>
            ))}
          </select>
        </Field>
      </section>

      {/* Mensagem + botão */}
      {msg && (
        <div
          className={`rounded-md border p-3 text-sm ${
            msg.tipo === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Filial: {filialNome}</p>
        <button
          type="button"
          onClick={salvar}
          disabled={pending || !somaOk}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
  step = 1,
  prefix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  prefix?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          {prefix}
        </span>
      )}
      <input
        type="number"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full rounded border border-slate-300 px-3 py-2 text-sm ${prefix ? 'pl-8' : ''}`}
      />
    </div>
  );
}

function CategoriaSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Categoria[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
    >
      <option value="">— selecione —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
