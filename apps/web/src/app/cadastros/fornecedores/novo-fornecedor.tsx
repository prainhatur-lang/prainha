'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NovoFornecedor({ filialId }: { filialId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [email, setEmail] = useState('');
  const [fone, setFone] = useState('');
  const [vendedorNome, setVendedorNome] = useState('');
  const [vendedorZap, setVendedorZap] = useState('');

  function limpar() {
    setNome('');
    setCnpj('');
    setRazaoSocial('');
    setCidade('');
    setUf('');
    setEmail('');
    setFone('');
    setVendedorNome('');
    setVendedorZap('');
    setErro(null);
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/fornecedores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          cnpjOuCpf: cnpj.replace(/\D/g, ''),
          nome: nome.trim(),
          razaoSocial: razaoSocial.trim() || null,
          cidade: cidade.trim() || null,
          uf: uf || null,
          email: email.trim() || null,
          fonePrincipal: fone.trim() || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }

      // Vendedor é opcional, mas é onde mora o WhatsApp que de fato recebe
      // cotação/pedido — o fone do fornecedor sozinho costuma ser o fixo.
      if (vendedorNome.trim() || vendedorZap.trim()) {
        const rv = await fetch('/api/vendedores', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            acao: 'criar',
            filialId,
            fornecedorId: d.id,
            nome: vendedorNome.trim() || nome.trim(),
            whatsapp: vendedorZap.trim() || null,
          }),
        });
        if (!rv.ok) {
          const dv = await rv.json().catch(() => ({}));
          setErro(`Fornecedor criado, mas o vendedor deu erro: ${dv.error ?? rv.status}`);
          router.refresh();
          return;
        }
      }

      setAberto(false);
      limpar();
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
        onClick={() => setAberto(true)}
        className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        + Novo fornecedor
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            <h2 className="text-sm font-semibold text-slate-900">Novo fornecedor</h2>

            <form onSubmit={criar} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Nome *
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  autoFocus
                  required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  CNPJ / CPF *
                </label>
                <input
                  type="text"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  required
                  placeholder="Só números"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Razão social
                </label>
                <input
                  type="text"
                  value={razaoSocial}
                  onChange={(e) => setRazaoSocial(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="w-20">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    UF
                  </label>
                  <input
                    type="text"
                    value={uf}
                    onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                    maxLength={2}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={fone}
                    onChange={(e) => setFone(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
                  Vendedor (WhatsApp de cotação/pedido)
                </p>
                <p className="mt-0.5 text-[10px] text-amber-700">
                  Sem isso, cotação e pedido não têm pra onde ir — telefone do
                  fornecedor sozinho costuma ser o fixo da empresa.
                </p>
                <div className="mt-2 flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Nome do vendedor
                    </label>
                    <input
                      type="text"
                      value={vendedorNome}
                      onChange={(e) => setVendedorNome(e.target.value)}
                      placeholder={nome || 'ex: Alex'}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      WhatsApp
                    </label>
                    <input
                      type="text"
                      value={vendedorZap}
                      onChange={(e) => setVendedorZap(e.target.value)}
                      placeholder="(79) 99999-9999"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
              </div>

              {erro && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {erro}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setAberto(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando || !nome.trim() || !cnpj.trim()}
                  className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {salvando ? 'Criando...' : 'Criar fornecedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
