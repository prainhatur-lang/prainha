'use client';

// Cartão "Envio automático pelo WhatsApp" do relatório diário: o dono cadastra
// os números que recebem, liga/desliga o envio das 07:00 e manda na hora.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatFone, pareceFixo } from '@/lib/format';

interface Envio {
  dia: string;
  telefone: string;
  canal: string;
  origem: string;
  ok: boolean;
  erro: string | null;
  quando: string;
}

interface Modelo {
  nome: string;
  situacao: 'aprovado' | 'em_analise' | 'recusado' | 'nao_existe' | 'indisponivel';
  detalhe: string | null;
  /** como o modelo está na Meta: posição do botão "Ver resumo" (null = sem botão) */
  botaoIndice?: number | null;
  textoPadrao?: boolean;
}

interface Props {
  organizacaoId: string;
  ativo: boolean;
  telefones: string[];
  envios: Envio[];
  dia: string;
  diaRotulo: string;
  modelo: Modelo;
  textoModelo: string;
}

const SITUACAO: Record<Modelo['situacao'], { rotulo: string; cor: string }> = {
  aprovado: { rotulo: 'aprovado pela Meta', cor: 'text-emerald-700' },
  em_analise: { rotulo: 'em análise na Meta', cor: 'text-amber-700' },
  recusado: { rotulo: 'recusado pela Meta', cor: 'text-rose-700' },
  nao_existe: { rotulo: 'ainda não criado', cor: 'text-rose-700' },
  indisponivel: { rotulo: 'não consegui consultar', cor: 'text-slate-500' },
};

const CANAL: Record<string, string> = {
  modelo: 'aviso curto (modelo)',
  texto: 'relatório completo',
  toque: 'pediu o relatório',
};
const ORIGEM: Record<string, string> = {
  cron: 'automático das 07:00',
  manual: 'enviado pela tela',
  toque: 'toque no botão',
  pedido: 'pedido por mensagem',
};

function diaCurto(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function EnvioCard({
  organizacaoId,
  ativo: ativoInicial,
  telefones,
  envios,
  dia,
  diaRotulo,
  modelo: modeloInicial,
  textoModelo,
}: Props) {
  const router = useRouter();
  const [ativo, setAtivo] = useState(ativoInicial);
  const [texto, setTexto] = useState(telefones.map((t) => formatFone(t)).join('\n'));
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; txt: string } | null>(null);
  // O que a tela acabou de saber da Meta vale até o servidor mandar o modelo de novo
  // (router.refresh) — senão o cartão ficava em "ainda não criado" depois de aprovado.
  const [modeloLocal, setModeloLocal] = useState<{ de: Modelo; valor: Modelo } | null>(null);
  const modelo = modeloLocal && modeloLocal.de === modeloInicial ? modeloLocal.valor : modeloInicial;
  const setModelo = (valor: Modelo) => setModeloLocal({ de: modeloInicial, valor });
  const existe = modelo.situacao === 'aprovado' || modelo.situacao === 'em_analise' || modelo.situacao === 'recusado';
  /** modelo criado na mão, sem o botão de resposta rápida */
  const semBotao = existe && modelo.botaoIndice === null;
  const [criando, setCriando] = useState(false);
  const [corrigindo, setCorrigindo] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [msgModelo, setMsgModelo] = useState<string | null>(null);

  const linhas = texto
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fixos = linhas.filter((l) => pareceFixo(l));

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/relatorios/diario/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizacaoId, ativo, telefones: linhas }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; config?: { telefones: string[] } } | null;
      if (!r.ok) {
        setMsg({ tom: 'erro', txt: j?.error ?? 'Não consegui salvar.' });
        return;
      }
      if (j?.config) setTexto(j.config.telefones.map((t) => formatFone(t)).join('\n'));
      setMsg({ tom: 'ok', txt: 'Salvo.' });
      router.refresh();
    } catch {
      setMsg({ tom: 'erro', txt: 'Sem conexão — tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  async function enviarAgora() {
    if (!window.confirm(`Mandar agora o relatório de ${diaRotulo} pros números cadastrados?`)) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/relatorios/diario/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizacaoId, dia }),
      });
      const j = (await r.json().catch(() => null)) as
        | { error?: string; resultados?: Array<{ telefone: string; canal: string; ok: boolean; erro?: string }> }
        | null;
      if (!r.ok) {
        setMsg({ tom: 'erro', txt: j?.error ?? 'Não consegui enviar.' });
        return;
      }
      const res = j?.resultados ?? [];
      const falhas = res.filter((x) => !x.ok);
      if (falhas.length) {
        setMsg({
          tom: 'erro',
          txt: falhas.map((f) => `${formatFone(f.telefone)}: ${f.erro ?? 'não foi'}`).join(' · '),
        });
      } else {
        const soAviso = res.every((x) => x.canal === 'modelo');
        setMsg({
          tom: 'ok',
          txt: !soAviso
            ? 'Relatório enviado no WhatsApp.'
            : semBotao
              ? 'Enviado o aviso com os números do dia — responda "relatório" na conversa pra receber o relatório completo.'
              : 'Enviado o aviso com o botão "Ver resumo" — toque nele no WhatsApp pra receber o relatório completo.',
        });
      }
      router.refresh();
    } catch {
      setMsg({ tom: 'erro', txt: 'Sem conexão — tente de novo.' });
    } finally {
      setEnviando(false);
    }
  }

  async function criarModelo() {
    if (
      !window.confirm(
        `Criar o modelo "${modelo.nome}" na conta do WhatsApp da casa e mandar pra análise da Meta?`,
      )
    )
      return;
    setCriando(true);
    setMsgModelo(null);
    try {
      const r = await fetch('/api/relatorios/diario/modelo', { method: 'POST' });
      const j = (await r.json().catch(() => null)) as { error?: string; modelo?: Modelo } | null;
      if (j?.modelo && j.modelo.situacao !== 'indisponivel') setModelo(j.modelo);
      if (!r.ok) setMsgModelo(j?.error ?? 'A Meta não aceitou criar o modelo.');
    } catch {
      setMsgModelo('Sem conexão — tente de novo.');
    } finally {
      setCriando(false);
    }
  }

  async function corrigirModelo() {
    if (
      !window.confirm(
        `Pôr o botão "Ver resumo" no modelo "${modelo.nome}"? A Meta analisa de novo (costuma levar minutos); enquanto isso o aviso só entra pra quem falou com o número da casa nas últimas 24 h.`,
      )
    )
      return;
    setCorrigindo(true);
    setMsgModelo(null);
    try {
      const r = await fetch('/api/relatorios/diario/modelo', { method: 'PATCH' });
      const j = (await r.json().catch(() => null)) as { error?: string; modelo?: Modelo } | null;
      if (j?.modelo && j.modelo.situacao !== 'indisponivel') setModelo(j.modelo);
      if (!r.ok) setMsgModelo(j?.error ?? 'A Meta não aceitou a correção.');
    } catch {
      setMsgModelo('Sem conexão — tente de novo.');
    } finally {
      setCorrigindo(false);
    }
  }

  async function conferirModelo() {
    setConferindo(true);
    setMsgModelo(null);
    try {
      const r = await fetch('/api/relatorios/diario/modelo', { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as { error?: string; modelo?: Modelo } | null;
      if (j?.modelo) setModelo(j.modelo);
      else setMsgModelo(j?.error ?? 'Não consegui consultar a Meta.');
    } catch {
      setMsgModelo('Sem conexão — tente de novo.');
    } finally {
      setConferindo(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Envio automático pelo WhatsApp</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Todo dia às 07:00 o sistema manda o relatório do dia anterior, das casas todas, pros números abaixo. A
            qualquer hora também dá pra escrever <strong>relatório</strong> (ou <strong>relatório hoje</strong>,{' '}
            <strong>relatório 02/10</strong>) pro WhatsApp da casa e ele responde na hora.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
          />
          Enviar todo dia às 07:00
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-slate-700" htmlFor="relatorio-telefones">
            Quem recebe (um WhatsApp por linha, com DDD)
          </label>
          <textarea
            id="relatorio-telefones"
            className="mt-1 h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
            placeholder="(79) 99999-0000"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {fixos.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {fixos.join(', ')} parece telefone fixo — fixo não recebe WhatsApp.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={enviarAgora}
              disabled={enviando || telefones.length === 0}
              title={telefones.length === 0 ? 'Salve um número primeiro' : undefined}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : `Enviar agora (${diaCurto(dia)})`}
            </button>
            {msg && (
              <span className={`text-xs ${msg.tom === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.txt}</span>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Regra do WhatsApp: mensagem longa só entra até 24 h depois que a pessoa falou com o número da casa. Fora
            disso vai um aviso curto com os números do dia (modelo <code>{modelo.nome}</code>).{' '}
            {semBotao
              ? 'Respondendo "relatório" na conversa, o relatório completo chega.'
              : 'Um toque no botão "Ver resumo" e o relatório completo chega.'}
          </p>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p>
              Modelo <code>{modelo.nome}</code>:{' '}
              <strong className={SITUACAO[modelo.situacao].cor}>{SITUACAO[modelo.situacao].rotulo}</strong>
              {modelo.detalhe ? <span className="text-slate-500"> — {modelo.detalhe}</span> : null}{' '}
              <button
                type="button"
                onClick={conferirModelo}
                disabled={conferindo}
                className="text-slate-500 underline hover:text-slate-700 disabled:opacity-50"
              >
                {conferindo ? 'conferindo…' : 'conferir de novo'}
              </button>
            </p>
            {modelo.situacao === 'aprovado' && (
              <p className="mt-1 text-slate-500">O aviso das 07:00 chega mesmo sem conversa aberta.</p>
            )}
            {modelo.situacao === 'em_analise' && (
              <p className="mt-1 text-slate-500">
                A Meta costuma responder em minutos. Enquanto isso, escreva <strong>relatório</strong> pro WhatsApp da
                casa que ele chega na hora.
              </p>
            )}
            {(modelo.situacao === 'nao_existe' || modelo.situacao === 'recusado') && (
              <>
                <p className="mt-1 text-slate-500">
                  Sem ele o aviso das 07:00 só entra pra quem falou com o número da casa nas últimas 24 h.
                  {modelo.situacao === 'recusado'
                    ? ' Recusado se resolve no painel da Meta (editar e reenviar o modelo).'
                    : ''}
                </p>
                <p className="mt-2 text-slate-500">Texto do corpo:</p>
                <pre className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-sans text-[11px] text-slate-600">
                  {textoModelo}
                </pre>
                <p className="mt-1 text-slate-500">
                  Mais um botão de <strong>resposta rápida</strong> escrito <strong>Ver resumo</strong> (na Meta: Botões
                  → Adicionar botão — não vai no texto do corpo).
                </p>
              </>
            )}
            {semBotao && (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                <p>
                  O modelo está na Meta <strong>sem o botão &quot;Ver resumo&quot;</strong>. O aviso das 07:00 chega do
                  mesmo jeito, com os números do dia; pra receber o relatório completo, responda{' '}
                  <strong>relatório</strong> na conversa.
                </p>
                {modelo.situacao !== 'em_analise' && (
                  <button
                    type="button"
                    onClick={corrigirModelo}
                    disabled={corrigindo}
                    className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {corrigindo ? 'Corrigindo…' : 'Corrigir modelo (pôr o botão)'}
                  </button>
                )}
              </div>
            )}
            {modelo.situacao === 'nao_existe' && (
              <button
                type="button"
                onClick={criarModelo}
                disabled={criando}
                className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {criando ? 'Criando…' : 'Criar modelo na Meta'}
              </button>
            )}
            {msgModelo && <p className="mt-2 text-rose-700">{msgModelo}</p>}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-700">Últimos envios</p>
          {envios.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">Nenhum envio ainda.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 text-xs">
              {envios.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="text-slate-700">
                    <span className="text-slate-400">{e.quando}</span> · {formatFone(e.telefone)} ·{' '}
                    {CANAL[e.canal] ?? e.canal} de {diaCurto(e.dia)}
                    <span className="text-slate-400"> ({ORIGEM[e.origem] ?? e.origem})</span>
                    {!e.ok && e.erro ? <span className="block text-rose-700">{e.erro}</span> : null}
                  </span>
                  <span className={e.ok ? 'shrink-0 text-emerald-700' : 'shrink-0 text-rose-700'}>
                    {e.ok ? 'ok' : 'falhou'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
