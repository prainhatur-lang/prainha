'use client';

// Formulário do cliente da NF-e (cupom → nota) + ações da nota já emitida.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DestForm {
  documento: string;
  nome: string;
  ie: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoMunicipio: string;
  fone: string;
}

const VAZIO: DestForm = {
  documento: '', nome: '', ie: '', email: '', cep: '', logradouro: '', numero: '', complemento: '',
  bairro: '', municipio: '', uf: '', codigoMunicipio: '', fone: '',
};

const so = (s: string) => s.replace(/\D/g, '');
const campo = 'mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900';
const rotulo = 'block text-xs font-medium text-slate-600';

export function FormNfeCupom({
  nfceId,
  inicial,
  rotuloEmitir = '🧾 Emitir NF-e',
}: {
  nfceId: string;
  inicial?: Partial<DestForm>;
  rotuloEmitir?: string;
}) {
  const router = useRouter();
  const [f, setF] = useState<DestForm>({ ...VAZIO, ...inicial });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: keyof DestForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((a) => ({ ...a, [k]: e.target.value }));

  async function buscar(tipo: 'cnpj' | 'cep') {
    const v = so(tipo === 'cnpj' ? f.documento : f.cep);
    if (tipo === 'cnpj' && v.length !== 14) return;
    if (tipo === 'cep' && v.length !== 8) return;
    setOcupado(tipo);
    setErro(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/nfe/consulta-destinatario?${tipo}=${v}`);
      const j = await r.json();
      if (!r.ok) {
        setAviso(j.error ?? 'não achei — preencha na mão');
        return;
      }
      // só preenche o que veio; não apaga o que já foi digitado
      setF((a) => {
        const n: Record<string, string> = { ...a };
        for (const [k, val] of Object.entries(j.dados as Record<string, string>)) {
          if (val && k in n) n[k] = val;
        }
        return n as unknown as DestForm;
      });
      if (j.situacao && j.situacao !== 'ATIVA') setAviso(`Atenção: na Receita este CNPJ está ${j.situacao}.`);
    } catch {
      setAviso('consulta fora do ar — preencha na mão');
    } finally {
      setOcupado(null);
    }
  }

  async function emitir(homologacao: boolean) {
    setErro(null);
    setAviso(null);
    if (
      !homologacao &&
      !window.confirm(
        `Emitir a NF-e DE VERDADE (produção) para ${f.nome || 'o cliente'}?\n\nDepois de autorizada só dá pra cancelar em 24 h.`,
      )
    ) {
      return;
    }
    setOcupado(homologacao ? 'teste' : 'emitir');
    try {
      const r = await fetch(`/api/nfce/${nfceId}/nfe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homologacao, destinatario: f }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErro(j.error ?? 'falhou');
        router.refresh();
        return;
      }
      if (j.aviso) window.alert(j.aviso);
      router.push(`/fiscal/nfce/${nfceId}/nfe?nfeId=${j.nota.id}`);
      router.refresh();
    } catch {
      setErro('sem resposta do servidor — tente de novo (o sistema confere antes de reenviar)');
    } finally {
      setOcupado(null);
    }
  }

  const ehCnpj = so(f.documento).length === 14;

  return (
    <div className="no-print w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Cliente da nota</h2>
      <div className="mt-3 grid grid-cols-6 gap-3">
        <label className={`${rotulo} col-span-6 sm:col-span-2`}>
          CNPJ ou CPF
          <div className="flex gap-1">
            <input
              className={campo}
              value={f.documento}
              onChange={set('documento')}
              onBlur={() => !f.nome && buscar('cnpj')}
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => buscar('cnpj')}
              disabled={!ehCnpj || !!ocupado}
              className="mt-0.5 rounded-md border border-slate-300 px-2 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              title="Puxa razão social e endereço da Receita (só CNPJ)"
            >
              {ocupado === 'cnpj' ? '…' : 'buscar'}
            </button>
          </div>
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-4`}>
          Nome / razão social
          <input className={campo} value={f.nome} onChange={set('nome')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Inscrição estadual <span className="font-normal text-slate-400">(se tiver)</span>
          <input className={campo} value={f.ie} onChange={set('ie')} inputMode="numeric" />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Telefone <span className="font-normal text-slate-400">(opcional)</span>
          <input className={campo} value={f.fone} onChange={set('fone')} inputMode="numeric" />
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-2`}>
          E-mail <span className="font-normal text-slate-400">(opcional)</span>
          <input className={campo} value={f.email} onChange={set('email')} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          CEP
          <input
            className={campo}
            value={f.cep}
            onChange={set('cep')}
            onBlur={() => (!f.logradouro || !f.codigoMunicipio) && buscar('cep')}
            inputMode="numeric"
          />
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-3`}>
          Rua / avenida
          <input className={campo} value={f.logradouro} onChange={set('logradouro')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-1`}>
          Número
          <input className={campo} value={f.numero} onChange={set('numero')} placeholder="SN" />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Complemento
          <input className={campo} value={f.complemento} onChange={set('complemento')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Bairro
          <input className={campo} value={f.bairro} onChange={set('bairro')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-4 sm:col-span-2`}>
          Cidade
          <input className={campo} value={f.municipio} onChange={set('municipio')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-2 sm:col-span-1`}>
          UF
          <input className={campo} value={f.uf} onChange={set('uf')} maxLength={2} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Código IBGE da cidade
          <input
            className={campo}
            value={f.codigoMunicipio}
            onChange={set('codigoMunicipio')}
            inputMode="numeric"
            placeholder="vem do CEP"
          />
        </label>
      </div>

      {aviso && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p>}
      {erro && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => emitir(false)}
          disabled={!!ocupado}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {ocupado === 'emitir' ? 'Enviando pra SEFAZ…' : rotuloEmitir}
        </button>
        <button
          type="button"
          onClick={() => emitir(true)}
          disabled={!!ocupado}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          title="Manda pro ambiente de teste da SEFAZ — não vale como nota, serve pra conferir antes"
        >
          {ocupado === 'teste' ? 'Testando…' : 'Testar antes (sem valor fiscal)'}
        </button>
      </div>
    </div>
  );
}

export function AcoesNfeCupom({
  nfeId,
  temXml,
  podeCancelar,
}: {
  nfeId: string;
  temXml: boolean;
  podeCancelar: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function cancelar() {
    const justificativa = window.prompt(
      'Cancelar a NF-e — a SEFAZ só aceita até 24 HORAS depois da autorização. O cupom original NÃO é cancelado.\n\nJustificativa (mín. 15 caracteres):',
      'Erro nos dados do destinatario',
    );
    if (!justificativa) return;
    setOcupado(true);
    try {
      const r = await fetch(`/api/nfe/${nfeId}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa }),
      });
      const j = await r.json();
      if (!r.ok) window.alert(j.error ?? 'falhou');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        onClick={() => window.print()}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        🖨 Imprimir / salvar PDF
      </button>
      {temXml && (
        <a
          href={`/api/nfe/${nfeId}/xml`}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Baixar XML
        </a>
      )}
      {podeCancelar && (
        <button
          onClick={cancelar}
          disabled={ocupado}
          className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          Cancelar NF-e
        </button>
      )}
    </>
  );
}
