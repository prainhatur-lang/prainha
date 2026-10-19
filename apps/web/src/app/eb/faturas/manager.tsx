'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';
import type { ConfigEb, PrevisaoFatura } from '@/lib/eb/faturas';

export interface LinhaFatura {
  casaId: string;
  casa: string;
  municipio: string;
  previsao: PrevisaoFatura | null;
  fatura: {
    id: string;
    status: string;
    empregados: number;
    horas: number;
    valorBase: number;
    percentualLucro: number;
    valorLucro: number;
    valorServico: number;
    aliquotaIss: number;
    valorIss: number;
    valorLiquido: number;
    vencimento: string;
    discriminacao: string;
    lancada: boolean;
    recebidoEm: string | null;
    valorRecebido: number | null;
    nfseChave: string | null;
    nfseNumero: string | null;
    nfseErro: string | null;
  } | null;
}

const ROTULO_BASE = {
  proventos_fgts: 'proventos + FGTS',
  proventos: 'só proventos (bruto)',
  liquido: 'líquido pago',
} as const;

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtHoras = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const fmtComp = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

async function enviar(body: unknown): Promise<string | null> {
  const r = await fetch('/api/eb/faturas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.error ?? `erro ${r.status}`;
}

export function FaturasEbManager(props: {
  config: ConfigEb;
  competencias: string[];
  comp: string | null;
  linhas: LinhaFatura[];
  hoje: string;
  certificado: { cn: string | null; validadeFim: string | null } | null;
}) {
  const router = useRouter();
  const [lucro, setLucro] = useState(String(props.config.percentualLucro).replace('.', ','));
  const [aliquota, setAliquota] = useState(
    props.config.aliquotaIss === null ? '' : String(props.config.aliquotaIss).replace('.', ','),
  );
  const [base, setBase] = useState(props.config.base);
  const [dia, setDia] = useState(String(props.config.diaVencimento));
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

  async function agir(chave: string, body: unknown) {
    setOcupado(chave);
    setErro(null);
    const e = await enviar(body);
    setOcupado(null);
    if (e) setErro(e);
    else router.refresh();
  }

  const salvarConfig = () =>
    agir('config', {
      acao: 'config',
      percentualLucro: num(lucro || '0'),
      aliquotaIss: aliquota.trim() === '' ? null : num(aliquota),
      base,
      diaVencimento: Number(dia),
    });

  const totServico = props.linhas.reduce((s, l) => s + (l.fatura?.valorServico ?? l.previsao?.valorServico ?? 0), 0);
  const totIss = props.linhas.reduce((s, l) => s + (l.fatura?.valorIss ?? l.previsao?.valorIss ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium text-slate-900">Regra do valor</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs text-slate-500">Lucro sobre a folha (%)</span>
            <input value={lucro} onChange={(e) => setLucro(e.target.value)} inputMode="decimal"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Alíquota do ISS — Simples do mês (%)</span>
            <input value={aliquota} onChange={(e) => setAliquota(e.target.value)} inputMode="decimal" placeholder="ex.: 3,25"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Custo da folha</span>
            <select value={base} onChange={(e) => setBase(e.target.value as typeof base)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1">
              {Object.entries(ROTULO_BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Vence no dia (mês seguinte)</span>
            <input value={dia} onChange={(e) => setDia(e.target.value)} inputMode="numeric"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1" />
          </label>
        </div>
        <button onClick={salvarConfig} disabled={ocupado !== null}
          className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {ocupado === 'config' ? 'Salvando…' : 'Salvar regra'}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          A regra vale para as faturas geradas daqui pra frente; fatura já gerada guarda os números do dia em que foi feita
          (gere de novo enquanto for rascunho para atualizar).
        </p>
      </div>

      <CertificadoEb certificado={props.certificado} />

      {props.competencias.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Competência:</span>
          {props.competencias.map((c) => (
            <a key={c} href={`/eb/faturas?comp=${c}`}
              className={`rounded-md border px-3 py-1 text-xs ${c === props.comp ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {fmtComp(c)}
            </a>
          ))}
        </div>
      )}

      {erro && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      {props.linhas.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Sem folha da E.B. importada para esse mês.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Total do mês: serviço <b>{brl(totServico)}</b> · ISS retido <b>{brl(totIss)}</b>
          </p>
          {props.linhas.map((l) => (
            <CartaoCasa key={l.casaId} linha={l} comp={props.comp!} hoje={props.hoje} ocupado={ocupado} agir={agir} />
          ))}
        </>
      )}
    </div>
  );
}

function CartaoCasa(props: {
  linha: LinhaFatura;
  comp: string;
  hoje: string;
  ocupado: string | null;
  agir: (chave: string, body: unknown) => Promise<void>;
}) {
  const { linha: l, ocupado, agir } = props;
  const f = l.fatura;
  const v = f ?? l.previsao!;
  const [vencIss, setVencIss] = useState(f?.vencimento ?? l.previsao?.vencimento ?? props.hoje);
  const [recData, setRecData] = useState(props.hoje);
  const [recValor, setRecValor] = useState(f ? String(f.valorLiquido).replace('.', ',') : '');

  // Folha mudou depois de gerar (reimportação) — avisa pra gerar de novo.
  const desatualizada =
    f && l.previsao && f.status === 'RASCUNHO' && !f.lancada && Math.abs(f.valorServico - l.previsao.valorServico) >= 0.01;

  const status = !f
    ? { t: 'não gerada', c: 'border-slate-200 bg-slate-50 text-slate-600' }
    : f.recebidoEm
      ? { t: `recebida em ${fmtData(f.recebidoEm)}`, c: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
      : f.lancada
        ? { t: 'lançada na casa', c: 'border-sky-200 bg-sky-50 text-sky-700' }
        : f.status === 'EMITIDA'
          ? { t: 'NFS-e emitida', c: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
          : { t: 'rascunho', c: 'border-amber-200 bg-amber-50 text-amber-800' };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{l.casa}</h3>
          <p className="text-xs text-slate-500">ISS retido recolhido em {l.municipio}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${status.c}`}>{status.t}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <div><dt className="text-xs text-slate-500">Empregados</dt><dd>{v.empregados}</dd></div>
        <div><dt className="text-xs text-slate-500">Horas</dt><dd>{fmtHoras(v.horas)}</dd></div>
        <div><dt className="text-xs text-slate-500">Custo da folha</dt><dd>{brl(v.valorBase)}</dd></div>
        <div><dt className="text-xs text-slate-500">Lucro ({String(v.percentualLucro).replace('.', ',')}%)</dt><dd>{brl(v.valorLucro)}</dd></div>
        <div><dt className="text-xs text-slate-500">Valor da nota</dt><dd className="font-semibold">{brl(v.valorServico)}</dd></div>
        <div><dt className="text-xs text-slate-500">ISS retido ({String(v.aliquotaIss).replace('.', ',')}%)</dt><dd>{brl(v.valorIss)}</dd></div>
        <div><dt className="text-xs text-slate-500">Casa paga à E.B.</dt><dd className="font-semibold">{brl(v.valorLiquido)}</dd></div>
        <div><dt className="text-xs text-slate-500">Vencimento</dt><dd>{fmtData(v.vencimento)}</dd></div>
      </dl>

      {f && <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{f.discriminacao}</p>}
      {f?.nfseChave && (
        <p className="mt-2 text-xs text-emerald-700">
          NFS-e {f.nfseNumero ? `nº ${f.nfseNumero}` : ''} · chave <span className="font-mono">{f.nfseChave}</span>
        </p>
      )}
      {f && !f.nfseChave && f.nfseErro && (
        <p className="mt-2 break-words rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          Último erro da NFS-e: {f.nfseErro}
        </p>
      )}
      {f && f.status === 'RASCUNHO' && !(f.aliquotaIss > 0) && (
        <p className="mt-2 text-xs text-amber-700">Para emitir a NFS-e, preencha a alíquota do ISS, salve e gere de novo.</p>
      )}
      {desatualizada && (
        <p className="mt-2 text-xs text-amber-700">
          A folha desse mês mudou desde que a fatura foi gerada (agora daria {brl(l.previsao!.valorServico)}). Gere de novo.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {(!f || (f.status === 'RASCUNHO' && !f.lancada)) && l.previsao && (
          <button onClick={() => agir(`gerar-${l.casaId}`, { acao: 'gerar', competencia: props.comp, tomadorFilialId: l.casaId })}
            disabled={ocupado !== null}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {ocupado === `gerar-${l.casaId}` ? 'Gerando…' : f ? 'Gerar de novo' : 'Gerar fatura'}
          </button>
        )}

        {f && f.status === 'RASCUNHO' && f.aliquotaIss > 0 && (
          <button
            onClick={() => {
              if (confirm(`Emitir a NFS-e de ${brl(f.valorServico)} para ${l.casa}? Nota fiscal de verdade, na Receita.`))
                agir(`emitir-${f.id}`, { acao: 'emitir', faturaId: f.id });
            }}
            disabled={ocupado !== null}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {ocupado === `emitir-${f.id}` ? 'Emitindo…' : f.nfseErro ? 'Emitir NFS-e de novo' : 'Emitir NFS-e'}
          </button>
        )}

        {f && !f.lancada && (
          <>
            <label className="text-xs text-slate-500">
              Vencimento da guia do ISS
              <input type="date" value={vencIss} onChange={(e) => setVencIss(e.target.value)}
                className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-slate-800" />
            </label>
            <button onClick={() => agir(`lancar-${f.id}`, { acao: 'lancar', faturaId: f.id, vencimentoIss: vencIss })}
              disabled={ocupado !== null}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
              {ocupado === `lancar-${f.id}` ? 'Lançando…' : 'Lançar contas a pagar na casa'}
            </button>
            <button onClick={() => { if (confirm('Cancelar esta fatura?')) agir(`cancelar-${f.id}`, { acao: 'cancelar', faturaId: f.id }); }}
              disabled={ocupado !== null}
              className="rounded-md px-2 py-1.5 text-xs text-red-600 hover:underline disabled:opacity-50">
              Cancelar
            </button>
          </>
        )}

        {f && f.lancada && !f.recebidoEm && (
          <>
            <input type="date" value={recData} onChange={(e) => setRecData(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
            <input value={recValor} onChange={(e) => setRecValor(e.target.value)} inputMode="decimal"
              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs" />
            <button
              onClick={() => agir(`receber-${f.id}`, {
                acao: 'receber', faturaId: f.id, data: recData,
                valor: Number(recValor.replace(/\./g, '').replace(',', '.')),
              })}
              disabled={ocupado !== null}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {ocupado === `receber-${f.id}` ? 'Salvando…' : 'Marcar recebida pela E.B.'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CertificadoEb(props: { certificado: { cn: string | null; validadeFim: string | null } | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const c = props.certificado;

  async function subir() {
    if (!arquivo || !senha) return;
    setSalvando(true);
    setMsg(null);
    const fd = new FormData();
    fd.append('pfx', arquivo);
    fd.append('senha', senha);
    const r = await fetch('/api/eb/certificado', { method: 'POST', body: fd });
    const j = await r.json().catch(() => null);
    setSalvando(false);
    if (!r.ok) {
      setMsg(j?.error ?? `erro ${r.status}`);
      return;
    }
    setAberto(false);
    setSenha('');
    setArquivo(null);
    router.refresh();
  }

  return (
    <div className={`rounded-xl border p-4 text-sm ${c ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-slate-900">Certificado A1 da E.B.</h2>
          <p className="text-xs text-slate-600">
            {c
              ? `${c.cn ?? 'certificado ativo'}${c.validadeFim ? ` · vence em ${fmtData(c.validadeFim)}` : ''}`
              : 'Ainda não tem — sem ele a NFS-e não sai.'}
          </p>
        </div>
        <button onClick={() => setAberto((a) => !a)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
          {c ? 'Trocar certificado' : 'Enviar certificado (.pfx)'}
        </button>
      </div>
      {aberto && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
            {arquivo ? `📄 ${arquivo.name}` : '📁 Escolher o arquivo .pfx'}
            <input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="sr-only" />
          </label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="senha do certificado"
            autoComplete="new-password" name="senha-certificado-eb" data-lpignore="true"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
          <button onClick={subir} disabled={salvando || !arquivo || !senha}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {salvando ? 'Enviando…' : 'Salvar'}
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-red-700">{msg}</p>}
    </div>
  );
}
