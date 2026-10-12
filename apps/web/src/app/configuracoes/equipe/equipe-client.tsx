'use client';

import { useEffect, useMemo, useState } from 'react';

interface Filial {
  id: string;
  nome: string;
}

interface EquipeUsuario {
  codigo: number;
  login: string;
  nome: string | null;
  tipo: string | null;
  ativo: boolean;
  permissoes: number[];
}

interface EquipePermissao {
  codigo: number;
  recurso: string;
  descricao: string | null;
}

/** "Principal > Caixa > Operação completa" → { grupo: "Caixa", label: "Operação completa" } */
function partirDescricao(p: EquipePermissao): { grupo: string; label: string } {
  const partes = (p.descricao ?? '').split('>').map((s) => s.trim()).filter(Boolean);
  if (partes.length >= 3) return { grupo: partes[1], label: partes.slice(2).join(' > ') };
  if (partes.length === 2) return { grupo: partes[0], label: partes[1] };
  return { grupo: 'Outras', label: p.descricao || p.recurso };
}

// Situação do usuário do PDV. No Consumer quem foi excluído continua na lista
// com o nome começando por "*Excluído *"; pausado = login desligado sem excluir.
type Situacao = 'ATIVO' | 'PAUSADO' | 'EXCLUIDO';
type Filtro = Situacao | 'TODOS';

function situacaoDe(u: EquipeUsuario): Situacao {
  if (/^\s*\*\s*exclu[ií]do/i.test(u.nome ?? '')) return 'EXCLUIDO';
  return u.ativo ? 'ATIVO' : 'PAUSADO';
}

const SITUACAO: Record<Situacao, { rotulo: string; bola: string; selo: string; borda: string; ordem: number }> = {
  ATIVO: { rotulo: 'ativo', bola: 'bg-emerald-500', selo: 'bg-emerald-100 text-emerald-800', borda: 'border-l-emerald-500', ordem: 0 },
  PAUSADO: { rotulo: 'pausado', bola: 'bg-amber-500', selo: 'bg-amber-100 text-amber-800', borda: 'border-l-amber-500', ordem: 1 },
  EXCLUIDO: { rotulo: 'excluído', bola: 'bg-red-500', selo: 'bg-red-100 text-red-800', borda: 'border-l-red-500', ordem: 2 },
};

const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'ATIVO', rotulo: 'Ativos' },
  { id: 'PAUSADO', rotulo: 'Pausados' },
  { id: 'EXCLUIDO', rotulo: 'Excluídos' },
  { id: 'TODOS', rotulo: 'Todos' },
];

const inp =
  'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20';

export function EquipeClient({
  filiais,
  podeEditar,
  filialInicial,
}: {
  filiais: Filial[];
  podeEditar: boolean;
  filialInicial?: string;
}) {
  const [filialId, setFilialId] = useState(
    (filialInicial && filiais.some((f) => f.id === filialInicial) ? filialInicial : filiais[0]?.id) ?? '',
  );
  const [filtro, setFiltro] = useState<Filtro>('ATIVO');
  const [usuarios, setUsuarios] = useState<EquipeUsuario[]>([]);
  const [permissoes, setPermissoes] = useState<EquipePermissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);

  async function carregar(id: string) {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/equipe/${id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setErro(d.erro ?? d.error ?? `Erro ${r.status}`);
        setUsuarios([]);
        setPermissoes([]);
        return;
      }
      setUsuarios(d.usuarios ?? []);
      setPermissoes(d.permissoes ?? []);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (filialId) carregar(filialId);
  }, [filialId]);

  const gruposOrdenados = useMemo(() => {
    const porGrupo = new Map<string, EquipePermissao[]>();
    for (const p of permissoes) {
      const { grupo } = partirDescricao(p);
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, []);
      porGrupo.get(grupo)!.push(p);
    }
    return [...porGrupo.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [permissoes]);

  const contagem = useMemo(() => {
    const c: Record<Filtro, number> = { ATIVO: 0, PAUSADO: 0, EXCLUIDO: 0, TODOS: usuarios.length };
    for (const u of usuarios) c[situacaoDe(u)]++;
    return c;
  }, [usuarios]);

  // em "Todos": ativos primeiro, depois pausados, excluídos no fim (a ordem dentro de cada grupo é a da loja)
  const visiveis = useMemo(() => {
    if (filtro !== 'TODOS') return usuarios.filter((u) => situacaoDe(u) === filtro);
    return [...usuarios].sort((a, b) => SITUACAO[situacaoDe(a)].ordem - SITUACAO[situacaoDe(b)].ordem);
  }, [usuarios, filtro]);

  return (
    <div className="mt-6 space-y-4">
      {filiais.length > 1 && (
        <div>
          <label className="text-xs font-semibold text-slate-700">Filial</label>
          <select
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </select>
        </div>
      )}

      {carregando && <p className="text-sm text-slate-500">Carregando…</p>}
      {erro && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{erro}</div>
      )}

      {!carregando && !erro && (
        <>
          <NovoUsuario filialId={filialId} podeEditar={podeEditar} onCriado={() => carregar(filialId)} />

          {usuarios.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFiltro(f.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filtro === f.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.id !== 'TODOS' && <span className={`h-2 w-2 rounded-full ${SITUACAO[f.id].bola}`} />}
                  {f.rotulo} ({contagem[f.id]})
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {usuarios.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                Nenhum usuário cadastrado nesta loja ainda.
              </p>
            ) : visiveis.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                Nenhum usuário nessa situação. Veja em &quot;Todos&quot;.
              </p>
            ) : (
              visiveis.map((u) => (
                <UsuarioCard
                  key={u.codigo}
                  u={u}
                  filialId={filialId}
                  podeEditar={podeEditar}
                  aberto={expandido === u.codigo}
                  onToggleAberto={() => setExpandido(expandido === u.codigo ? null : u.codigo)}
                  gruposOrdenados={gruposOrdenados}
                  onMudou={() => carregar(filialId)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NovoUsuario({
  filialId,
  podeEditar,
  onCriado,
}: {
  filialId: string;
  podeEditar: boolean;
  onCriado: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [login, setLogin] = useState('');
  const [tipo, setTipo] = useState('Atendente');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function criar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/equipe/${filialId}/criar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, login, tipo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setMsg(d.erro ?? d.error ?? `Erro ${r.status}`);
        return;
      }
      setNome('');
      setLogin('');
      setTipo('Atendente');
      setAberto(false);
      onCriado();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!podeEditar) return null;

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        + Novo usuário
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800">Novo usuário</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Sem senha aqui — quem for usar a maquininha/comanda mobile cria o PIN sozinho, no primeiro
        login do app.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-semibold text-slate-700">Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inp} placeholder="Ex.: João Silva" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Login</label>
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
            className={inp}
            placeholder="Ex.: joao"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inp}>
            <option value="Atendente">Atendente</option>
            <option value="Administrador">Administrador</option>
          </select>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-rose-600">{msg}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={criar}
          disabled={salvando || !nome.trim() || login.trim().length < 2}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {salvando ? 'Criando…' : 'Criar'}
        </button>
        <button onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function UsuarioCard({
  u,
  filialId,
  podeEditar,
  aberto,
  onToggleAberto,
  gruposOrdenados,
  onMudou,
}: {
  u: EquipeUsuario;
  filialId: string;
  podeEditar: boolean;
  aberto: boolean;
  onToggleAberto: () => void;
  gruposOrdenados: [string, EquipePermissao[]][];
  onMudou: () => void;
}) {
  const [pendente, setPendente] = useState<number | 'ativo' | null>(null);

  async function togglePermissao(cod: number, ligar: boolean) {
    setPendente(cod);
    try {
      await fetch(`/api/equipe/${filialId}/permissao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: u.codigo, permissao: cod, ligar }),
      });
      onMudou();
    } finally {
      setPendente(null);
    }
  }

  async function toggleAtivo() {
    setPendente('ativo');
    try {
      await fetch(`/api/equipe/${filialId}/ativo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: u.codigo, ativo: !u.ativo }),
      });
      onMudou();
    } finally {
      setPendente(null);
    }
  }

  const setPerms = new Set(u.permissoes);
  const sit = SITUACAO[situacaoDe(u)];

  return (
    <div className={`rounded-xl border border-l-4 border-slate-200 bg-white shadow-sm ${sit.borda}`}>
      <button onClick={onToggleAberto} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${sit.bola}`} />
            <span className="text-sm font-semibold text-slate-900">{u.nome || u.login}</span>
            <span className="text-xs text-slate-400">@{u.login}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${sit.selo}`}>{sit.rotulo}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {u.tipo || 'Atendente'} · {u.permissoes.length} permissão(ões)
          </p>
        </div>
        <span className="text-slate-400">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="border-t border-slate-100 p-4">
          {podeEditar && (
            <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-600">
                {u.ativo ? 'Consegue logar na maquininha/comanda mobile' : 'Login bloqueado'}
              </span>
              <button
                onClick={toggleAtivo}
                disabled={pendente === 'ativo'}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  u.ativo
                    ? 'border border-rose-300 bg-white text-rose-600 hover:bg-rose-50'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                } disabled:opacity-50`}
              >
                {u.ativo ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {gruposOrdenados.map(([grupo, itens]) => (
              <div key={grupo}>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{grupo}</h4>
                <div className="space-y-1">
                  {itens.map((p) => (
                    <label
                      key={p.codigo}
                      className="flex cursor-pointer items-start gap-2 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={setPerms.has(p.codigo)}
                        disabled={!podeEditar || pendente === p.codigo}
                        onChange={(e) => togglePermissao(p.codigo, e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>{p.recurso}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
