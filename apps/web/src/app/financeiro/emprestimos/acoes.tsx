'use client';

// Formulários da tela de empréstimos (mútuo): lançar e cancelar. Só o Admin vê.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function chamar(body: Record<string, unknown>): Promise<{ numero?: number; cadastros?: number }> {
  const r = await fetch('/api/financeiro/mutuos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; numero?: number; cadastros?: number };
  if (!r.ok) throw new Error(j.error || `erro ${r.status}`);
  return j;
}

const valorBr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
const campo = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

type E = { id: string; nome: string };

export function NovoMutuo({ empresas, hoje, devolucaoPadrao }: { empresas: E[]; hoje: string; devolucaoPadrao: string }) {
  const router = useRouter();
  const [credoraId, setCredoraId] = useState('');
  const [devedoraId, setDevedoraId] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hoje);
  const [dataDevolucao, setDataDevolucao] = useState(devolucaoPadrao);
  const [observacao, setObservacao] = useState('');
  const [jaSaiu, setJaSaiu] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ruim: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    const v = valorBr(valor);
    if (!credoraId || !devedoraId) return setMsg({ t: 'escolha quem empresta e quem recebe', ruim: true });
    if (!(v > 0)) return setMsg({ t: 'digite o valor', ruim: true });
    const de = empresas.find((e) => e.id === credoraId)?.nome;
    const para = empresas.find((e) => e.id === devedoraId)?.nome;
    const brl = v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (!window.confirm(`Lançar empréstimo de ${brl}\nde ${de}\npara ${para}?`)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const j = await chamar({ acao: 'criar', credoraId, devedoraId, valor: v, data, dataDevolucao, observacao, jaSaiu });
      setValor('');
      setObservacao('');
      setMsg({ t: `✓ empréstimo nº ${j.numero ?? ''} lançado`, ruim: false });
      router.refresh();
    } catch (e) {
      setMsg({ t: (e as Error).message, ruim: true });
    } finally {
      setOcupado(false);
    }
  }

  const sel = (v: string, set: (x: string) => void, rot: string, fora: string) => (
    <label className="block text-xs text-slate-500">
      {rot}
      <select className={campo} value={v} onChange={(e) => set(e.target.value)}>
        <option value="">— escolha —</option>
        {empresas
          .filter((e) => e.id !== fora)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Novo empréstimo</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sel(credoraId, setCredoraId, 'Quem empresta (de onde sai o dinheiro)', devedoraId)}
        {sel(devedoraId, setDevedoraId, 'Quem recebe (e devolve depois)', credoraId)}
        <label className="block text-xs text-slate-500">
          Valor (R$)
          <input className={campo} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Data do empréstimo
          <input type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Devolver até
          <input type="date" className={campo} value={dataDevolucao} onChange={(e) => setDataDevolucao(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Observação (pra quê)
          <input className={campo} placeholder="ex.: cobrir fornecedores da semana" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={jaSaiu} onChange={(e) => setJaSaiu(e.target.checked)} />
        <span>
          O dinheiro já foi transferido
          <span className="block text-xs text-slate-500">
            Marcado: a saída já entra como paga nessa data. Desmarcado: fica uma conta a pagar em quem empresta, pra pagar por
            Pix/transferência.
          </span>
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={ocupado}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {ocupado ? 'Lançando…' : 'Lançar empréstimo'}
        </button>
        {msg && <span className={`text-sm ${msg.ruim ? 'text-red-700' : 'text-emerald-700'}`}>{msg.t}</span>}
      </div>
    </div>
  );
}

export function CancelarMutuo({ mutuoId, numero }: { mutuoId: string; numero: number }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  async function cancelar() {
    const motivo = window.prompt(`Cancelar o empréstimo nº ${numero}? Diga o motivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    setOcupado(true);
    try {
      await chamar({ acao: 'cancelar', mutuoId, motivo });
      router.refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <button onClick={cancelar} disabled={ocupado} className="text-red-700 hover:underline disabled:opacity-50">
      {ocupado ? 'cancelando…' : 'cancelar'}
    </button>
  );
}

type CH = { id: string; chave: string; banco: string | null; favorecido: string | null; principal: boolean };
type EP = {
  id: string;
  nome: string;
  cnpj: string;
  chave: string | null;
  favorecido: string | null;
  banco: string | null;
  chaves: CH[];
  cadastros: number;
  iguais: number;
};

/** Cadastro único do Pix de cada empresa: a chave em que ela recebe das outras. */
export function PixDasEmpresas({ empresas, podeEditar }: { empresas: EP[]; podeEditar: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Pix de cada empresa (cadastro único)</h2>
      <p className="mb-3 text-xs text-slate-500">
        A chave em que cada empresa recebe das outras. Salvou aqui, vale no cadastro dela como fornecedor em todas as empresas —
        o empréstimo e o Pagar por Pix já saem com a chave certa. Cada empresa pode ter mais de uma chave (uma em cada banco):
        a principal é a que as outras usam pra pagar; as demais ficam guardadas com o banco.
      </p>
      <div className="divide-y divide-slate-100">
        {empresas.map((e) => (
          <LinhaPix key={e.id} e={e} podeEditar={podeEditar} />
        ))}
      </div>
    </div>
  );
}

function LinhaPix({ e, podeEditar }: { e: EP; podeEditar: boolean }) {
  const router = useRouter();
  const [chave, setChave] = useState(e.chave ?? '');
  const [favorecido, setFavorecido] = useState(e.favorecido ?? '');
  const [banco, setBanco] = useState(e.banco ?? '');
  const [msg, setMsg] = useState<{ t: string; ruim: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const mudou =
    chave.trim() !== (e.chave ?? '') || favorecido.trim() !== (e.favorecido ?? '') || banco.trim() !== (e.banco ?? '');
  const outras = e.chaves.filter((c) => !c.principal);

  async function salvar() {
    if (!chave.trim()) return setMsg({ t: 'digite a chave', ruim: true });
    if (!window.confirm(`Pix da ${e.nome}:\n${chave.trim()}\n\nVale pra todas as empresas pagarem a ela. Confirma?`)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const j = await chamar({ acao: 'pix', filialId: e.id, chave: chave.trim(), favorecido: favorecido.trim(), banco: banco.trim() });
      setMsg({ t: `✓ salvo${j.cadastros ? ` · ${j.cadastros} cadastro(s) atualizado(s)` : ''}`, ruim: false });
      router.refresh();
    } catch (er) {
      setMsg({ t: (er as Error).message, ruim: true });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 py-2">
      <div className="w-full sm:w-44">
        <div className="text-sm font-medium text-slate-800">{e.nome}</div>
        <div className="font-mono text-xs text-slate-500">{e.cnpj}</div>
      </div>
      {podeEditar ? (
        <>
          <label className="block flex-1 text-xs text-slate-500" style={{ minWidth: 180 }}>
            Chave Pix
            <input className={campo} placeholder="sem chave — informe" value={chave} onChange={(ev) => setChave(ev.target.value)} />
          </label>
          <label className="block text-xs text-slate-500" style={{ width: 130 }}>
            Banco
            <input className={campo} placeholder="ex.: Sicredi" value={banco} onChange={(ev) => setBanco(ev.target.value)} />
          </label>
          <label className="block flex-1 text-xs text-slate-500" style={{ minWidth: 160 }}>
            Quem recebe (se o nome no banco for outro)
            <input className={campo} value={favorecido} onChange={(ev) => setFavorecido(ev.target.value)} />
          </label>
          <button
            onClick={salvar}
            disabled={ocupado || !mudou}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {ocupado ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      ) : (
        <div className="flex-1 font-mono text-sm text-slate-700">
          {e.chave ?? '—'}
          {e.banco && <span className="ml-2 font-sans text-xs text-slate-500">{e.banco}</span>}
        </div>
      )}
      <div className="w-full text-xs">
        {msg ? (
          <span className={msg.ruim ? 'text-red-700' : 'text-emerald-700'}>{msg.t}</span>
        ) : e.chave ? (
          <span className="text-slate-500">
            {e.cadastros === 0
              ? 'ainda não é fornecedor em nenhuma empresa — entra com essa chave quando for'
              : `${e.iguais} de ${e.cadastros} cadastro(s) de fornecedor com essa chave`}
          </span>
        ) : (
          <span className="font-medium text-amber-700">sem chave cadastrada</span>
        )}
      </div>
      {(outras.length > 0 || podeEditar) && (
        <div className="w-full sm:pl-44">
          {outras.map((c) => (
            <OutraChave key={c.id} c={c} empresa={e.nome} podeEditar={podeEditar} />
          ))}
          {podeEditar && <NovaChave filialId={e.id} empresa={e.nome} />}
        </div>
      )}
    </div>
  );
}

/** Chave guardada que não é a principal (outro banco). */
function OutraChave({ c, empresa, podeEditar }: { c: CH; empresa: string; podeEditar: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  async function fazer(body: Record<string, unknown>, pergunta?: string) {
    if (pergunta && !window.confirm(pergunta)) return;
    setOcupado(true);
    try {
      await chamar({ ...body, chaveId: c.id });
      router.refresh();
    } catch (er) {
      window.alert((er as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs text-slate-600">
      <span className="text-slate-400">outra chave</span>
      <span className="font-mono text-sm text-slate-800">{c.chave}</span>
      <span className={c.banco ? 'rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700' : 'text-amber-700'}>
        {c.banco ?? 'banco não informado'}
      </span>
      {c.favorecido && <span>recebe: {c.favorecido}</span>}
      {podeEditar && (
        <>
          <button
            disabled={ocupado}
            className="text-sky-700 hover:underline disabled:opacity-50"
            onClick={() => {
              const b = window.prompt(`Banco da chave ${c.chave}:`, c.banco ?? '');
              if (b !== null) void fazer({ acao: 'pix-banco', banco: b });
            }}
          >
            banco
          </button>
          <button
            disabled={ocupado}
            className="text-sky-700 hover:underline disabled:opacity-50"
            onClick={() =>
              fazer(
                { acao: 'pix-principal' },
                `Usar ${c.chave}${c.banco ? ` (${c.banco})` : ''} como a chave principal da ${empresa}?\n\nTodas as empresas passam a pagar a ela nessa chave.`,
              )
            }
          >
            usar como principal
          </button>
          <button
            disabled={ocupado}
            className="text-red-700 hover:underline disabled:opacity-50"
            onClick={() => fazer({ acao: 'pix-remover' }, `Tirar a chave ${c.chave} da ${empresa}?`)}
          >
            remover
          </button>
        </>
      )}
    </div>
  );
}

/** Guardar mais uma chave da empresa (outro banco). */
function NovaChave({ filialId, empresa }: { filialId: string; empresa: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState('');
  const [banco, setBanco] = useState('');
  const [favorecido, setFavorecido] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    if (!chave.trim()) return setErro('digite a chave');
    setOcupado(true);
    setErro(null);
    try {
      await chamar({ acao: 'pix-add', filialId, chave: chave.trim(), banco: banco.trim(), favorecido: favorecido.trim() });
      setChave('');
      setBanco('');
      setFavorecido('');
      setAberto(false);
      router.refresh();
    } catch (er) {
      setErro((er as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)} className="py-1 text-xs font-medium text-sky-700 hover:underline">
        + outra chave (outro banco)
      </button>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
      <label className="block flex-1 text-xs text-slate-500" style={{ minWidth: 180 }}>
        Outra chave Pix da {empresa}
        <input className={campo} value={chave} onChange={(ev) => setChave(ev.target.value)} />
      </label>
      <label className="block text-xs text-slate-500" style={{ width: 130 }}>
        Banco
        <input className={campo} placeholder="ex.: Inter" value={banco} onChange={(ev) => setBanco(ev.target.value)} />
      </label>
      <label className="block flex-1 text-xs text-slate-500" style={{ minWidth: 160 }}>
        Quem recebe (se for outro nome)
        <input className={campo} value={favorecido} onChange={(ev) => setFavorecido(ev.target.value)} />
      </label>
      <button
        onClick={salvar}
        disabled={ocupado}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
      >
        {ocupado ? 'Guardando…' : 'Guardar'}
      </button>
      <button onClick={() => setAberto(false)} className="px-1 py-2 text-xs text-slate-500 hover:underline">
        fechar
      </button>
      {erro && <div className="w-full text-xs text-red-700">{erro}</div>}
    </div>
  );
}
