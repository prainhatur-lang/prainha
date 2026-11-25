'use client';

// Alterar o cadastro do fornecedor (dono 25/11/2026: não havia onde mudar
// endereço nem outro dado depois de criado). Manda só o que mudou.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DadosFornecedor {
  id: string;
  nome: string | null;
  razaoSocial: string | null;
  cnpjOuCpf: string | null;
  rgOuIe: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  fonePrincipal: string | null;
  chavePix: string | null;
  pixFavorecido: string | null;
}

type Campo = Exclude<keyof DadosFornecedor, 'id'>;

const lbl = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';
const inp = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm';

export function EditarFornecedor({ f }: { f: DadosFornecedor }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inicial = (): Record<Campo, string> => ({
    nome: f.nome ?? '',
    razaoSocial: f.razaoSocial ?? '',
    cnpjOuCpf: f.cnpjOuCpf ?? '',
    rgOuIe: f.rgOuIe ?? '',
    endereco: f.endereco ?? '',
    numero: f.numero ?? '',
    complemento: f.complemento ?? '',
    bairro: f.bairro ?? '',
    cidade: f.cidade ?? '',
    uf: f.uf ?? '',
    cep: f.cep ?? '',
    email: f.email ?? '',
    fonePrincipal: f.fonePrincipal ?? '',
    chavePix: f.chavePix ?? '',
    pixFavorecido: f.pixFavorecido ?? '',
  });
  const [v, setV] = useState<Record<Campo, string>>(inicial);
  const set = (k: Campo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((a) => ({ ...a, [k]: e.target.value }));
  const temDoc = !!f.cnpjOuCpf?.trim();

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!v.nome.trim()) return setErro('O nome não pode ficar vazio.');
    const base = inicial();
    const body: Record<string, string | null> = {};
    for (const k of Object.keys(base) as Campo[]) {
      if (v[k].trim() !== base[k].trim()) body[k] = v[k].trim() || null;
    }
    if (Object.keys(body).length === 0) {
      setAberto(false);
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch(`/api/fornecedores/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) return setErro(d.error ?? `erro ${r.status}`);
      setAberto(false);
      router.refresh();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setV(inicial());
          setErro(null);
          setAberto(true);
        }}
        className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-900 hover:bg-slate-50"
      >
        ✏️ Alterar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-left font-normal shadow-lg"
          >
            <h2 className="text-sm font-semibold text-slate-900">Alterar fornecedor</h2>
            <form onSubmit={salvar} className="space-y-3">
              <div>
                <label className={lbl}>Nome *</label>
                <input value={v.nome} onChange={set('nome')} required autoFocus className={inp} />
              </div>
              <div>
                <label className={lbl}>Razão social</label>
                <input value={v.razaoSocial} onChange={set('razaoSocial')} className={inp} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={lbl}>CNPJ / CPF</label>
                  <input
                    value={v.cnpjOuCpf}
                    onChange={set('cnpjOuCpf')}
                    disabled={temDoc}
                    placeholder="Só números"
                    className={`${inp} font-mono disabled:bg-slate-100 disabled:text-slate-500`}
                  />
                  {temDoc && (
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Documento já informado não se troca aqui (ele confere a chave Pix).
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  <label className={lbl}>RG / Inscrição estadual</label>
                  <input value={v.rgOuIe} onChange={set('rgOuIe')} className={inp} />
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={lbl}>Endereço (rua)</label>
                  <input value={v.endereco} onChange={set('endereco')} className={inp} />
                </div>
                <div className="w-24">
                  <label className={lbl}>Número</label>
                  <input value={v.numero} onChange={set('numero')} className={inp} />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={lbl}>Complemento</label>
                  <input value={v.complemento} onChange={set('complemento')} className={inp} />
                </div>
                <div className="flex-1">
                  <label className={lbl}>Bairro</label>
                  <input value={v.bairro} onChange={set('bairro')} className={inp} />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={lbl}>Cidade</label>
                  <input value={v.cidade} onChange={set('cidade')} className={inp} />
                </div>
                <div className="w-20">
                  <label className={lbl}>UF</label>
                  <input
                    value={v.uf}
                    onChange={(e) => setV((a) => ({ ...a, uf: e.target.value.toUpperCase().slice(0, 2) }))}
                    maxLength={2}
                    className={`${inp} font-mono uppercase`}
                  />
                </div>
                <div className="w-32">
                  <label className={lbl}>CEP</label>
                  <input value={v.cep} onChange={set('cep')} className={`${inp} font-mono`} />
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={lbl}>Email</label>
                  <input type="email" value={v.email} onChange={set('email')} className={inp} />
                </div>
                <div className="flex-1">
                  <label className={lbl}>Telefone / WhatsApp</label>
                  <input value={v.fonePrincipal} onChange={set('fonePrincipal')} placeholder="(79) 99999-9999" className={inp} />
                </div>
              </div>

              <div className="rounded-md border-2 border-emerald-300 bg-emerald-50 p-3">
                <p className="text-xs font-semibold text-emerald-900">⚡ Pix — como este fornecedor recebe</p>
                <div className="mt-2 flex gap-2">
                  <div className="flex-1">
                    <label className={lbl}>Chave Pix</label>
                    <input
                      value={v.chavePix}
                      onChange={set('chavePix')}
                      placeholder="CPF, CNPJ, telefone, e-mail ou aleatória"
                      className={inp}
                    />
                  </div>
                  <div className="flex-1">
                    <label className={lbl}>Quem recebe</label>
                    <input
                      value={v.pixFavorecido}
                      onChange={set('pixFavorecido')}
                      placeholder="se cai no nome de outra pessoa"
                      className={inp}
                    />
                  </div>
                </div>
              </div>

              {erro && <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setAberto(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
