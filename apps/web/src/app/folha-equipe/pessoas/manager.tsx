'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Pessoa {
  fornecedorId: string;
  papel: string;
  gerenteModelo: string | null;
  gerenteValorFixoDia: number | null;
  diaristaTaxaHoraOverride: number | null;
  ativo: boolean;
  clienteId: string | null;
  fornecedorNome: string;
  fornecedorCpf: string;
  clienteNome: string | null;
  clienteCpf: string | null;
}

interface Candidato {
  fornecedorId: string;
  fornecedorNome: string;
  fornecedorCpf: string;
  clienteIdSugerido: string | null;
  clienteNomeSugerido: string | null;
}

interface Props {
  filialId: string;
  pessoas: Pessoa[];
  candidatos: Candidato[];
}

const PAPEIS: { value: string; label: string }[] = [
  { value: 'funcionario', label: 'Funcionário (rateia 10%)' },
  { value: 'diarista', label: 'Diarista (10% + R$/hora)' },
  { value: 'gerente', label: 'Gerente (1pp dos 10% ou fixo)' },
];

function fmtCpf(cpf: string | null | undefined): string {
  if (!cpf) return '-';
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return cpf;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

export function PessoasManager({ filialId, pessoas, candidatos }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [vinculandoCliente, setVinculandoCliente] = useState<Pessoa | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  return (
    <div className="space-y-6">
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

      {/* Lista de pessoas vinculadas */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            Pessoas vinculadas ({pessoas.length})
          </h2>
          <button
            type="button"
            onClick={() => setAdicionando(true)}
            disabled={candidatos.length === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            ➕ Adicionar pessoa
          </button>
        </header>

        {pessoas.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Ainda não há pessoas cadastradas. Clique em &quot;Adicionar pessoa&quot;.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs">
              <tr>
                <th className="px-5 py-2 text-left font-medium text-slate-500">Nome</th>
                <th className="px-5 py-2 text-left font-medium text-slate-500">CPF</th>
                <th className="px-5 py-2 text-left font-medium text-slate-500">Papel</th>
                <th className="px-5 py-2 text-left font-medium text-slate-500">Cliente (fiado)</th>
                <th className="px-5 py-2 text-left font-medium text-slate-500">Status</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p) => {
                const isEditando = editando === p.fornecedorId;
                if (isEditando) {
                  return (
                    <PessoaEditRow
                      key={p.fornecedorId}
                      pessoa={p}
                      onCancel={() => setEditando(null)}
                      onSaved={(texto) => {
                        setEditando(null);
                        setMsg({ tipo: 'ok', texto });
                        router.refresh();
                      }}
                      onError={(texto) => setMsg({ tipo: 'erro', texto })}
                    />
                  );
                }
                return (
                  <tr key={p.fornecedorId} className="border-t border-slate-100">
                    <td className="px-5 py-3 font-medium text-slate-900">{p.fornecedorNome}</td>
                    <td className="px-5 py-3 text-slate-600">{fmtCpf(p.fornecedorCpf)}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {p.papel === 'funcionario' && '👤 Funcionário'}
                        {p.papel === 'diarista' && '⏰ Diarista'}
                        {p.papel === 'gerente' && '⭐ Gerente'}
                      </span>
                      {p.papel === 'gerente' && p.gerenteModelo && (
                        <span className="ml-2 text-xs text-slate-500">
                          {p.gerenteModelo === '1pp_dos_10pct' ? '· 1pp do 10%' : `· R$${p.gerenteValorFixoDia}/dia`}
                        </span>
                      )}
                      {p.papel === 'diarista' && p.diaristaTaxaHoraOverride !== null && (
                        <span className="ml-2 text-xs text-slate-500">· R${p.diaristaTaxaHoraOverride}/h</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {p.clienteId ? (
                        <span className="text-emerald-700">
                          ✓ {p.clienteNome ?? 'vinculado'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setVinculandoCliente(p)}
                          className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 hover:bg-amber-100"
                          title="Buscar e vincular cliente manualmente"
                        >
                          ⚠ Vincular cliente
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {p.ativo ? (
                        <span className="text-emerald-700">ativo</span>
                      ) : (
                        <span className="text-slate-400">inativo</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditando(p.fornecedorId)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Modal: adicionar pessoa */}
      {adicionando && (
        <AdicionarModal
          filialId={filialId}
          candidatos={candidatos}
          onClose={() => setAdicionando(false)}
          onSaved={(texto) => {
            setAdicionando(false);
            setMsg({ tipo: 'ok', texto });
            router.refresh();
          }}
          onError={(texto) => setMsg({ tipo: 'erro', texto })}
        />
      )}

      {candidatos.length === 0 && pessoas.length > 0 && (
        <p className="text-xs text-slate-500">
          Sem candidatos restantes — todos os fornecedores com histórico de comissão/diária já estão vinculados.
        </p>
      )}

      {vinculandoCliente && (
        <VincularClienteModal
          filialId={filialId}
          pessoa={vinculandoCliente}
          onClose={() => setVinculandoCliente(null)}
          onSaved={(texto) => {
            setVinculandoCliente(null);
            setMsg({ tipo: 'ok', texto });
            router.refresh();
          }}
          onError={(texto) => setMsg({ tipo: 'erro', texto })}
        />
      )}
    </div>
  );
}

// --------- Linha em edição ---------
function PessoaEditRow({
  pessoa,
  onCancel,
  onSaved,
  onError,
}: {
  pessoa: Pessoa;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [papel, setPapel] = useState(pessoa.papel);
  const [gerenteModelo, setGerenteModelo] = useState(pessoa.gerenteModelo ?? '1pp_dos_10pct');
  const [gerenteValorFixoDia, setGerenteValorFixoDia] = useState(pessoa.gerenteValorFixoDia ?? 150);
  const [diaristaTaxaHoraOverride, setDiaristaTaxaHoraOverride] = useState(
    pessoa.diaristaTaxaHoraOverride ?? 0,
  );
  const [usaOverride, setUsaOverride] = useState(pessoa.diaristaTaxaHoraOverride !== null);
  const [ativo, setAtivo] = useState(pessoa.ativo);

  function salvar() {
    startTransition(async () => {
      const r = await fetch('/api/folha-equipe/pessoas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fornecedorId: pessoa.fornecedorId,
          papel,
          gerenteModelo: papel === 'gerente' ? gerenteModelo : null,
          gerenteValorFixoDia:
            papel === 'gerente' && gerenteModelo === 'fixo_por_dia' ? gerenteValorFixoDia : null,
          diaristaTaxaHoraOverride:
            papel === 'diarista' && usaOverride ? diaristaTaxaHoraOverride : null,
          ativo,
        }),
      });
      if (r.ok) onSaved(`${pessoa.fornecedorNome} atualizado ✓`);
      else onError(await r.text());
    });
  }

  return (
    <tr className="border-t border-slate-100 bg-blue-50">
      <td colSpan={6} className="px-5 py-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Editar: {pessoa.fornecedorNome}
          </h3>
          <span className="text-xs text-slate-500">CPF: {fmtCpf(pessoa.fornecedorCpf)}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Papel</label>
            <select
              value={papel}
              onChange={(e) => setPapel(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {PAPEIS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm pt-5">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="h-4 w-4"
              />
              Ativo
            </label>
          </div>

          {papel === 'gerente' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600">Modelo do gerente</label>
                <select
                  value={gerenteModelo}
                  onChange={(e) => setGerenteModelo(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="1pp_dos_10pct">1pp dos 10% (rateado por dia)</option>
                  <option value="fixo_por_dia">Fixo R$/dia trabalhado</option>
                </select>
              </div>
              {gerenteModelo === 'fixo_por_dia' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600">Valor fixo por dia (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={gerenteValorFixoDia}
                    onChange={(e) => setGerenteValorFixoDia(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              )}
            </>
          )}

          {papel === 'diarista' && (
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={usaOverride}
                  onChange={(e) => setUsaOverride(e.target.checked)}
                  className="h-4 w-4"
                />
                Sobrescrever taxa diarista padrão (filial)
              </label>
              {usaOverride && (
                <div className="mt-2">
                  <input
                    type="number"
                    step="0.01"
                    value={diaristaTaxaHoraOverride}
                    onChange={(e) => setDiaristaTaxaHoraOverride(Number(e.target.value))}
                    placeholder="R$/hora dessa pessoa"
                    className="w-48 rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={salvar}
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
          >
            {pending ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}

// --------- Modal: vincular cliente manualmente ---------
interface ClienteSearchResult {
  id: string;
  nome: string | null;
  cpf: string | null;
  codigoExterno: number | null;
}

function VincularClienteModal({
  filialId,
  pessoa,
  onClose,
  onSaved,
  onError,
}: {
  filialId: string;
  pessoa: Pessoa;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busca, setBusca] = useState(pessoa.fornecedorNome.split(' ').slice(0, 2).join(' '));
  const [resultados, setResultados] = useState<ClienteSearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  async function buscar(q: string) {
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const r = await fetch(
        `/api/folha-equipe/pessoas/buscar-cliente?filialId=${filialId}&q=${encodeURIComponent(q)}`,
      );
      if (r.ok) setResultados(await r.json());
    } finally {
      setBuscando(false);
    }
  }

  // Busca inicial automática
  useState(() => {
    buscar(busca);
    return undefined;
  });

  function vincular() {
    if (!selecionado) return;
    startTransition(async () => {
      const r = await fetch('/api/folha-equipe/pessoas/cliente', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fornecedorId: pessoa.fornecedorId, clienteId: selecionado }),
      });
      if (r.ok) onSaved('Cliente vinculado ✓');
      else onError(await r.text());
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl flex flex-col">
        <header className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Vincular cliente — {pessoa.fornecedorNome}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Busque o cliente correspondente no PDV. CPF do fornecedor: {fmtCpf(pessoa.fornecedorCpf)}
          </p>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4">
          <input
            type="text"
            placeholder="Nome ou CPF do cliente..."
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              buscar(e.target.value);
            }}
            autoFocus
            className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />

          {buscando && <p className="text-xs text-slate-500">Buscando...</p>}

          {!buscando && resultados.length === 0 && busca.length >= 2 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="mb-2 font-semibold">Nenhum cliente encontrado.</p>
              <p className="text-xs">
                Possíveis causas:
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
                <li>O cliente ainda não existe no Consumer (PDV) — cadastre lá primeiro</li>
                <li>
                  O cliente existe mas o agente local ainda não sincronizou a versão atualizada (bug
                  conhecido — agente só pega clientes novos por código incremental, atualizações
                  não voltam até a próxima janela de refetch)
                </li>
              </ul>
              <p className="mt-2 text-xs">
                Solução temporária: deixe sem cliente vinculado por agora; vou consertar o sync de
                clientes na v0.5.5 do agente. O fiado fica entrada manual nessa folha.
              </p>
            </div>
          )}

          {resultados.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {resultados.map((c) => {
                const sel = selecionado === c.id;
                const cpfMatch = c.cpf && c.cpf === pessoa.fornecedorCpf;
                return (
                  <li
                    key={c.id}
                    onClick={() => setSelecionado(c.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                      sel ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input type="radio" checked={sel} readOnly className="h-4 w-4" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">{c.nome ?? '(sem nome)'}</div>
                      <div className="text-xs text-slate-500">
                        CPF {fmtCpf(c.cpf)}
                        {c.codigoExterno && ` · cód ${c.codigoExterno}`}
                        {cpfMatch && (
                          <span className="ml-2 text-emerald-600 font-medium">✓ CPF bate</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={vincular}
            disabled={pending || !selecionado}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
          >
            {pending ? 'Vinculando...' : 'Vincular'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// --------- Modal: adicionar ---------
function AdicionarModal({
  filialId,
  candidatos,
  onClose,
  onSaved,
  onError,
}: {
  filialId: string;
  candidatos: Candidato[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [papelDefault, setPapelDefault] = useState('funcionario');

  const filtrados = busca
    ? candidatos.filter(
        (c) =>
          c.fornecedorNome.toLowerCase().includes(busca.toLowerCase()) ||
          c.fornecedorCpf.includes(busca),
      )
    : candidatos;

  function toggle(id: string) {
    const s = new Set(selecionados);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelecionados(s);
  }

  function adicionar() {
    if (selecionados.size === 0) return;
    startTransition(async () => {
      const r = await fetch('/api/folha-equipe/pessoas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          pessoas: Array.from(selecionados).map((id) => {
            const c = candidatos.find((x) => x.fornecedorId === id)!;
            return {
              fornecedorId: id,
              clienteId: c.clienteIdSugerido,
              papel: papelDefault,
            };
          }),
        }),
      });
      if (r.ok) {
        const data = await r.json();
        onSaved(`${data.criados} pessoa(s) adicionada(s) ✓`);
      } else {
        onError(await r.text());
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl flex flex-col">
        <header className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Adicionar pessoas à folha</h2>
          <p className="mt-1 text-xs text-slate-500">
            Fornecedores com CPF e histórico de comissão/diária no contas a pagar.
          </p>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4">
          <div className="mb-4 flex items-center gap-3">
            <input
              type="text"
              placeholder="Buscar por nome ou CPF..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={papelDefault}
              onChange={(e) => setPapelDefault(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              title="Papel pra todos os selecionados (pode ajustar depois individualmente)"
            >
              {PAPEIS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nenhum candidato encontrado.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {filtrados.map((c) => {
                const selected = selecionados.has(c.fornecedorId);
                return (
                  <li
                    key={c.fornecedorId}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                      selected ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => toggle(c.fornecedorId)}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggle(c.fornecedorId)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">{c.fornecedorNome}</div>
                      <div className="text-xs text-slate-500">CPF {fmtCpf(c.fornecedorCpf)}</div>
                    </div>
                    {c.clienteIdSugerido ? (
                      <span className="text-xs text-emerald-700">
                        ✓ vinculado a cliente: {c.clienteNomeSugerido}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700">⚠ sem cliente</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 px-6 py-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {selecionados.size} selecionada(s) — papel default:{' '}
            <strong>{PAPEIS.find((p) => p.value === papelDefault)?.label}</strong>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={adicionar}
              disabled={pending || selecionados.size === 0}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
            >
              {pending ? 'Salvando...' : `Adicionar ${selecionados.size}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
