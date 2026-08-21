'use client';

// Formulário do cadastro de cliente — o mesmo pro novo e pra edição.
//
// Novo: a nuvem não inventa o CODIGO (quem gera é o Firebird). O form envia
// pra fila do agente e fica acompanhando até a loja confirmar. Edição: salva na
// nuvem na hora e manda a alteração pra loja na mesma chamada.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ValoresCliente {
  nome: string;
  cpfOuCnpj: string;
  email: string;
  telefone: string;
  celular: string;
  dataNascimento: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  observacao: string;
  limiteCreditoContaCorrente: string;
  bloquearVendaAposLimite: boolean;
  arquivarFiado: boolean;
}

export const VALORES_VAZIOS: ValoresCliente = {
  nome: '', cpfOuCnpj: '', email: '', telefone: '', celular: '', dataNascimento: '',
  endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '',
  observacao: '', limiteCreditoContaCorrente: '', bloquearVendaAposLimite: false,
  arquivarFiado: false,
};

interface Props {
  filialId: string;
  filialNome: string;
  /** Ausente = cadastro novo. */
  clienteId?: string;
  iniciais: ValoresCliente;
  /** conta_receber.update — sem isso os campos de fiado nem aparecem. */
  podeFiado: boolean;
  /** Saldo devedor atual, só pra contexto na tela de edição. */
  saldo?: number | null;
  voltarHref: string;
}

const CAMPO = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-slate-500';

function Campo({
  label, children, className = '',
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function ClienteForm({
  filialId, filialNome, clienteId, iniciais, podeFiado, saldo, voltarHref,
}: Props) {
  const router = useRouter();
  const editando = !!clienteId;
  const [v, setV] = useState<ValoresCliente>(iniciais);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [spc, setSpc] = useState<'ocioso' | 'buscando' | 'achou' | 'nada' | 'erro'>('ocioso');
  const [spcMsg, setSpcMsg] = useState<string | null>(null);
  // CPFs já consultados nesta tela — o SPC cobra por documento novo, então
  // nem o mesmo CPF digitado duas vezes dispara chamada repetida.
  const [jaConsultados] = useState<Set<string>>(() => new Set());

  function set<K extends keyof ValoresCliente>(k: K, valor: ValoresCliente[K]) {
    setV((prev) => ({ ...prev, [k]: valor }));
  }

  /** Puxa o cadastro do CPF no SPC e preenche o que estiver EM BRANCO.
   *  Nunca sobrescreve o que a pessoa digitou: o que veio da boca do cliente
   *  vale mais que a base. */
  async function buscarNoSpc(cpfBruto: string) {
    const cpf = cpfBruto.replace(/\D/g, '');
    if (cpf.length !== 11 || jaConsultados.has(cpf)) return;
    jaConsultados.add(cpf);
    setSpc('buscando'); setSpcMsg(null);
    try {
      const r = await fetch('/api/spc/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf, filialId }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        achou?: boolean; error?: string; fonte?: string;
        nome?: string | null; nascimento?: string | null; telefone?: string | null;
        email?: string | null;
        endereco?: string | null; numero?: string | null; bairro?: string | null;
        cidade?: string | null; uf?: string | null; cep?: string | null;
      };
      if (!r.ok) {
        setSpc('erro');
        setSpcMsg(r.status === 503 ? 'SPC não configurado — preencha na mão.' : (d.error ?? 'SPC indisponível'));
        return;
      }
      if (!d.achou) {
        setSpc('nada');
        setSpcMsg('O SPC não tem cadastro pra esse CPF. Preencha na mão.');
        return;
      }
      setV((prev) => ({
        ...prev,
        nome: prev.nome || (d.nome ?? ''),
        dataNascimento: prev.dataNascimento || (d.nascimento ?? ''),
        celular: prev.celular || (d.telefone ?? ''),
        email: prev.email || (d.email ?? ''),
        endereco: prev.endereco || (d.endereco ?? ''),
        numero: prev.numero || (d.numero ?? ''),
        bairro: prev.bairro || (d.bairro ?? ''),
        cidade: prev.cidade || (d.cidade ?? ''),
        uf: prev.uf || (d.uf ?? ''),
        cep: prev.cep || (d.cep ?? ''),
      }));
      setSpc('achou');
      setSpcMsg(d.fonte === 'cache' ? 'Preenchido pelo SPC (consulta já feita antes).' : 'Preenchido pelo SPC.');
    } catch {
      setSpc('erro');
      setSpcMsg('Não deu pra consultar agora. Preencha na mão.');
    }
  }

  /** Espera a loja aplicar o cadastro (o agente roda a fila a cada ~15s). */
  async function acompanhar(comandoId: string) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await fetch(`/api/clientes?comandoId=${comandoId}`, { cache: 'no-store' });
      if (!r.ok) continue;
      const d = (await r.json()) as { status: string; codigo: number | null; clienteId: string | null };
      if (d.status === 'sucesso') {
        setOk(`Cadastrado na loja${d.codigo ? ` (código ${d.codigo})` : ''}.`);
        if (d.clienteId) router.push(`/cadastros/clientes/editar/${d.clienteId}`);
        else router.push(voltarHref);
        return;
      }
      if (d.status === 'erro') {
        setErro('A loja recusou o cadastro. Confira os dados e tente de novo.');
        return;
      }
    }
    setAviso('Ainda não confirmou. O cadastro está na fila e entra assim que a loja responder.');
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null); setOk(null);
    if (!v.nome.trim()) return setErro('Nome é obrigatório.');
    setSalvando(true);
    try {
      const corpo: Record<string, unknown> = {
        nome: v.nome,
        cpfOuCnpj: v.cpfOuCnpj || null,
        email: v.email || null,
        telefone: v.telefone || null,
        celular: v.celular || null,
        dataNascimento: v.dataNascimento || null,
        endereco: v.endereco || null,
        numero: v.numero || null,
        complemento: v.complemento || null,
        bairro: v.bairro || null,
        cidade: v.cidade || null,
        uf: v.uf || null,
        cep: v.cep || null,
        observacao: v.observacao || null,
      };
      if (podeFiado) {
        corpo.limiteCreditoContaCorrente = v.limiteCreditoContaCorrente || null;
        corpo.bloquearVendaAposLimite = v.bloquearVendaAposLimite;
        corpo.arquivarFiado = v.arquivarFiado;
      }

      const r = await fetch(
        editando ? `/api/clientes/${clienteId}` : '/api/clientes',
        {
          method: editando ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editando ? corpo : { ...corpo, filialId }),
        },
      );
      const d = (await r.json().catch(() => ({}))) as {
        error?: string; comandoId?: string; lojaOnline?: boolean;
      };
      if (!r.ok) return setErro(d.error ?? `Erro ${r.status}`);

      if (editando) {
        setOk(d.comandoId ? 'Salvo. Alteração enviada pra loja.' : 'Salvo.');
        router.refresh();
        return;
      }
      if (d.lojaOnline === false) {
        setAviso('A loja está offline. O cadastro fica na fila e é aplicado quando ela voltar.');
        return;
      }
      setAviso('Enviado pra loja, aguardando confirmação…');
      if (d.comandoId) await acompanhar(d.comandoId);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-900">Identificação</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Nome *" className="sm:col-span-2">
            <input className={CAMPO} value={v.nome} onChange={(e) => set('nome', e.target.value)}
              placeholder="Nome completo" required maxLength={200} />
          </Campo>
          <Campo label="CPF / CNPJ">
            <input className={CAMPO} value={v.cpfOuCnpj} inputMode="numeric"
              onChange={(e) => {
                const t = e.target.value;
                set('cpfOuCnpj', t);
                // 11 dígitos = CPF completo: busca sozinho, sem esperar sair do campo.
                if (t.replace(/\D/g, '').length === 11) void buscarNoSpc(t);
              }}
              onBlur={(e) => void buscarNoSpc(e.target.value)}
              placeholder="só números" />
            {spc !== 'ocioso' && (
              <p className={`mt-1 text-[11px] ${
                spc === 'achou' ? 'text-emerald-700'
                : spc === 'buscando' ? 'text-slate-500'
                : spc === 'nada' ? 'text-slate-500' : 'text-amber-700'
              }`}>
                {spc === 'buscando' ? 'Consultando o SPC…' : spcMsg}
              </p>
            )}
          </Campo>
          <Campo label="Nascimento">
            <input type="date" className={CAMPO} value={v.dataNascimento}
              onChange={(e) => set('dataNascimento', e.target.value)} />
          </Campo>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-900">Contato</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo label="Telefone">
            <input className={CAMPO} value={v.telefone} inputMode="tel"
              onChange={(e) => set('telefone', e.target.value)} placeholder="(79) 3000-0000" />
          </Campo>
          <Campo label="Celular / WhatsApp">
            <input className={CAMPO} value={v.celular} inputMode="tel"
              onChange={(e) => set('celular', e.target.value)} placeholder="(79) 99999-9999" />
          </Campo>
          <Campo label="E-mail">
            <input type="email" className={CAMPO} value={v.email}
              onChange={(e) => set('email', e.target.value)} placeholder="cliente@email.com" />
          </Campo>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-900">Endereço</h2>
        <div className="grid gap-3 sm:grid-cols-6">
          <Campo label="CEP" className="sm:col-span-2">
            <input className={CAMPO} value={v.cep} inputMode="numeric"
              onChange={(e) => set('cep', e.target.value)} placeholder="49000-000" />
          </Campo>
          <Campo label="Endereço" className="sm:col-span-3">
            <input className={CAMPO} value={v.endereco}
              onChange={(e) => set('endereco', e.target.value)} placeholder="Rua / Av." />
          </Campo>
          <Campo label="Número">
            <input className={CAMPO} value={v.numero} onChange={(e) => set('numero', e.target.value)} />
          </Campo>
          <Campo label="Complemento" className="sm:col-span-2">
            <input className={CAMPO} value={v.complemento}
              onChange={(e) => set('complemento', e.target.value)} placeholder="apto, bloco…" />
          </Campo>
          <Campo label="Bairro" className="sm:col-span-2">
            <input className={CAMPO} value={v.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </Campo>
          <Campo label="Cidade">
            <input className={CAMPO} value={v.cidade} onChange={(e) => set('cidade', e.target.value)} />
          </Campo>
          <Campo label="UF">
            <input className={CAMPO} value={v.uf} maxLength={2}
              onChange={(e) => set('uf', e.target.value.toUpperCase())} placeholder="SE" />
          </Campo>
        </div>
      </section>

      {podeFiado && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Fiado (conta corrente)</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            O caixa libera fiado quando o <b>limite é maior que zero</b>. Limite zero (ou em
            branco) = cliente não faz fiado.
            {saldo != null && saldo !== 0 && (
              <> Hoje ele deve <b>{saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b>.</>
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo label="Limite de crédito (R$)">
              <input className={CAMPO} value={v.limiteCreditoContaCorrente} inputMode="decimal"
                onChange={(e) => set('limiteCreditoContaCorrente', e.target.value)} placeholder="0,00" />
            </Campo>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={v.bloquearVendaAposLimite}
                  onChange={(e) => set('bloquearVendaAposLimite', e.target.checked)} />
                Travar a venda quando estourar o limite
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={v.arquivarFiado}
                  onChange={(e) => set('arquivarFiado', e.target.checked)} />
                Arquivar o fiado (some da conta corrente, bloqueia novos)
              </label>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Campo label="Observação">
          <textarea className={`${CAMPO} min-h-20`} value={v.observacao} maxLength={500}
            onChange={(e) => set('observacao', e.target.value)}
            placeholder="Preferências, restrição alimentar, histórico…" />
        </Campo>
      </section>

      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      {aviso && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">{aviso}</p>}
      {ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{ok}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={salvando}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400">
          {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar cliente'}
        </button>
        <a href={voltarHref} className="text-sm text-slate-500 hover:text-slate-700">Cancelar</a>
        <span className="ml-auto text-xs text-slate-400">{filialNome}</span>
      </div>
    </form>
  );
}
