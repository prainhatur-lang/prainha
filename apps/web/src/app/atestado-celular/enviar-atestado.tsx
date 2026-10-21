'use client';

// Celular: tira a foto do atestado (ou escolhe foto/PDF), sobe direto pro
// bucket, a IA lê quem é e os dias, e a pessoa confirma se abona.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { comprimirImagem } from '@/lib/comprimir-imagem';
import type { LeituraVista, PessoaCasa } from '@/lib/rh/atestado-ler';
import { CartaoLeitura, type Confirmacao } from '../rh/banco-horas/cartao-leitura';

type Fase =
  | { tipo: 'escolher' }
  | { tipo: 'enviando'; texto: string }
  | { tipo: 'confirmar'; leitura: LeituraVista }
  | { tipo: 'feito'; nome: string; abona: boolean; dias: string };

function dmy(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function EnviarAtestado({ f, u, e, s, casa }: { f: string; u: string; e: number; s: string; casa: string }) {
  const [fase, setFase] = useState<Fase>({ tipo: 'escolher' });
  const [pessoas, setPessoas] = useState<PessoaCasa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const arqRef = useRef<HTMLInputElement>(null);
  // Bipe: iPhone não vibra; o som só sai depois de um toque na tela.
  const somRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    somRef.current = ctx;
    const destravar = () => void ctx.resume().catch(() => {});
    window.addEventListener('pointerdown', destravar);
    window.addEventListener('touchend', destravar);
    return () => {
      window.removeEventListener('pointerdown', destravar);
      window.removeEventListener('touchend', destravar);
      somRef.current = null;
      void ctx.close().catch(() => {});
    };
  }, []);

  useEffect(() => () => {
    if (previa) URL.revokeObjectURL(previa);
  }, [previa]);

  function bipe(ok: boolean) {
    const ctx = somRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const tons = ok ? [1300, 1800] : [300];
    const dur = ok ? 0.11 : 0.35;
    tons.forEach((freq, i) => {
      const t0 = ctx.currentTime + i * (dur + 0.05);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.3, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + dur);
    });
    navigator.vibrate?.(ok ? 80 : [60, 60, 60]);
  }

  async function api(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch('/api/atestado-celular', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ f, u, e, s, ...body }),
    });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new Error(String(j?.error ?? 'Não deu certo'));
    return j ?? {};
  }

  async function escolheu(file: File | undefined) {
    if (!file) return;
    setErro(null);
    try {
      let arquivo: File = file;
      const ehPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!ehPdf) {
        setFase({ tipo: 'enviando', texto: 'Preparando a foto…' });
        const r = await comprimirImagem(file, { maxLado: 2200, qualidade: 0.85 });
        arquivo = r.arquivo;
        setPrevia(URL.createObjectURL(arquivo));
      } else {
        setPrevia(null);
      }
      setFase({ tipo: 'enviando', texto: 'Enviando…' });
      const p = await api({ acao: 'upload_url', nome: arquivo.name || 'atestado.jpg', tamanho: arquivo.size });
      const up = await createClient()
        .storage.from(String(p.bucket))
        .uploadToSignedUrl(String(p.path), String(p.token), arquivo, {
          contentType: arquivo.type || (ehPdf ? 'application/pdf' : 'image/jpeg'),
        });
      if (up.error) throw new Error(`não consegui guardar a foto: ${up.error.message}`);
      setFase({ tipo: 'enviando', texto: 'Lendo o atestado… (uns 20 segundos)' });
      const r = await api({ acao: 'ler', path: String(p.path), nome: arquivo.name || 'atestado.jpg' });
      setPessoas((r.pessoas as PessoaCasa[]) ?? []);
      const leitura = r.leitura as LeituraVista;
      bipe(!leitura.erro);
      setFase({ tipo: 'confirmar', leitura });
    } catch (err) {
      bipe(false);
      setErro(err instanceof Error ? err.message : 'Não deu certo');
      setFase({ tipo: 'escolher' });
    } finally {
      if (camRef.current) camRef.current.value = '';
      if (arqRef.current) arqRef.current.value = '';
    }
  }

  async function confirmar(leitura: LeituraVista, c: Confirmacao) {
    setOcupado(true);
    setErro(null);
    try {
      await api({ acao: 'confirmar', leituraId: leitura.id, ...c });
      bipe(true);
      const nome = pessoas.find((p) => p.id === c.funcionarioId)?.nome ?? '';
      const dias = c.dataInicio === c.dataFim ? dmy(c.dataInicio) : `${dmy(c.dataInicio)} a ${dmy(c.dataFim)}`;
      setFase({ tipo: 'feito', nome, abona: c.abona, dias });
    } catch (err) {
      bipe(false);
      setErro(err instanceof Error ? err.message : 'Não deu certo');
    } finally {
      setOcupado(false);
    }
  }

  async function descartar(leitura: LeituraVista) {
    if (!window.confirm('Descartar esta foto? Ela não entra como atestado.')) return;
    setOcupado(true);
    try {
      await api({ acao: 'descartar', leituraId: leitura.id });
    } catch {
      /* já descartada */
    }
    setOcupado(false);
    setPrevia(null);
    setFase({ tipo: 'escolher' });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">🩺 Atestado</h1>
        {casa && <p className="text-xs text-slate-500">{casa}</p>}
      </div>

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

      {fase.tipo === 'escolher' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Tire a foto do atestado inteiro, com boa luz. O sistema lê o nome e os dias e pergunta se abona.
          </p>
          <button
            type="button"
            onClick={() => camRef.current?.click()}
            className="w-full rounded-xl bg-sky-700 px-4 py-5 text-base font-semibold text-white shadow active:bg-sky-800"
          >
            📷 Tirar foto do atestado
          </button>
          <button
            type="button"
            onClick={() => arqRef.current?.click()}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-sm font-medium text-slate-700 active:bg-slate-100"
          >
            📄 Escolher foto ou PDF
          </button>
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(ev) => void escolheu(ev.target.files?.[0])}
          />
          <input
            ref={arqRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(ev) => void escolheu(ev.target.files?.[0])}
          />
        </div>
      )}

      {fase.tipo === 'enviando' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-700" />
          {fase.texto}
        </div>
      )}

      {previa && fase.tipo !== 'escolher' && fase.tipo !== 'feito' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previa} alt="Foto do atestado" className="max-h-64 w-full rounded-xl border border-slate-200 object-contain bg-white" />
      )}

      {fase.tipo === 'confirmar' && (
        <CartaoLeitura
          leitura={fase.leitura}
          pessoas={pessoas}
          ocupado={ocupado}
          onConfirmar={(c) => void confirmar(fase.leitura, c)}
          onDescartar={() => void descartar(fase.leitura)}
        />
      )}

      {fase.tipo === 'feito' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="text-base font-semibold">✅ Atestado lançado</div>
            <div className="mt-1">
              {fase.nome} · {fase.dias}
            </div>
            <div className="mt-1 text-xs">
              {fase.abona ? 'Abonado no banco de horas.' : 'Guardado sem abonar (a falta segue contando).'} A foto fica no
              RH → Banco de horas.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrevia(null);
              setFase({ tipo: 'escolher' });
            }}
            className="w-full rounded-xl bg-sky-700 px-4 py-4 text-base font-semibold text-white active:bg-sky-800"
          >
            Mandar outro atestado
          </button>
        </div>
      )}
    </div>
  );
}
