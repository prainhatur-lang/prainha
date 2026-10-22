'use client';

// Envio da guia (PDF ou foto), conferência dos dados lidos e do rateio, e o
// lançamento. Rotas: /api/financeiro/impostos/ler e /lancar.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Filial {
  id: string;
  nome: string;
}

interface Guia {
  id: string;
  tipo: string | null;
  contribuinteCnpj: string | null;
  contribuinteNome: string | null;
  competencia: string | null;
  vencimento: string | null;
  valor: string | null;
  codigoBarras: string | null;
  descricao: string | null;
  status: string;
  arquivoPath: string;
}

interface Proposta {
  regra: 'FOLHA' | 'PERCENTUAL' | 'CASA';
  pagadoraNome: string;
  pagadoraFilialId: string | null;
  explicacao: string;
  percentuais: Array<{ filialId: string; percentual: number }>;
  folha: { partes: Array<{ filialId: string; departamento: string; valor: number; percentual: number }> } | null;
}

const TIPOS: Array<[string, string]> = [
  ['DAS', 'DAS (Simples Nacional)'],
  ['INSS', 'INSS / DCTFWeb / GPS'],
  ['FGTS', 'FGTS'],
  ['IRPJ', 'IRPJ'],
  ['CSLL', 'CSLL'],
  ['PIS', 'PIS'],
  ['COFINS', 'COFINS'],
  ['PIS_COFINS', 'PIS + COFINS'],
  ['ISS', 'ISS (DAM prefeitura)'],
  ['ICMS', 'ICMS'],
  ['DARF', 'Outro DARF'],
  ['TAXA', 'Taxa / alvará'],
  ['OUTRO', 'Outro'],
];

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function reduzirFoto(file: File, lado = 2200, qualidade = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    if (escala === 1 && file.size < 1_500_000 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', qualidade));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function GuiaImpostoForm({ filiais }: { filiais: Filial[] }) {
  const router = useRouter();
  const arqRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guia, setGuia] = useState<Guia | null>(null);
  const [proposta, setProposta] = useState<Proposta | null>(null);

  // campos editáveis
  const [tipo, setTipo] = useState('OUTRO');
  const [cnpj, setCnpj] = useState('');
  const [nome, setNome] = useState('');
  const [competencia, setCompetencia] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [valor, setValor] = useState('');
  const [barras, setBarras] = useState('');
  const [descricao, setDescricao] = useState('');
  const [pct, setPct] = useState<Record<string, string>>({});

  function carregar(g: Guia, p: Proposta) {
    setGuia(g);
    setProposta(p);
    setTipo(g.tipo ?? 'OUTRO');
    setCnpj(g.contribuinteCnpj ?? '');
    setNome(g.contribuinteNome ?? '');
    setCompetencia(g.competencia ?? '');
    setVencimento(g.vencimento ?? '');
    setValor(g.valor ? Number(g.valor).toFixed(2).replace('.', ',') : '');
    setBarras(g.codigoBarras ?? '');
    setDescricao(g.descricao ?? '');
    const m: Record<string, string> = {};
    for (const f of filiais) m[f.id] = '';
    for (const x of p.percentuais) m[x.filialId] = String(x.percentual).replace('.', ',');
    setPct(m);
  }

  async function enviar(file: File | undefined) {
    if (!file) return;
    setErro(null);
    setOk(null);
    setAviso(null);
    setGuia(null);
    setProposta(null);
    setAndamento('Lendo a guia…');
    try {
      const f = await reduzirFoto(file);
      const form = new FormData();
      form.set('arquivo', f);
      const r = await fetch('/api/financeiro/impostos/ler', { method: 'POST', body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      carregar(d.guia as Guia, d.proposta as Proposta);
      if (d.repetida) {
        setAviso(
          d.guia.status === 'LANCADA'
            ? 'Esse arquivo já foi enviado e a guia JÁ ESTÁ LANÇADA.'
            : 'Esse arquivo já tinha sido enviado — continue a conferência.',
        );
      } else if (d.duplicada) {
        setAviso(
          `Atenção: já existe outra guia com esse mesmo código de barras (${d.duplicada.status === 'LANCADA' ? 'já lançada' : 'ainda sem lançar'}). Confira antes pra não pagar em dobro.`,
        );
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAndamento(null);
      if (arqRef.current) arqRef.current.value = '';
      if (fotoRef.current) fotoRef.current.value = '';
    }
  }

  const numPct = (s: string | undefined) => {
    const n = Number((s ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const valorNum = Number(valor.replace(/\./g, '').replace(',', '.')) || 0;
  const somaPct = Math.round(filiais.reduce((s, f) => s + numPct(pct[f.id]), 0) * 100) / 100;
  const ebPagadora = proposta?.regra === 'FOLHA' && proposta.pagadoraFilialId;

  async function lancar(acao: 'lancar' | 'descartar') {
    if (!guia) return;
    if (acao === 'descartar' && !confirm('Descartar essa guia? Nenhuma conta é criada.')) return;
    setErro(null);
    setAndamento(acao === 'lancar' ? 'Lançando…' : 'Descartando…');
    try {
      const r = await fetch('/api/financeiro/impostos/lancar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guiaId: guia.id,
          acao,
          tipo,
          contribuinteCnpj: cnpj,
          contribuinteNome: nome,
          competencia: competencia || null,
          vencimento,
          valor: valorNum,
          codigoBarras: barras,
          descricao,
          regra: proposta?.regra ?? 'CASA',
          rateio: filiais.map((f) => ({ filialId: f.id, percentual: numPct(pct[f.id]) })).filter((x) => x.percentual > 0),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `erro ${r.status}`);
      setOk(
        acao === 'lancar'
          ? `Lançada: ${(d.rateio ?? []).length} conta(s) nas casas${d.contaGuiaId ? ' + a guia inteira na E.B.' : ''}.`
          : 'Guia descartada.',
      );
      setGuia(null);
      setProposta(null);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAndamento(null);
    }
  }

  const campo = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!andamento}
          onClick={() => arqRef.current?.click()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          📄 Subir PDF ou imagem
        </button>
        <button
          type="button"
          disabled={!!andamento}
          onClick={() => fotoRef.current?.click()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
        >
          📸 Tirar foto da guia
        </button>
        <input
          ref={arqRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => enviar(e.target.files?.[0])}
        />
        <input
          ref={fotoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => enviar(e.target.files?.[0])}
        />
      </div>

      {andamento && <p className="mt-3 text-sm text-slate-600">{andamento}</p>}
      {erro && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mt-3 rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{ok}</p>}
      {aviso && <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{aviso}</p>}

      {guia && proposta && guia.status !== 'LANCADA' && (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Tipo
              <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Descrição
              <input className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">
              Contribuinte
              <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">
              CNPJ do contribuinte
              <input className={campo} value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs text-slate-600">
              Competência
              <input className={campo} type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">
              Vencimento
              <input className={campo} type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">
              Valor (R$)
              <input className={campo} value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
            </label>
            <label className="text-xs text-slate-600">
              Código de barras
              <input className={campo} value={barras} onChange={(e) => setBarras(e.target.value)} inputMode="numeric" />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700">{proposta.explicacao}</p>
            <div className="mt-3 space-y-2">
              {filiais.map((f) => {
                const p = numPct(pct[f.id]);
                const dep = proposta.folha?.partes.find((x) => x.filialId === f.id);
                return (
                  <div key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-44 font-medium text-slate-800">{f.nome}</span>
                    <input
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right"
                      value={pct[f.id] ?? ''}
                      placeholder="0"
                      inputMode="decimal"
                      onChange={(e) => setPct({ ...pct, [f.id]: e.target.value })}
                    />
                    <span className="text-slate-500">%</span>
                    <span className="w-28 text-right text-slate-700">{p > 0 ? brl((valorNum * p) / 100) : ''}</span>
                    {dep && (
                      <span className="text-xs text-slate-500">
                        folha: {dep.departamento} ({brl(dep.valor)})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className={`mt-2 text-sm ${Math.abs(somaPct - 100) > 0.01 ? 'text-red-600' : 'text-emerald-700'}`}>
              Soma: {somaPct.toLocaleString('pt-BR')}%{Math.abs(somaPct - 100) > 0.01 ? ' — tem que dar 100%' : ''}
            </p>
            {proposta.regra === 'FOLHA' && (
              <p className="mt-2 text-xs text-slate-600">
                Vai criar em cada casa uma conta “Repasse {proposta.pagadoraNome}” com a parte dela (Pix pra{' '}
                {proposta.pagadoraNome})
                {ebPagadora ? ' e, na E.B., a conta da guia inteira.' : '.'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!andamento || Math.abs(somaPct - 100) > 0.01 || valorNum <= 0 || !vencimento}
              onClick={() => lancar('lancar')}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Lançar contas a pagar
            </button>
            <button
              type="button"
              disabled={!!andamento}
              onClick={() => lancar('descartar')}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
