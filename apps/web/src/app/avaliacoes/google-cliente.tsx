'use client';

// Parte do bloco "Google" que roda no navegador: o aviso da volta da ligação, o
// quadro de responder uma avaliação (IA escreve o rascunho, a pessoa confere e
// publica) e a escolha de qual ficha do Google é a de cada casa.
// Nada aqui publica sozinho: "Publicar no Google" só roda no clique, depois da
// confirmação.

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const campo =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none';

/** O Google aceita até 4096 bytes na resposta da casa. */
const MAX_BYTES = 4096;
const SO_NOTA = 'O cliente deu só a nota, sem escrever comentário.';

// ------------------------------------------------------------------ aviso ---

const AVISOS: Record<string, { tom: 'ok' | 'atencao' | 'erro'; texto: string }> = {
  ok: { tom: 'ok', texto: 'Conta Google ligada. As avaliações de cada casa aparecem logo abaixo.' },
  'ok-escolher': {
    tom: 'atencao',
    texto: 'Conta Google ligada. Falta escolher a ficha de alguma casa — confira em "Ficha de cada casa", logo abaixo.',
  },
  'ligado-sem-api': {
    tom: 'atencao',
    texto:
      'Conta Google ligada, mas o Google ainda não deixou ler as fichas: o pedido de acesso à API do projeto não foi liberado, ou as APIs do Perfil da Empresa não foram ativadas. Quando liberar, escolha a ficha de cada casa aqui.',
  },
  negado: { tom: 'atencao', texto: 'A autorização foi cancelada na tela do Google. Nada mudou.' },
  'sem-chave': { tom: 'erro', texto: 'O Google não devolveu a chave da ligação. Tente ligar de novo.' },
  'sem-escopo': {
    tom: 'erro',
    texto:
      'Faltou marcar, na tela do Google, a permissão de gerenciar o Perfil da Empresa. Ligue de novo e marque a caixa.',
  },
  estado: {
    tom: 'erro',
    texto: 'A volta do Google não bateu com o pedido (passou de 10 minutos ou veio de outra aba). Tente ligar de novo.',
  },
  'sem-permissao': { tom: 'erro', texto: 'Seu usuário não pode configurar as avaliações.' },
  'falta-env': {
    tom: 'erro',
    texto: 'Faltam as chaves do Google na Vercel (GOOGLE_BUSINESS_CLIENT_ID e GOOGLE_BUSINESS_CLIENT_SECRET).',
  },
  erro: { tom: 'erro', texto: 'Não deu pra concluir a ligação com o Google. Tente de novo.' },
};

const TOM = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  atencao: 'border-amber-200 bg-amber-50 text-amber-900',
  erro: 'border-rose-200 bg-rose-50 text-rose-900',
};

/** Resultado do "Ligar conta Google" (a volta vem com ?google=...). */
export function AvisoGoogle() {
  const codigo = useSearchParams().get('google') ?? '';
  const aviso = AVISOS[codigo];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aviso) ref.current?.scrollIntoView({ block: 'center' });
  }, [aviso]);
  if (!aviso) return null;
  return (
    <div ref={ref} className={`mt-3 rounded-lg border px-4 py-3 text-sm ${TOM[aviso.tom]}`}>
      {aviso.texto}
    </div>
  );
}

// -------------------------------------------------------------- responder ---

interface ResponderProps {
  filialId: string;
  reviewId: string;
  nota: number | null;
  /** o que o cliente escreveu (vazio quando deu só a nota) */
  texto: string;
  /** resposta da casa que já está no Google, se houver */
  respostaAtual: string;
}

export function ResponderGoogle({ filialId, reviewId, nota, texto, respostaAtual }: ResponderProps) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [orientacao, setOrientacao] = useState('');
  const [rascunho, setRascunho] = useState(respostaAtual);
  const [conferir, setConferir] = useState<string[]>([]);
  const [gerando, setGerando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState('');
  const [publicada, setPublicada] = useState(false);

  const bytes = new TextEncoder().encode(rascunho.trim()).length;
  const grande = bytes > MAX_BYTES;

  async function gerar() {
    setGerando(true);
    setErro('');
    try {
      const r = await fetch('/api/avaliacoes/sugerir-resposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          canal: 'google',
          nota,
          texto: (texto.trim().length >= 5 ? texto : SO_NOTA).slice(0, 4000),
          orientacao,
        }),
      });
      const j = (await r.json().catch(() => null)) as
        | { resposta?: string; conferir?: string[]; error?: string }
        | null;
      if (!r.ok || !j?.resposta) {
        setErro(j?.error || 'Não consegui escrever agora. Tente de novo.');
        return;
      }
      setRascunho(j.resposta);
      setConferir(Array.isArray(j.conferir) ? j.conferir : []);
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setGerando(false);
    }
  }

  async function publicar() {
    if (!window.confirm('Publicar esta resposta no Google, em nome da casa? Ela fica pública na ficha.')) return;
    setPublicando(true);
    setErro('');
    try {
      const r = await fetch('/api/avaliacoes/google/responder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, reviewId, texto: rascunho }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        setErro(j?.error || 'O Google não aceitou a resposta. Tente de novo.');
        return;
      }
      setPublicada(true);
      setAberto(false);
      router.refresh();
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setPublicando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          onClick={() => {
            setAberto(true);
            setPublicada(false);
          }}
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          {respostaAtual || publicada ? 'editar resposta' : 'responder'}
        </button>
        {publicada && (
          <span className="text-xs text-emerald-700">
            ✓ Enviada ao Google — pode levar alguns minutos pra aparecer na ficha.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        O que a casa apurou ou quer dizer (opcional)
        <input
          value={orientacao}
          onChange={(e) => setOrientacao(e.target.value)}
          maxLength={800}
          placeholder="Ex.: já conversamos com a equipe"
          className={campo}
        />
      </label>
      <button
        onClick={gerar}
        disabled={gerando || publicando}
        className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {gerando ? 'Escrevendo…' : rascunho.trim() ? '✨ Escrever de novo com IA' : '✨ Escrever com IA'}
      </button>

      <label className="mt-3 flex flex-col gap-1 text-xs text-slate-600">
        Resposta da casa — escreva ou ajuste o rascunho
        <textarea value={rascunho} onChange={(e) => setRascunho(e.target.value)} rows={6} className={campo} />
      </label>
      {grande && (
        <p className="mt-1 text-xs text-rose-700">O texto passou do tamanho que o Google aceita. Encurte um pouco.</p>
      )}

      {conferir.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Antes de publicar, confira:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {conferir.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={publicar}
          disabled={publicando || gerando || grande || rascunho.trim().length < 2}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {publicando ? 'Publicando…' : 'Publicar no Google'}
        </button>
        <button onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">
          fechar
        </button>
        {erro && <span className="text-xs text-rose-700">{erro}</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        A resposta fica pública na ficha da casa. Texto de IA: leia inteiro antes de publicar.
      </p>
    </div>
  );
}

// ------------------------------------------------------- ficha de cada casa ---

interface FichaOpcao {
  ficha: string;
  titulo: string;
  endereco: string;
}
interface CasaFicha {
  id: string;
  nome: string;
  atual: string;
  sugestao: string;
}

/** Quem configura diz qual ficha do Google é a de cada casa. */
export function EscolherFichas({ abrirDeCara, semFicha }: { abrirDeCara: boolean; semFicha: string[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [fichas, setFichas] = useState<FichaOpcao[]>([]);
  const [casas, setCasas] = useState<CasaFicha[]>([]);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState('');
  const [salvo, setSalvo] = useState<Record<string, boolean>>({});

  async function carregar() {
    setAberto(true);
    setCarregando(true);
    setErro('');
    try {
      const r = await fetch('/api/avaliacoes/google/fichas', { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as
        | { ok?: boolean; fichas?: FichaOpcao[]; casas?: CasaFicha[]; error?: string }
        | null;
      if (!r.ok || !j?.ok) {
        setErro(j?.error || 'Não consegui buscar as fichas no Google agora.');
        return;
      }
      const cs = j.casas ?? [];
      setFichas(j.fichas ?? []);
      setCasas(cs);
      setEscolha(Object.fromEntries(cs.map((c) => [c.id, c.atual || c.sugestao])));
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setCarregando(false);
    }
  }

  // nenhuma casa com ficha escolhida: já abre a lista, é o passo que falta
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (abrirDeCara && !jaAbriu.current) {
      jaAbriu.current = true;
      void carregar();
    }
  }, [abrirDeCara]);

  async function salvar(casa: CasaFicha) {
    setSalvando(casa.id);
    setErro('');
    try {
      const r = await fetch('/api/avaliacoes/google/fichas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId: casa.id, ficha: escolha[casa.id] ?? '' }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        setErro(j?.error || 'Não consegui salvar. Tente de novo.');
        return;
      }
      setCasas((cs) => cs.map((c) => (c.id === casa.id ? { ...c, atual: escolha[casa.id] ?? '' } : c)));
      setSalvo((s) => ({ ...s, [casa.id]: true }));
      router.refresh();
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSalvando('');
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Ficha de cada casa</h3>
        <a href="/api/avaliacoes/google/conectar" className="text-xs font-medium text-emerald-700 hover:underline">
          ligar a conta Google de novo
        </a>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Diga qual ficha do Google é a de cada casa. Casa sem ficha não aparece no bloco.
        {semFicha.length > 0 && ` Sem ficha hoje: ${semFicha.join(', ')}.`}
      </p>

      {!aberto && (
        <button
          onClick={carregar}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Ver ou trocar as fichas
        </button>
      )}
      {carregando && <p className="mt-3 text-xs text-slate-500">Buscando as fichas no Google…</p>}
      {erro && <p className="mt-3 text-xs text-rose-700">{erro}</p>}

      {aberto && !carregando && casas.length > 0 && (
        <ul className="mt-3 space-y-3">
          {casas.map((c) => {
            const v = escolha[c.id] ?? '';
            return (
              <li key={c.id} className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-600">
                  {c.nome}
                  <select
                    value={v}
                    onChange={(e) => {
                      setEscolha((s) => ({ ...s, [c.id]: e.target.value }));
                      setSalvo((s) => ({ ...s, [c.id]: false }));
                    }}
                    className={campo}
                  >
                    <option value="">— sem ficha —</option>
                    {fichas.map((f) => (
                      <option key={f.ficha} value={f.ficha}>
                        {f.titulo}
                        {f.endereco ? ` — ${f.endereco}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => salvar(c)}
                  disabled={salvando === c.id || v === c.atual}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {salvando === c.id ? 'Salvando…' : 'Salvar'}
                </button>
                {salvo[c.id] ? (
                  <span className="pb-1.5 text-xs text-emerald-700">✓ salvo</span>
                ) : (
                  !c.atual && v && <span className="pb-1.5 text-xs text-amber-700">sugestão pelo nome — confira e salve</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {aberto && !carregando && !erro && fichas.length === 0 && (
        <p className="mt-3 text-xs text-slate-500">
          A conta Google ligada não administra nenhuma ficha. Ligue de novo com a conta que administra as fichas das casas.
        </p>
      )}
    </div>
  );
}
