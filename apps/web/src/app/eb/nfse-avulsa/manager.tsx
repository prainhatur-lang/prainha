'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

export type NotaAvulsa = {
  id: string;
  status: string;
  tomadorCnpj: string;
  tomadorNome: string;
  tomadorEmail: string | null;
  tomadorCodigoMunicipio: string;
  tomadorCidade: string | null;
  tomadorCep: string;
  tomadorLogradouro: string;
  tomadorNumero: string | null;
  tomadorBairro: string;
  codigoTributacao: string;
  descricao: string;
  municipioPrestacao: string;
  dataCompetencia: string;
  valorServico: number;
  aliquotaIss: number | null;
  issRetido: boolean;
  valorIss: number;
  valorLiquido: number;
  nfseNumero: string | null;
  nfseChave: string | null;
  nfseErro: string | null;
};

type Emitente = {
  razaoSocial: string;
  cnpj: string;
  codigoMunicipio: string;
  ambiente: string;
  certificado: { cn: string | null; validadeFim: string | null } | null;
};

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const campo = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900';
const rotulo = 'block text-xs text-slate-500';

type Form = {
  id: string | null;
  tomadorCnpj: string;
  tomadorNome: string;
  tomadorEmail: string;
  tomadorCodigoMunicipio: string;
  tomadorCidade: string;
  tomadorCep: string;
  tomadorLogradouro: string;
  tomadorNumero: string;
  tomadorBairro: string;
  codigoTributacao: string;
  descricao: string;
  municipioPrestacao: string;
  dataCompetencia: string;
  valorServico: string;
  aliquotaIss: string;
  issRetido: boolean;
};

export function NfseAvulsaManager(props: { emitente: Emitente; notas: NotaAvulsa[]; hoje: string }) {
  const router = useRouter();
  const vazio: Form = {
    id: null,
    tomadorCnpj: '',
    tomadorNome: '',
    tomadorEmail: '',
    tomadorCodigoMunicipio: '',
    tomadorCidade: '',
    tomadorCep: '',
    tomadorLogradouro: '',
    tomadorNumero: '',
    tomadorBairro: '',
    codigoTributacao: '',
    descricao: '',
    municipioPrestacao: props.emitente.codigoMunicipio,
    dataCompetencia: props.hoje,
    valorServico: '',
    aliquotaIss: '',
    issRetido: false,
  };
  const [f, setF] = useState<Form>(vazio);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro: boolean } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((a) => ({ ...a, [k]: v }));

  async function chamar(chave: string, corpo: Record<string, unknown>) {
    setOcupado(chave);
    setMsg(null);
    const r = await fetch('/api/eb/nfse-avulsa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => null);
    setOcupado(null);
    if (!r.ok) {
      setMsg({ t: j?.error ?? `erro ${r.status}`, erro: true });
      return null;
    }
    return j as Record<string, unknown>;
  }

  async function buscarCnpj() {
    const j = await chamar('cnpj', { acao: 'cnpj', cnpj: f.tomadorCnpj });
    const d = j?.dados as Record<string, string | null> | undefined;
    if (!d) return;
    setF((a) => ({
      ...a,
      tomadorNome: d.razaoSocial ?? a.tomadorNome,
      tomadorEmail: d.email ?? a.tomadorEmail,
      tomadorCodigoMunicipio: d.codigoMunicipio ?? a.tomadorCodigoMunicipio,
      tomadorCidade: [d.cidade, d.uf].filter(Boolean).join('/') || a.tomadorCidade,
      tomadorCep: d.cep ?? a.tomadorCep,
      tomadorLogradouro: d.logradouro ?? a.tomadorLogradouro,
      tomadorNumero: d.numero ?? a.tomadorNumero,
      tomadorBairro: d.bairro ?? a.tomadorBairro,
    }));
    setMsg({
      t: `Dados da Receita preenchidos${d.situacao ? ` (situação: ${d.situacao})` : ''}. Confira antes de salvar.`,
      erro: false,
    });
  }

  async function salvar() {
    const j = await chamar('salvar', {
      acao: 'salvar',
      id: f.id,
      tomadorCnpj: f.tomadorCnpj,
      tomadorNome: f.tomadorNome,
      tomadorEmail: f.tomadorEmail.trim() || null,
      tomadorCodigoMunicipio: f.tomadorCodigoMunicipio,
      tomadorCidade: f.tomadorCidade.trim() || null,
      tomadorCep: f.tomadorCep,
      tomadorLogradouro: f.tomadorLogradouro,
      tomadorNumero: f.tomadorNumero.trim() || null,
      tomadorBairro: f.tomadorBairro,
      codigoTributacao: f.codigoTributacao,
      descricao: f.descricao,
      municipioPrestacao: f.municipioPrestacao,
      dataCompetencia: f.dataCompetencia,
      valorServico: num(f.valorServico) || 0,
      aliquotaIss: f.aliquotaIss.trim() === '' ? null : num(f.aliquotaIss),
      issRetido: f.issRetido,
    });
    if (!j) return;
    setF(vazio);
    setMsg({ t: 'Rascunho salvo. Confira na lista abaixo e emita.', erro: false });
    router.refresh();
  }

  function editar(n: NotaAvulsa) {
    setF({
      id: n.id,
      tomadorCnpj: n.tomadorCnpj,
      tomadorNome: n.tomadorNome,
      tomadorEmail: n.tomadorEmail ?? '',
      tomadorCodigoMunicipio: n.tomadorCodigoMunicipio,
      tomadorCidade: n.tomadorCidade ?? '',
      tomadorCep: n.tomadorCep,
      tomadorLogradouro: n.tomadorLogradouro,
      tomadorNumero: n.tomadorNumero ?? '',
      tomadorBairro: n.tomadorBairro,
      codigoTributacao: n.codigoTributacao,
      descricao: n.descricao,
      municipioPrestacao: n.municipioPrestacao,
      dataCompetencia: n.dataCompetencia,
      valorServico: n.valorServico.toFixed(2).replace('.', ','),
      aliquotaIss: n.aliquotaIss === null ? '' : String(n.aliquotaIss).replace('.', ','),
      issRetido: n.issRetido,
    });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function emitir(n: NotaAvulsa) {
    if (!confirm(`Emitir a NFS-e de ${brl(n.valorServico)} para ${n.tomadorNome}? Nota fiscal de verdade, na Receita.`)) return;
    const j = await chamar(`emitir-${n.id}`, { acao: 'emitir', id: n.id });
    if (j) setMsg({ t: `NFS-e emitida${j.numero ? ` — nº ${String(j.numero)}` : ''}.`, erro: false });
    router.refresh();
  }

  async function descartar(n: NotaAvulsa) {
    if (!confirm('Descartar este rascunho?')) return;
    await chamar(`descartar-${n.id}`, { acao: 'descartar', id: n.id });
    router.refresh();
  }

  const e = props.emitente;
  const valor = num(f.valorServico) || 0;
  const aliq = f.aliquotaIss.trim() === '' ? null : num(f.aliquotaIss);
  const iss = aliq === null ? 0 : Math.round(valor * aliq) / 100;

  return (
    <div className="space-y-5">
      <div className={`rounded-xl border p-4 text-sm ${e.certificado ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
        <div className="text-xs text-slate-500">Quem emite</div>
        <div className="font-medium text-slate-900">
          {e.razaoSocial} · {fmtCnpj(e.cnpj)}
        </div>
        <div className="text-xs text-slate-600">
          {e.certificado
            ? `Certificado A1: ${e.certificado.cn ?? 'ativo'}${e.certificado.validadeFim ? ` · vence em ${fmtData(e.certificado.validadeFim)}` : ''}`
            : 'Sem certificado A1 — envie o .pfx em Faturas da E.B. antes de emitir.'}
          {e.ambiente === 'homologacao' && ' · ambiente de teste (produção restrita)'}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-medium text-slate-900">{f.id ? 'Corrigir rascunho' : 'Nova nota'}</h2>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Tomador (quem recebe a nota)</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-6">
          <label className={`${rotulo} sm:col-span-2`}>
            CNPJ
            <div className="flex gap-1">
              <input value={f.tomadorCnpj} onChange={(ev) => set('tomadorCnpj', ev.target.value)} inputMode="numeric" className={campo} />
              <button onClick={buscarCnpj} disabled={ocupado !== null || f.tomadorCnpj.replace(/\D/g, '').length !== 14}
                className="mt-1 shrink-0 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                {ocupado === 'cnpj' ? '…' : 'Buscar'}
              </button>
            </div>
          </label>
          <label className={`${rotulo} sm:col-span-4`}>
            Razão social
            <input value={f.tomadorNome} onChange={(ev) => set('tomadorNome', ev.target.value)} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-3`}>
            Endereço (rua, avenida)
            <input value={f.tomadorLogradouro} onChange={(ev) => set('tomadorLogradouro', ev.target.value)} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-1`}>
            Número
            <input value={f.tomadorNumero} onChange={(ev) => set('tomadorNumero', ev.target.value)} placeholder="S/N" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            Bairro
            <input value={f.tomadorBairro} onChange={(ev) => set('tomadorBairro', ev.target.value)} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-1`}>
            CEP
            <input value={f.tomadorCep} onChange={(ev) => set('tomadorCep', ev.target.value)} inputMode="numeric" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            Cidade/UF
            <input value={f.tomadorCidade} onChange={(ev) => set('tomadorCidade', ev.target.value)} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-1`}>
            Código IBGE da cidade
            <input value={f.tomadorCodigoMunicipio} onChange={(ev) => set('tomadorCodigoMunicipio', ev.target.value)} inputMode="numeric" placeholder="7 dígitos" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            E-mail (opcional)
            <input value={f.tomadorEmail} onChange={(ev) => set('tomadorEmail', ev.target.value)} type="email" className={campo} />
          </label>
        </div>

        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Serviço</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-6">
          <label className={`${rotulo} sm:col-span-2`}>
            Código de tributação nacional (6 dígitos)
            <input value={f.codigoTributacao} onChange={(ev) => set('codigoTributacao', ev.target.value)} inputMode="numeric" placeholder="o que o contador passar" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            Cidade onde o serviço foi prestado (IBGE)
            <input value={f.municipioPrestacao} onChange={(ev) => set('municipioPrestacao', ev.target.value)} inputMode="numeric" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            Data de competência
            <input type="date" max={props.hoje} value={f.dataCompetencia} onChange={(ev) => set('dataCompetencia', ev.target.value)} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-6`}>
            Descrição do serviço (sai na nota)
            <textarea value={f.descricao} onChange={(ev) => set('descricao', ev.target.value)} rows={3} className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            Valor do serviço (R$)
            <input value={f.valorServico} onChange={(ev) => set('valorServico', ev.target.value)} inputMode="decimal" placeholder="ex.: 1.500,00" className={campo} />
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            Alíquota do ISS (%)
            <input value={f.aliquotaIss} onChange={(ev) => set('aliquotaIss', ev.target.value)} inputMode="decimal" placeholder="em branco = não vai na nota" className={campo} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-800 sm:col-span-2">
            <input type="checkbox" checked={f.issRetido} onChange={(ev) => set('issRetido', ev.target.checked)} />
            ISS retido pelo tomador
          </label>
        </div>

        {valor > 0 && (
          <p className="mt-3 text-sm text-slate-700">
            Nota de <b>{brl(valor)}</b>
            {aliq !== null && <> · ISS {brl(iss)}{f.issRetido ? ' (retido)' : ''}</>}
            {' · '}o tomador paga <b>{brl(f.issRetido ? Math.round((valor - iss) * 100) / 100 : valor)}</b>
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={salvar} disabled={ocupado !== null}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {ocupado === 'salvar' ? 'Salvando…' : f.id ? 'Salvar correção' : 'Salvar rascunho'}
          </button>
          {f.id && (
            <button onClick={() => setF(vazio)} className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:underline">
              Deixar pra lá
            </button>
          )}
          <span className="text-xs text-slate-500">Salvar não emite. A nota só sai no botão Emitir, na lista.</span>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.erro ? 'text-red-700' : 'text-emerald-700'}`}>{msg.t}</p>}
      </div>

      <div className="space-y-3">
        {props.notas.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nenhuma nota avulsa ainda.</p>
        )}
        {props.notas.map((n) => {
          const emitida = n.status === 'EMITIDA';
          return (
            <div key={n.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{n.tomadorNome}</div>
                  <div className="text-xs text-slate-500">
                    {fmtCnpj(n.tomadorCnpj)} · competência {fmtData(n.dataCompetencia)} · serviço {n.codigoTributacao}
                  </div>
                </div>
                <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${emitida ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  {emitida ? 'emitida' : 'rascunho'}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-slate-700">{n.descricao}</p>
              <p className="mt-2 text-slate-800">
                Valor <b>{brl(n.valorServico)}</b>
                {n.aliquotaIss !== null && <> · ISS {String(n.aliquotaIss).replace('.', ',')}% = {brl(n.valorIss)}{n.issRetido ? ' (retido)' : ''}</>}
                {' · '}tomador paga <b>{brl(n.valorLiquido)}</b>
              </p>
              {n.nfseChave && (
                <p className="mt-2 text-xs text-emerald-800">
                  NFS-e {n.nfseNumero ? `nº ${n.nfseNumero}` : ''} · chave <span className="font-mono">{n.nfseChave}</span>
                </p>
              )}
              {!n.nfseChave && n.nfseErro && <p className="mt-2 text-xs text-red-700">Último erro da NFS-e: {n.nfseErro}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!emitida && (
                  <>
                    <button onClick={() => emitir(n)} disabled={ocupado !== null}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                      {ocupado === `emitir-${n.id}` ? 'Emitindo…' : n.nfseErro ? 'Emitir NFS-e de novo' : 'Emitir NFS-e'}
                    </button>
                    <button onClick={() => editar(n)} disabled={ocupado !== null}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                      Corrigir
                    </button>
                    <button onClick={() => descartar(n)} disabled={ocupado !== null}
                      className="rounded-md px-2 py-1.5 text-xs text-red-600 hover:underline disabled:opacity-50">
                      Descartar
                    </button>
                  </>
                )}
                {emitida && (
                  <a href={`/api/eb/nfse-avulsa?id=${n.id}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
                    Baixar XML
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
