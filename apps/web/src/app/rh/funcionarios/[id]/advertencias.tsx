'use client';

// Advertências e suspensões na ficha (pedido do dono 10/11/2026): o gerente diz
// o motivo, o sistema gera o documento e abre o WhatsApp da pessoa com o link;
// ela abre no celular, confere, faz a rubrica, tira a selfie e assina (ciência).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';
import { MOTIVOS_ADVERTENCIA } from '@/lib/rh/advertencia';
import { AssinaturaDoc, type DocVinculo } from './documentos-vinculo';

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' });

export function Advertencias(props: { funcionarioId: string; docs: DocVinculo[]; pode: boolean; temTelefone: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<'advertencia' | 'suspensao'>('advertencia');
  const [motivo, setMotivo] = useState(MOTIVOS_ADVERTENCIA[0]!);
  const [outro, setOutro] = useState('');
  const [dataFato, setDataFato] = useState(hojeBr());
  const [descricao, setDescricao] = useState('');
  const [dias, setDias] = useState(1);
  const [inicio, setInicio] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<{ whatsapp: string; link: string; semCpf: boolean } | null>(null);

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
    return j;
  }

  async function emitir() {
    setErro(null);
    const m = motivo === 'Outro' ? outro.trim() : motivo;
    if (m.length < 2) return setErro('Diga o motivo.');
    if (descricao.trim().length < 10) return setErro('Conte o que aconteceu (mínimo 10 letras).');
    setOcupado(true);
    // Abre a aba já no clique (o celular bloqueia janela aberta depois do await).
    const janela = window.open('', '_blank');
    try {
      const doc = await post('/api/rh/advertencia', {
        funcionarioId: props.funcionarioId,
        tipo,
        motivo: m,
        descricao: descricao.trim(),
        dataFato,
        dias: tipo === 'suspensao' ? dias : null,
        inicioSuspensao: tipo === 'suspensao' && inicio ? inicio : null,
      });
      const ass = await post('/api/rh/assinatura', { acao: 'criar', documentoId: doc.documentoId });
      setPronto({ whatsapp: ass.whatsapp, link: ass.link, semCpf: !!ass.semCpf });
      if (janela) janela.location.href = ass.whatsapp;
      setDescricao('');
      setOutro('');
      setAberto(false);
      router.refresh();
    } catch (e) {
      janela?.close();
      setErro(e instanceof Error ? e.message : 'erro');
    } finally {
      setOcupado(false);
    }
  }

  const docs = props.docs.slice().reverse();
  return (
    <div className="space-y-3 text-sm">
      {docs.length === 0 ? (
        <p className="text-slate-500">Nenhuma advertência ou suspensão.</p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="rounded border border-slate-200 px-3 py-2">
              <span className="font-medium">{d.tipo === 'suspensao' ? '⛔ Suspensão' : '⚠️ Advertência'}</span>
              <span className="text-slate-600"> · {d.descricao ?? ''}</span>
              <span className="text-slate-400"> · emitida {dataCurta(d.criadoEm)}</span>
              <span className="ml-2">
                <a href={`/api/rh/documento?id=${d.id}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  ver documento
                </a>
              </span>
              <AssinaturaDoc documentoId={d.id} assinatura={d.assinatura ?? null} pode={props.pode} />
            </li>
          ))}
        </ul>
      )}

      {pronto && (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          Documento gerado. Se o WhatsApp não abriu,{' '}
          <a href={pronto.whatsapp} target="_blank" rel="noreferrer" className="font-medium underline">
            toque aqui pra mandar
          </a>
          . Quando a pessoa assinar, aparece ✅ aqui.
          {pronto.semCpf && <span className="block text-[11px] text-emerald-700">(sem CPF no cadastro — a pessoa digita o dela)</span>}
        </div>
      )}

      {props.pode && !aberto && (
        <button
          type="button"
          onClick={() => {
            setAberto(true);
            setPronto(null);
          }}
          className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
        >
          ⚠️ Dar advertência
        </button>
      )}

      {props.pode && aberto && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1">
              <input type="radio" checked={tipo === 'advertencia'} onChange={() => setTipo('advertencia')} /> Advertência
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={tipo === 'suspensao'} onChange={() => setTipo('suspensao')} /> Suspensão
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-600">Motivo</span>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5">
                {MOTIVOS_ADVERTENCIA.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Data do fato</span>
              <input type="date" max={hojeBr()} value={dataFato} onChange={(e) => setDataFato(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5" />
            </label>
          </div>
          {motivo === 'Outro' && (
            <input
              value={outro}
              onChange={(e) => setOutro(e.target.value)}
              placeholder="Qual o motivo?"
              maxLength={120}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            />
          )}
          {tipo === 'suspensao' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-slate-600">Dias de suspensão</span>
                <input type="number" min={1} max={30} value={dias} onChange={(e) => setDias(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-600">A partir de</span>
                <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5" />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-xs text-slate-600">O que aconteceu (vai escrito no documento)</span>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Ex.: No dia 08/11, fechou a mesa 8 cobrando a mais e não conferiu a conta com o cliente."
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
          {!props.temTelefone && <p className="text-xs text-amber-800">Sem telefone no cadastro: o WhatsApp abre e você escolhe o contato.</p>}
          {erro && <p className="text-red-600">{erro}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={ocupado} onClick={emitir} className="rounded bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {ocupado ? 'gerando…' : '📲 Emitir e mandar no WhatsApp'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => setAberto(false)} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-white">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
