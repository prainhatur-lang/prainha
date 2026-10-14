'use client';

// Com o "📱 Ler pelo celular" ligado nesta aba, a página da nota continua
// acompanhando o celular: leu outra chave → avisa e abre a outra nota sozinho
// em 3 s ("Ficar nesta" segura, pra não perder o que está fazendo aqui).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';
import { painelLigado, sessaoGuardada } from '../sessao-celular';

interface Lida {
  id: string;
  notaId: string | null;
  status: string | null;
  numero: string | null;
  emitNome: string | null;
  valorTotal: string | null;
}

const ESPERA_S = 3;

export function CelularLeuOutra({ filialId, notaId }: { filialId: string; notaId: string }) {
  const router = useRouter();
  const [outra, setOutra] = useState<Lida | null>(null);
  const [falta, setFalta] = useState(0);
  const [segurou, setSegurou] = useState(false);

  useEffect(() => {
    setOutra(null);
    if (!painelLigado(filialId)) return;
    const sessao = sessaoGuardada(filialId);
    if (!sessao) return;
    let vivo = true;
    let base: Set<string> | null = null;
    const desde = new Date().toISOString();
    async function verificar() {
      if (document.hidden) return;
      try {
        const q = new URLSearchParams({ filialId, desde, e: String(sessao!.e) });
        const r = await fetch(`/api/nota-chave/chegaram?${q}`, { cache: 'no-store' });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; lidas?: Lida[] };
        if (!vivo || !d.ok) return;
        const ls = d.lidas ?? [];
        if (base === null) {
          base = new Set(ls.map((l) => l.id));
          return;
        }
        const vistas = base;
        const nova = ls.find((l) => !vistas.has(l.id) && l.notaId && l.notaId !== notaId);
        ls.forEach((l) => vistas.add(l.id));
        if (nova) {
          setOutra(nova);
          setSegurou(false);
          setFalta(ESPERA_S);
        }
      } catch {
        // sem rede agora — tenta no próximo
      }
    }
    void verificar();
    const t = setInterval(verificar, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [filialId, notaId]);

  // contagem pra abrir a outra nota
  useEffect(() => {
    if (!outra?.notaId || segurou) return;
    if (falta <= 0) {
      router.push(`/movimento/entrada-notas/${outra.notaId}`);
      return;
    }
    const t = setTimeout(() => setFalta((f) => f - 1), 1000);
    return () => clearTimeout(t);
  }, [outra, falta, segurou, router]);

  if (!outra?.notaId) return null;
  const href = `/movimento/entrada-notas/${outra.notaId}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
      <p className="text-sm font-semibold text-emerald-900">
        📱 O celular leu outra nota: {outra.emitNome ?? 'Nota'}
        {outra.numero ? ` · NF ${outra.numero}` : ''}
        {outra.valorTotal ? ` · ${brl(outra.valorTotal)}` : ''}
        {outra.status === 'JA_EXISTE' ? ' (já estava no sistema)' : ''}
        {!segurou && falta > 0 ? ` — abrindo em ${falta}s...` : ''}
      </p>
      <Link
        href={href}
        className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
      >
        Abrir agora →
      </Link>
      {!segurou && (
        <button
          type="button"
          onClick={() => setSegurou(true)}
          className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          Ficar nesta
        </button>
      )}
    </div>
  );
}
