'use client';

// Tela de documentos da empresa (26/10/2026). Fluxo: escolhe o arquivo → sobe
// direto pro bucket → a IA lê → o dono confere os campos e salva. "Renovar"
// sobe a versão nova e o anterior vai pro histórico.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  TIPOS_DOC_EMPRESA,
  fraseSituacao,
  rotuloTipoDoc,
  situacaoDoc,
  type DocEmpresaLido,
  type SituacaoDoc,
} from '@/lib/empresa-documento';

export interface DocLinha {
  id: string;
  tipo: string;
  titulo: string | null;
  numero: string | null;
  orgao: string | null;
  emissao: string | null;
  validade: string | null;
  semVencimento: boolean;
  observacao: string | null;
  arquivoNome: string | null;
  situacao: SituacaoDoc;
  dias: number | null;
  historico: DocLinha[];
}

export interface CasaDocs {
  filialId: string;
  nome: string;
  cnpj: string;
  documentos: DocLinha[];
}

const COR: Record<SituacaoDoc, string> = {
  vencido: 'bg-red-100 text-red-800 ring-red-200',
  vence7: 'bg-red-50 text-red-700 ring-red-200',
  vence15: 'bg-amber-100 text-amber-800 ring-amber-200',
  vence30: 'bg-amber-50 text-amber-700 ring-amber-200',
  valido: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sem_vencimento: 'bg-slate-100 text-slate-600 ring-slate-200',
  sem_data: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const br = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '—');
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

interface Rascunho {
  filialId: string;
  tipo: string;
  titulo: string;
  numero: string;
  orgao: string;
  cnpj: string;
  emissao: string;
  validade: string;
  semVencimento: boolean;
  observacao: string;
  arquivoPath: string;
  arquivoNome: string;
  dados: Record<string, unknown> | null;
  substituiId: string | null;
  avisos: string[];
}

export function DocumentosEmpresa(props: { casas: CasaDocs[]; filialPadrao: string; podeEditar: boolean; hoje: string }) {
  const { casas, podeEditar, hoje } = props;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [renovando, setRenovando] = useState<{ id: string; filialId: string } | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rasc, setRasc] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [abertoHist, setAbertoHist] = useState<Set<string>>(new Set());

  const alertas = casas.flatMap((c) =>
    c.documentos
      .filter((d) => d.situacao === 'vencido' || d.situacao === 'vence7' || d.situacao === 'vence15' || d.situacao === 'vence30')
      .map((d) => ({ casa: c.nome, d })),
  );

  function escolherArquivo(renova: { id: string; filialId: string } | null) {
    setRenovando(renova);
    setErro(null);
    inputRef.current?.click();
  }

  async function aoEscolher(arquivo: File) {
    setErro(null);
    setRasc(null);
    try {
      setEtapa('Enviando o arquivo…');
      const r1 = await fetch('/api/empresa/documento', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'upload_url', nome: arquivo.name, tamanho: arquivo.size }),
      });
      const p = await r1.json();
      if (!r1.ok) throw new Error(p.error ?? 'falha ao preparar o envio');
      const up = await createClient()
        .storage.from(String(p.bucket))
        .uploadToSignedUrl(String(p.path), String(p.token), arquivo, { contentType: arquivo.type || 'application/octet-stream' });
      if (up.error) throw new Error(up.error.message);

      setEtapa('A IA está lendo o documento…');
      const r2 = await fetch('/api/empresa/documento', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'ler', arquivoPath: p.path, arquivoNome: arquivo.name }),
      });
      const j = await r2.json();
      const lido: DocEmpresaLido | null = r2.ok ? j.lido : null;
      const avisos: string[] = [];
      if (!r2.ok) avisos.push(`${j.error ?? 'A IA não conseguiu ler'} — preencha à mão.`);
      if (lido?.aviso) avisos.push(lido.aviso);
      if (lido?.comoValidade) avisos.push(`Validade: ${lido.comoValidade}`);

      let filialId = renovando?.filialId ?? (j.filialId as string | null) ?? props.filialPadrao;
      if (!renovando && lido?.cnpj && !j.filialId) {
        avisos.push(
          `O CNPJ do documento (${fmtCnpj(lido.cnpj)}) não é de nenhuma casa sua${
            (j.casasMesmaRaiz as string[] | undefined)?.length ? ' (é outra unidade da mesma empresa)' : ''
          }. Confira a casa.`,
        );
      }
      if (renovando && lido?.cnpj) {
        const casa = casas.find((c) => c.filialId === renovando.filialId);
        if (casa && casa.cnpj.replace(/\D/g, '') !== lido.cnpj) avisos.push(`Atenção: o CNPJ do documento (${fmtCnpj(lido.cnpj)}) é diferente do CNPJ da casa.`);
      }
      if (!casas.some((c) => c.filialId === filialId)) filialId = props.filialPadrao;

      const tipoAntigo = renovando ? casas.flatMap((c) => c.documentos).find((d) => d.id === renovando.id)?.tipo : undefined;
      setRasc({
        filialId,
        tipo: lido?.tipo ?? tipoAntigo ?? 'outro',
        titulo: lido?.titulo ?? '',
        numero: lido?.numero ?? '',
        orgao: lido?.orgao ?? '',
        cnpj: lido?.cnpj ?? '',
        emissao: lido?.emissao ?? '',
        validade: lido?.validade ?? '',
        semVencimento: lido?.semVencimento ?? false,
        observacao: '',
        arquivoPath: String(p.path),
        arquivoNome: arquivo.name,
        dados: lido ? (lido as unknown as Record<string, unknown>) : null,
        substituiId: renovando?.id ?? null,
        avisos,
      });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEtapa(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function salvar() {
    if (!rasc) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/empresa/documento', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          acao: 'criar',
          filialId: rasc.filialId,
          tipo: rasc.tipo,
          titulo: rasc.titulo || null,
          numero: rasc.numero || null,
          orgao: rasc.orgao || null,
          cnpj: rasc.cnpj || null,
          emissao: rasc.emissao || null,
          validade: rasc.semVencimento ? null : rasc.validade || null,
          semVencimento: rasc.semVencimento,
          observacao: rasc.observacao || null,
          arquivoPath: rasc.arquivoPath,
          arquivoNome: rasc.arquivoNome,
          dados: rasc.dados,
          substituiId: rasc.substituiId,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'falha ao salvar');
      setRasc(null);
      setRenovando(null);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar(d: DocLinha) {
    const motivo = window.prompt(`Tirar "${d.titulo ?? rotuloTipoDoc(d.tipo)}" da lista? Diga o motivo (o arquivo fica guardado):`);
    if (!motivo || motivo.trim().length < 3) return;
    const r = await fetch('/api/empresa/documento', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'cancelar', id: d.id, motivo: motivo.trim() }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      window.alert(j.error ?? 'falha ao tirar');
      return;
    }
    router.refresh();
  }

  const previa = rasc ? situacaoDoc({ validade: rasc.validade || null, semVencimento: rasc.semVencimento }, hoje) : null;
  const campo = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="mt-5 space-y-6">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void aoEscolher(f);
        }}
      />

      {alertas.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">⚠️ {alertas.length} documento(s) vencido(s) ou vencendo em até 30 dias</p>
          <ul className="mt-2 space-y-0.5 text-sm text-red-800">
            {alertas.map(({ casa, d }) => (
              <li key={d.id}>
                <b>{casa}</b> — {d.titulo ?? rotuloTipoDoc(d.tipo)}: {fraseSituacao(d)} ({br(d.validade)})
              </li>
            ))}
          </ul>
        </div>
      )}

      {podeEditar && !rasc && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!!etapa}
            onClick={() => escolherArquivo(null)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            📄 Subir documento
          </button>
          <span className="text-xs text-slate-500">PDF ou foto. A IA lê a validade e descobre a casa pelo CNPJ.</span>
        </div>
      )}
      {etapa && <p className="text-sm text-slate-600">⏳ {etapa}</p>}
      {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      {rasc && (
        <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">
            {rasc.substituiId ? 'Renovação — confira e salve' : 'Confira o que a IA leu e salve'}
            <span className="ml-2 font-normal text-slate-500">{rasc.arquivoNome}</span>
          </p>
          {rasc.avisos.length > 0 && (
            <ul className="mt-2 space-y-0.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {rasc.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-600">
              Casa
              <select
                className={campo}
                value={rasc.filialId}
                disabled={!!rasc.substituiId}
                onChange={(e) => setRasc({ ...rasc, filialId: e.target.value })}
              >
                {casas.map((c) => (
                  <option key={c.filialId} value={c.filialId}>
                    {c.nome} ({fmtCnpj(c.cnpj)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Tipo
              <select
                className={campo}
                value={rasc.tipo}
                onChange={(e) => {
                  const tipo = e.target.value;
                  const sv = TIPOS_DOC_EMPRESA.find((t) => t.tipo === tipo)?.semVencimento;
                  setRasc({ ...rasc, tipo, semVencimento: sv ? true : rasc.semVencimento });
                }}
              >
                {TIPOS_DOC_EMPRESA.map((t) => (
                  <option key={t.tipo} value={t.tipo}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Nome na lista
              <input className={campo} value={rasc.titulo} onChange={(e) => setRasc({ ...rasc, titulo: e.target.value })} />
            </label>
            <label className="text-xs text-slate-600">
              Número
              <input className={campo} value={rasc.numero} onChange={(e) => setRasc({ ...rasc, numero: e.target.value })} />
            </label>
            <label className="text-xs text-slate-600">
              Órgão emissor
              <input className={campo} value={rasc.orgao} onChange={(e) => setRasc({ ...rasc, orgao: e.target.value })} />
            </label>
            <label className="text-xs text-slate-600">
              CNPJ no documento
              <input className={campo} value={rasc.cnpj} onChange={(e) => setRasc({ ...rasc, cnpj: e.target.value })} />
            </label>
            <label className="text-xs text-slate-600">
              Emissão
              <input type="date" className={campo} value={rasc.emissao} onChange={(e) => setRasc({ ...rasc, emissao: e.target.value })} />
            </label>
            <label className="text-xs text-slate-600">
              Validade
              <input
                type="date"
                className={campo}
                value={rasc.semVencimento ? '' : rasc.validade}
                disabled={rasc.semVencimento}
                onChange={(e) => setRasc({ ...rasc, validade: e.target.value })}
              />
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={rasc.semVencimento}
                  onChange={(e) => setRasc({ ...rasc, semVencimento: e.target.checked })}
                />
                sem vencimento
              </span>
            </label>
            <label className="text-xs text-slate-600">
              Observação
              <input className={campo} value={rasc.observacao} onChange={(e) => setRasc({ ...rasc, observacao: e.target.value })} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={salvando || (!rasc.semVencimento && !rasc.validade)}
              onClick={() => void salvar()}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={() => setRasc(null)} className="text-sm text-slate-600 hover:underline">
              Descartar
            </button>
            {previa && (
              <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${COR[previa.situacao]}`}>{fraseSituacao(previa)}</span>
            )}
          </div>
        </div>
      )}

      {casas.map((c) => (
        <section key={c.filialId} className="rounded-lg border border-slate-200 bg-white">
          <header className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">{c.nome}</h2>
            <span className="text-xs text-slate-500">{fmtCnpj(c.cnpj)}</span>
          </header>
          {c.documentos.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Nenhum documento cadastrado.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {c.documentos.map((d) => (
                <li key={d.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{d.titulo ?? rotuloTipoDoc(d.tipo)}</p>
                      <p className="text-xs text-slate-500">
                        {rotuloTipoDoc(d.tipo)}
                        {d.numero ? ` · nº ${d.numero}` : ''}
                        {d.orgao ? ` · ${d.orgao}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        Emissão {br(d.emissao)} · {d.semVencimento ? 'sem vencimento' : `validade ${br(d.validade)}`}
                        {d.observacao ? ` · ${d.observacao}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${COR[d.situacao]}`}>{fraseSituacao(d)}</span>
                      <a
                        href={`/api/empresa/documento?id=${d.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Ver arquivo
                      </a>
                      {podeEditar && (
                        <>
                          <button
                            type="button"
                            disabled={!!etapa || !!rasc}
                            onClick={() => escolherArquivo({ id: d.id, filialId: c.filialId })}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            🔄 Renovar
                          </button>
                          <button type="button" onClick={() => void cancelar(d)} className="px-1 text-xs text-slate-400 hover:text-red-600">
                            Tirar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {d.historico.length > 0 && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:underline"
                        onClick={() => {
                          const s = new Set(abertoHist);
                          if (s.has(d.id)) s.delete(d.id);
                          else s.add(d.id);
                          setAbertoHist(s);
                        }}
                      >
                        {abertoHist.has(d.id) ? '▾' : '▸'} Histórico ({d.historico.length})
                      </button>
                      {abertoHist.has(d.id) && (
                        <ul className="mt-1 space-y-0.5 pl-4 text-xs text-slate-500">
                          {d.historico.map((h) => (
                            <li key={h.id}>
                              {h.titulo ?? rotuloTipoDoc(h.tipo)} — emissão {br(h.emissao)}, validade{' '}
                              {h.semVencimento ? 'sem vencimento' : br(h.validade)} ·{' '}
                              <a href={`/api/empresa/documento?id=${h.id}`} target="_blank" rel="noreferrer" className="underline">
                                ver
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
