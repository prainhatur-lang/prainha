'use client';

import { useState } from 'react';

interface Grupo {
  grupo: string;
  total: number;
  enviados: number;
  pendentes: number;
  erros: number;
  clicaram: number;
  recusaram: number;
}
interface Resumo {
  grupos: Grupo[];
  enviadosHoje: number;
  tetoDia: number;
}
interface Props {
  campanha: { slug: string; titulo: string; template: string; imagemUrl: string; texto: string };
  inicial: Resumo;
  podeEnviar: boolean;
  whatsapp: boolean;
}

export function CampanhaClient({ campanha, inicial, podeEnviar, whatsapp }: Props) {
  const [resumo, setResumo] = useState<Resumo>(inicial);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [falhas, setFalhas] = useState<Array<{ nome: string; erro: string }>>([]);
  const [foneTeste, setFoneTeste] = useState('');
  const [nomeTeste, setNomeTeste] = useState('');
  const [qtd, setQtd] = useState(50);
  const [grupo, setGrupo] = useState('');

  const tot = resumo.grupos.reduce(
    (a, g) => ({
      total: a.total + g.total,
      enviados: a.enviados + g.enviados,
      pendentes: a.pendentes + g.pendentes,
      erros: a.erros + g.erros,
      clicaram: a.clicaram + g.clicaram,
      recusaram: a.recusaram + g.recusaram,
    }),
    { total: 0, enviados: 0, pendentes: 0, erros: 0, clicaram: 0, recusaram: 0 },
  );
  const saldoHoje = Math.max(0, resumo.tetoDia - resumo.enviadosHoje);

  async function chamar(acao: string, extra: Record<string, unknown> = {}) {
    setOcupado(acao);
    setAviso(null);
    try {
      const r = await fetch('/api/campanha', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao, campanha: campanha.slug, ...extra }),
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) {
        setAviso({ tipo: 'erro', texto: j?.erro || `Falhou (${r.status})` });
        return null;
      }
      if (Array.isArray(j.grupos)) setResumo({ grupos: j.grupos, enviadosHoje: j.enviadosHoje, tetoDia: j.tetoDia });
      return j as Record<string, unknown>;
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function carregar() {
    const j = await chamar('carregar');
    if (j) setAviso({ tipo: 'ok', texto: `${j.novos} convidados novos na lista.` });
  }

  async function teste() {
    if (!confirm(`Mandar o convite de teste pro número ${foneTeste}?`)) return;
    const j = await chamar('teste', { telefone: foneTeste, nome: nomeTeste });
    if (j) setAviso({ tipo: 'ok', texto: 'Teste enviado. Confira o WhatsApp.' });
  }

  async function enviar() {
    const n = Math.min(qtd, saldoHoje, tot.pendentes);
    if (!confirm(`Mandar o convite pra ${n} cliente${n === 1 ? '' : 's'}${grupo ? ` de ${grupo}` : ''} agora?`)) return;
    const j = await chamar('enviar', { qtd, grupo });
    if (!j) return;
    setFalhas((j.falhas as Array<{ nome: string; erro: string }>) ?? []);
    setAviso(
      j.parou
        ? { tipo: 'erro', texto: `${j.enviados} enviados. Parou: ${j.parou}` }
        : { tipo: 'ok', texto: `${j.enviados} convites enviados.` },
    );
  }

  async function recolocar() {
    const j = await chamar('recolocar');
    if (j) setAviso({ tipo: 'ok', texto: `${j.recolocados} voltaram pra fila.` });
  }

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Convite por WhatsApp</h1>
        <p className="text-sm text-slate-500">{campanha.titulo}</p>
      </div>

      {aviso && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            aviso.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {aviso.texto}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Na lista', tot.total],
          ['Enviados', tot.enviados],
          ['Na fila', tot.pendentes],
          ['Abriram o link', `${tot.clicaram} (${pct(tot.clicaram, tot.enviados)})`],
          ['Não querem', tot.recusaram],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs text-slate-500">{rotulo}</div>
            <div className="text-lg font-semibold text-slate-900">{valor}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Bairro</th>
              <th className="px-4 py-2 text-right">Na lista</th>
              <th className="px-4 py-2 text-right">Enviados</th>
              <th className="px-4 py-2 text-right">Na fila</th>
              <th className="px-4 py-2 text-right">Falhas</th>
              <th className="px-4 py-2 text-right">Abriram</th>
              <th className="px-4 py-2 text-right">Não querem</th>
            </tr>
          </thead>
          <tbody>
            {resumo.grupos.map((g) => (
              <tr key={g.grupo} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{g.grupo}</td>
                <td className="px-4 py-2 text-right">{g.total}</td>
                <td className="px-4 py-2 text-right">{g.enviados}</td>
                <td className="px-4 py-2 text-right">{g.pendentes}</td>
                <td className="px-4 py-2 text-right">{g.erros}</td>
                <td className="px-4 py-2 text-right">{g.clicaram}</td>
                <td className="px-4 py-2 text-right">{g.recusaram}</td>
              </tr>
            ))}
            {!resumo.grupos.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  A lista ainda não foi montada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {podeEnviar && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          {!whatsapp && (
            <p className="text-sm text-amber-700">WhatsApp não está configurado neste ambiente — o envio só funciona no app publicado.</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={carregar}
              disabled={!!ocupado}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {ocupado === 'carregar' ? 'Montando…' : tot.total ? 'Atualizar a lista' : 'Montar a lista'}
            </button>
            <span className="text-xs text-slate-500">
              Clientes do cadastro com celular, dos bairros da campanha. Quem já está na lista não é duplicado.
            </span>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 text-sm font-medium text-slate-800">1. Mandar um teste pro seu número</div>
            <div className="flex flex-wrap gap-2">
              <input
                value={nomeTeste}
                onChange={(e) => setNomeTeste(e.target.value)}
                placeholder="Seu nome"
                className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={foneTeste}
                onChange={(e) => setFoneTeste(e.target.value)}
                placeholder="79 99999-9999"
                inputMode="tel"
                className="w-44 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={teste}
                disabled={!!ocupado || !foneTeste.trim()}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {ocupado === 'teste' ? 'Enviando…' : 'Enviar teste'}
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 text-sm font-medium text-slate-800">2. Mandar o próximo lote</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Todos os bairros</option>
                {resumo.grupos.map((g) => (
                  <option key={g.grupo} value={g.grupo}>
                    {g.grupo} ({g.pendentes} na fila)
                  </option>
                ))}
              </select>
              <select
                value={qtd}
                onChange={(e) => setQtd(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} convites
                  </option>
                ))}
              </select>
              <button
                onClick={enviar}
                disabled={!!ocupado || !tot.pendentes || !saldoHoje}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {ocupado === 'enviar' ? 'Enviando…' : 'Enviar lote'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Hoje: {resumo.enviadosHoje} de {resumo.tetoDia} convites. Vai primeiro quem comprou há menos tempo. Quem tocou em
              &quot;Não quero receber&quot; fica de fora.
            </p>
          </div>

          {tot.erros > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <button
                onClick={recolocar}
                disabled={!!ocupado}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Tentar de novo as {tot.erros} falhas
              </button>
              <span className="text-xs text-slate-500">Use depois de consertar o que travou (template, token).</span>
            </div>
          )}

          {falhas.length > 0 && (
            <ul className="space-y-1 border-t border-slate-100 pt-4 text-xs text-rose-700">
              {falhas.slice(0, 10).map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{f.nome}:</span> {f.erro}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-800">A mensagem</div>
        <p className="mb-3 text-xs text-slate-500">
          Template <span className="font-mono">{campanha.template}</span> (Marketing) — tem que estar aprovado na Meta com este texto, foto no
          cabeçalho e os botões &quot;Reservar minha mesa&quot; e &quot;Não quero receber&quot;.
        </p>
        <div className="max-w-sm rounded-lg bg-emerald-50 p-3 text-sm text-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={campanha.imagemUrl} alt="" className="mb-2 w-full rounded-md" />
          <p className="whitespace-pre-wrap">{campanha.texto}</p>
        </div>
      </div>
    </section>
  );
}
