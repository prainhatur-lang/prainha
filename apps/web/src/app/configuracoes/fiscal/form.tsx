'use client';

// Form da config fiscal (NFC-e) de uma filial + botão de teste na SEFAZ.

import { useState } from 'react';
import type { FiscalConfig } from '@concilia/db/schema';

const vazio: FiscalConfig = {
  ativo: false,
  ambiente: 2,
  serie: 3,
  crt: 1,
  padraoItem: { ncm: '21069090', cfop: '5102', csosn: '102', origem: '0' },
};

function Campo(props: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  largura?: string;
  mono?: boolean;
}) {
  return (
    <label className={`block ${props.largura ?? ''}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {props.label}
      </span>
      <input
        type="text"
        value={props.valor}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className={`w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none ${props.mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export function FiscalForm({
  filialId,
  inicial,
}: {
  filialId: string;
  inicial: FiscalConfig | null;
}) {
  const [cfg, setCfg] = useState<FiscalConfig>({ ...vazio, ...(inicial ?? {}) });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [testando, setTestando] = useState(false);

  const set = (patch: Partial<FiscalConfig>) => setCfg((c: FiscalConfig) => ({ ...c, ...patch }));
  const setEnd = (patch: Partial<NonNullable<FiscalConfig['endereco']>>) =>
    setCfg((c: FiscalConfig) => ({
      ...c,
      endereco: {
        logradouro: '',
        numero: '',
        bairro: '',
        codigoMunicipio: '2800308',
        municipio: 'Aracaju',
        uf: 'SE',
        cep: '',
        ...(c.endereco ?? {}),
        ...patch,
      },
    }));
  const setPadrao = (patch: Partial<NonNullable<FiscalConfig['padraoItem']>>) =>
    setCfg((c: FiscalConfig) => ({
      ...c,
      padraoItem: { ncm: '21069090', cfop: '5102', csosn: '102', ...(c.padraoItem ?? {}), ...patch },
    }));

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const body = {
        ativo: !!cfg.ativo,
        ambiente: cfg.ambiente === 1 ? 1 : 2,
        serie: Number(cfg.serie) || 3,
        razaoSocial: cfg.razaoSocial ?? '',
        nomeFantasia: cfg.nomeFantasia || undefined,
        ie: String(cfg.ie ?? '').replace(/\D/g, ''),
        crt: 1,
        endereco: {
          ...cfg.endereco,
          cep: String(cfg.endereco?.cep ?? '').replace(/\D/g, ''),
          codigoMunicipio: String(cfg.endereco?.codigoMunicipio ?? '').replace(/\D/g, ''),
          uf: (cfg.endereco?.uf ?? 'SE').toUpperCase(),
          fone: cfg.endereco?.fone ? cfg.endereco.fone.replace(/\D/g, '') : undefined,
          complemento: cfg.endereco?.complemento || undefined,
        },
        cscId: cfg.cscId || undefined,
        cscToken: cfg.cscToken || undefined,
        cscIdHom: cfg.cscIdHom || undefined,
        cscTokenHom: cfg.cscTokenHom || undefined,
        padraoItem: cfg.padraoItem,
        respTec: cfg.respTec?.cnpj ? cfg.respTec : undefined,
      };
      const r = await fetch(`/api/filial/${filialId}/fiscal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg({ ok: false, texto: `Erro salvando: ${JSON.stringify(j.details?.fieldErrors ?? j.error)}` });
      } else {
        setMsg({ ok: true, texto: 'Config salva.' });
      }
    } catch (e) {
      setMsg({ ok: false, texto: `Erro: ${(e as Error).message}` });
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/nfce/testar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId }),
      });
      const j = await r.json();
      if (j.ok) {
        setMsg({
          ok: true,
          texto: `✓ SEFAZ em operação (${j.cStat} ${j.xMotivo}) — ambiente ${j.ambiente}, série ${j.serie}`,
        });
      } else {
        setMsg({
          ok: false,
          texto: j.pendencias?.length
            ? `Pendências: ${j.pendencias.join('; ')}`
            : `Falhou: ${j.erro ?? `${j.cStat} ${j.xMotivo}`}`,
        });
      }
    } catch (e) {
      setMsg({ ok: false, texto: `Erro: ${(e as Error).message}` });
    } finally {
      setTestando(false);
    }
  }

  const e = cfg.endereco;
  const p = cfg.padraoItem;

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!cfg.ativo}
            onChange={(ev) => set({ ativo: ev.target.checked })}
            className="h-4 w-4"
          />
          <span className="font-medium text-slate-800">Emissão de NFC-e ligada</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Ambiente</span>
          <select
            value={cfg.ambiente === 1 ? '1' : '2'}
            onChange={(ev) => set({ ambiente: ev.target.value === '1' ? 1 : 2 })}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="2">Homologação (teste)</option>
            <option value="1">PRODUÇÃO</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Série</span>
          <input
            type="number"
            value={cfg.serie ?? 3}
            onChange={(ev) => set({ serie: Number(ev.target.value) })}
            className="w-20 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Campo
          label="Razão social"
          valor={cfg.razaoSocial ?? ''}
          onChange={(v) => set({ razaoSocial: v })}
          largura="sm:col-span-2"
        />
        <Campo
          label="Nome fantasia"
          valor={cfg.nomeFantasia ?? ''}
          onChange={(v) => set({ nomeFantasia: v })}
        />
        <Campo
          label="Inscrição estadual"
          valor={cfg.ie ?? ''}
          onChange={(v) => set({ ie: v })}
          mono
        />
        <div className="sm:col-span-2 text-xs text-slate-500 self-end pb-2">
          Regime: <b>Simples Nacional (CRT 1)</b> — único suportado.
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Endereço fiscal
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo label="Logradouro" valor={e?.logradouro ?? ''} onChange={(v) => setEnd({ logradouro: v })} largura="col-span-2" />
          <Campo label="Número" valor={e?.numero ?? ''} onChange={(v) => setEnd({ numero: v })} />
          <Campo label="Bairro" valor={e?.bairro ?? ''} onChange={(v) => setEnd({ bairro: v })} />
          <Campo label="Município" valor={e?.municipio ?? 'Aracaju'} onChange={(v) => setEnd({ municipio: v })} />
          <Campo label="Cód. IBGE" valor={e?.codigoMunicipio ?? '2800308'} onChange={(v) => setEnd({ codigoMunicipio: v })} mono />
          <Campo label="UF" valor={e?.uf ?? 'SE'} onChange={(v) => setEnd({ uf: v })} />
          <Campo label="CEP (só números)" valor={e?.cep ?? ''} onChange={(v) => setEnd({ cep: v })} mono />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          CSC — Código de Segurança do Contribuinte (portal SEFAZ-SE)
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo label="CSC Id (produção)" valor={cfg.cscId ?? ''} onChange={(v) => set({ cscId: v })} mono />
          <Campo label="CSC Token (produção)" valor={cfg.cscToken ?? ''} onChange={(v) => set({ cscToken: v })} mono largura="col-span-1 sm:col-span-3" />
          <Campo label="CSC Id (homolog.)" valor={cfg.cscIdHom ?? ''} onChange={(v) => set({ cscIdHom: v })} mono />
          <Campo label="CSC Token (homolog.)" valor={cfg.cscTokenHom ?? ''} onChange={(v) => set({ cscTokenHom: v })} mono largura="col-span-1 sm:col-span-3" />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Padrão fiscal dos itens (quando o produto no Consumer não tem NCM/CFOP)
        </h4>
        <div className="grid grid-cols-3 gap-3 sm:w-2/3">
          <Campo label="NCM" valor={p?.ncm ?? '21069090'} onChange={(v) => setPadrao({ ncm: v })} mono />
          <Campo label="CFOP" valor={p?.cfop ?? '5102'} onChange={(v) => setPadrao({ cfop: v })} mono />
          <Campo label="CSOSN" valor={p?.csosn ?? '102'} onChange={(v) => setPadrao({ csosn: v })} mono />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Produto com CFOP 5405 no Consumer (bebida com ICMS-ST) sai automaticamente com CSOSN 500.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar config'}
        </button>
        <button
          onClick={testar}
          disabled={testando}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {testando ? 'Testando…' : '📡 Testar conexão SEFAZ'}
        </button>
        {msg && (
          <span className={`text-xs font-medium ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {msg.texto}
          </span>
        )}
      </div>
    </div>
  );
}
