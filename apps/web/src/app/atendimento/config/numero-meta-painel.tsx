'use client';

// Situação de um número na Meta, logo abaixo de "Números conectados", e o botão
// que REGISTRA na API o número que ficou em "Pendente" no Gerenciador do
// WhatsApp (11/10, o da Tabuará). O PIN quem escolhe e digita é o dono — ele
// vira a verificação em duas etapas do número.

import { useCallback, useEffect, useState } from 'react';

interface Estado {
  numero: string | null;
  status: string | null;
  codigo: string | null;
  nomeStatus: string | null;
  qualidade: string | null;
  limite: string | null;
  podeEnviar: string | null;
  avisos: string[];
  erros: Array<{ codigo: number | null; descricao: string; solucao: string }>;
  registrado: boolean;
  erroLeitura?: string;
}

const STATUS: Record<string, string> = {
  CONNECTED: 'Conectado',
  PENDING: 'Pendente',
  FLAGGED: 'Sinalizado',
  RESTRICTED: 'Restrito',
  BANNED: 'Banido',
  DISCONNECTED: 'Desconectado',
  DELETED: 'Apagado',
  MIGRATED: 'Migrado',
};

const QUALIDADE: Record<string, { rotulo: string; cor: string }> = {
  GREEN: { rotulo: 'Alta', cor: 'text-emerald-700' },
  YELLOW: { rotulo: 'Média', cor: 'text-amber-700' },
  RED: { rotulo: 'Baixa', cor: 'text-rose-700' },
};

const LIMITE: Record<string, string> = {
  TIER_50: '50',
  TIER_250: '250',
  TIER_1K: '1.000',
  TIER_2K: '2.000',
  TIER_10K: '10.000',
  TIER_100K: '100.000',
  TIER_UNLIMITED: 'sem limite de',
};

const NOME: Record<string, string> = {
  APPROVED: 'aprovado',
  AVAILABLE_WITHOUT_REVIEW: 'liberado sem análise',
  PENDING_REVIEW: 'em análise',
  DECLINED: 'recusado',
  EXPIRED: 'expirado',
  NON_EXISTS: 'ainda não aprovado',
};

export function NumeroMetaPainel({ phoneNumberId }: { phoneNumberId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [lendo, setLendo] = useState(true);
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const ler = useCallback(async () => {
    setLendo(true);
    try {
      const r = await fetch(
        `/api/atendimento/numeros-meta/registrar?phoneNumberId=${encodeURIComponent(phoneNumberId)}`,
        { cache: 'no-store' },
      );
      const d = await r.json().catch(() => null);
      setEstado(r.ok ? (d?.estado ?? null) : null);
    } finally {
      setLendo(false);
    }
  }, [phoneNumberId]);

  useEffect(() => {
    ler();
  }, [ler]);

  async function registrar() {
    if (enviando || !/^\d{6}$/.test(pin)) return;
    const certo = window.confirm(
      `Registrar este número na API do WhatsApp com o PIN ${pin}?\n\nGuarde o PIN: ele passa a ser a verificação em duas etapas do número.`,
    );
    if (!certo) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/atendimento/numeros-meta/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumberId, pin }),
      });
      const d = await r.json().catch(() => null);
      if (d?.estado) setEstado(d.estado);
      if (r.ok) {
        setPin('');
        setMsg({
          ok: true,
          texto: 'Registrado. O Gerenciador do WhatsApp pode levar alguns minutos pra mostrar "Conectado".',
        });
      } else {
        setMsg({ ok: false, texto: d?.error ?? 'A Meta recusou o registro.' });
      }
    } finally {
      setEnviando(false);
    }
  }

  if (!estado) {
    return lendo ? <p className="ml-6 py-1 text-[11px] text-slate-400">lendo a situação na Meta…</p> : null;
  }
  if (estado.erroLeitura) {
    return (
      <p className="ml-6 py-1 text-[11px] text-slate-400">
        A Meta não respondeu sobre este número: {estado.erroLeitura}
      </p>
    );
  }

  const qualidade = estado.registrado ? QUALIDADE[estado.qualidade ?? ''] : undefined;
  const limite = estado.registrado ? LIMITE[estado.limite ?? ''] : undefined;
  const nome = NOME[estado.nomeStatus ?? ''];
  const detalhes = [...estado.erros.map((e) => `${e.codigo ?? ''} ${e.descricao} ${e.solucao}`.trim()), ...estado.avisos];

  return (
    <div className="mb-2 ml-6 text-[11px] text-slate-500">
      <p>
        Na Meta{estado.numero ? ` (${estado.numero})` : ''}:{' '}
        <b className={estado.status === 'CONNECTED' ? 'text-emerald-700' : 'text-amber-700'}>
          {STATUS[estado.status ?? ''] ?? estado.status ?? '—'}
        </b>
        {qualidade && (
          <>
            {' '}· qualidade <b className={qualidade.cor}>{qualidade.rotulo}</b>
          </>
        )}
        {limite && <> · {limite} conversas iniciadas pela casa a cada 24 h</>}
        {nome && <> · nome {nome}</>}
      </p>
      {estado.registrado && estado.qualidade === 'YELLOW' && (
        <p className="mt-0.5 text-amber-700">
          Qualidade Média: clientes bloquearam ou denunciaram mensagens deste número nos últimos dias. Enquanto não
          voltar pra Alta, a Meta não aumenta o limite de envio.
        </p>
      )}
      {estado.registrado && estado.qualidade === 'RED' && (
        <p className="mt-0.5 text-rose-700">
          Qualidade Baixa: muitos bloqueios ou denúncias. Segure os envios em massa até a nota voltar a subir.
        </p>
      )}

      {!estado.registrado && estado.codigo === 'VERIFIED' && (
        <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
          <p className="font-medium">Este número ainda não foi registrado na API do WhatsApp.</p>
          <p className="mt-0.5">
            O código já foi confirmado, mas falta o registro — é por isso que ele fica em &quot;Pendente&quot; no
            Gerenciador e não envia nem recebe. Esse passo não tem botão na Meta; é feito aqui. Escolha um PIN de 6
            dígitos e guarde: ele vira a verificação em duas etapas do número.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="PIN de 6 dígitos"
              className="w-36 rounded-md border border-amber-300 bg-white px-2 py-1 font-mono text-sm tracking-widest text-slate-900"
            />
            <button
              type="button"
              onClick={registrar}
              disabled={enviando || pin.length !== 6}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {enviando ? 'Registrando…' : 'Registrar número'}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-amber-800">
            A Meta só aceita 10 tentativas de registro por número a cada 72 horas.
          </p>
        </div>
      )}
      {!estado.registrado && estado.codigo !== 'VERIFIED' && (
        <p className="mt-1 text-amber-700">
          O código de confirmação (SMS ou ligação) deste número ainda não foi validado. Conclua essa etapa no
          Gerenciador do WhatsApp → Números de telefone; depois o botão de registrar aparece aqui.
        </p>
      )}

      {msg && <p className={`mt-1 font-medium ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.texto}</p>}

      {detalhes.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-slate-400">o que a Meta diz</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-500">
            {detalhes.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
