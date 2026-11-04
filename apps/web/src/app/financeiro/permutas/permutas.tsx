'use client';

// Tela de permutas (31/10/2026): lista os contratos com o crédito de cada casa
// e o formulário "Nova permuta" (sobe o contrato, divide o valor entre as casas).
// 04/11/2026: várias fotos/PDF do contrato, "Ler com IA" preenche o formulário,
// e o contrato pode virar crédito (como antes), conta a receber ou conta a pagar.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { brl, maskCnpj, parseValorBr } from '@/lib/format';

export interface CasaOpcao {
  id: string;
  nome: string;
}

export interface CreditoLinha {
  id: string;
  casa: string;
  valor: number;
  status: string;
  codigo: number | null;
  erro: string | null;
  fiadoStatus: string | null;
  fiadoErro: string | null;
  saldo: number | null;
  fiadoDesligado: boolean;
  contaPagarIds: string[] | null;
}

export type TipoPermuta = 'credito' | 'receber' | 'pagar';

const TIPOS: Array<{ id: TipoPermuta; nome: string; ajuda: string }> = [
  { id: 'credito', nome: '🎁 Crédito pra consumir', ajuda: 'Permuta: o parceiro entrega algo e consome nas casas.' },
  { id: 'receber', nome: '💰 Conta a receber', ajuda: 'O parceiro paga as casas (patrocínio, cota, aluguel de espaço).' },
  { id: 'pagar', nome: '💸 Conta a pagar', ajuda: 'As casas pagam o parceiro (serviço, cachê, influenciador).' },
];
const nomeTipo = (t: TipoPermuta) => TIPOS.find((x) => x.id === t)?.nome ?? t;

export interface ContratoLinha {
  id: string;
  parceiroNome: string;
  documento: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  valorTotal: number;
  contrapartida: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  observacao: string | null;
  arquivoNome: string | null;
  temArquivo: boolean;
  tipo: TipoPermuta;
  arquivos: Array<{ nome: string }>;
  vencimentos: Array<{ data: string; valor: number }>;
  criadoPor: string | null;
  criadoEm: string;
  cancelado: { em: string; motivo: string | null } | null;
  creditos: CreditoLinha[];
}

// Divisão padrão pedida pelo dono: metade no Prainha Bar, metade no Prainha Mar.
const BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';

const dataBr = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');
const fmtDoc = (d: string | null) => {
  if (!d) return '—';
  if (d.length === 14) return maskCnpj(d);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
};

function situacao(c: CreditoLinha, tipo: TipoPermuta = 'credito'): { texto: string; cor: string } {
  if (c.status === 'cancelado') return { texto: 'Cancelado', cor: 'bg-slate-100 text-slate-500' };
  if (c.status === 'erro') return { texto: 'Erro', cor: 'bg-red-100 text-red-700' };
  if (tipo === 'pagar') {
    const n = c.contaPagarIds?.length ?? 0;
    if (c.status === 'lancado') return { texto: `Conta a pagar lançada${n > 1 ? ` (${n} parcelas)` : ''}`, cor: 'bg-emerald-100 text-emerald-700' };
    return { texto: 'Lançando a conta a pagar…', cor: 'bg-amber-100 text-amber-800' };
  }
  if (tipo === 'receber') {
    if (c.status === 'aguardando_cadastro') return { texto: 'Cadastrando o parceiro na loja…', cor: 'bg-amber-100 text-amber-800' };
    if (c.fiadoStatus === 'aplicado') return { texto: 'A receber no fiado do parceiro', cor: 'bg-emerald-100 text-emerald-700' };
    if (c.fiadoStatus === 'erro') return { texto: 'Loja recusou o lançamento', cor: 'bg-red-100 text-red-700' };
    return { texto: 'Enviado — aguardando a loja aplicar', cor: 'bg-sky-100 text-sky-700' };
  }
  if (c.status === 'aguardando_cadastro') return { texto: 'Cadastrando o parceiro na loja…', cor: 'bg-amber-100 text-amber-800' };
  if (c.fiadoStatus === 'aplicado') return { texto: 'Crédito no PDV', cor: 'bg-emerald-100 text-emerald-700' };
  if (c.fiadoStatus === 'erro') return { texto: 'Loja recusou o crédito', cor: 'bg-red-100 text-red-700' };
  return { texto: 'Enviado — aguardando a loja aplicar', cor: 'bg-sky-100 text-sky-700' };
}

export function Permutas({
  casas,
  contratos,
  podeCriar,
  podePagar = false,
}: {
  casas: CasaOpcao[];
  contratos: ContratoLinha[];
  podeCriar: boolean;
  podePagar?: boolean;
}) {
  const [abrir, setAbrir] = useState(contratos.length === 0 && podeCriar);
  return (
    <div className="mt-6 space-y-4">
      {podeCriar && (
        <div>
          {!abrir ? (
            <button
              onClick={() => setAbrir(true)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              + Nova permuta
            </button>
          ) : (
            <NovaPermuta casas={casas} podePagar={podePagar} onFechar={() => setAbrir(false)} />
          )}
        </div>
      )}

      {contratos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Nenhuma permuta cadastrada ainda.
        </p>
      ) : (
        contratos.map((k) => <Contrato key={k.id} k={k} podeCriar={podeCriar} />)
      )}
    </div>
  );
}

function Contrato({ k, podeCriar }: { k: ContratoLinha; podeCriar: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const temErro = k.creditos.some((c) => c.status === 'erro');

  async function acao(body: Record<string, unknown>) {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fetch('/api/financeiro/permuta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'falhou');
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className={`rounded-lg border bg-white p-4 shadow-sm ${k.cancelado ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {k.parceiroNome}
            {k.tipo !== 'credito' && (
              <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-xs font-normal text-indigo-700">{nomeTipo(k.tipo)}</span>
            )}
            {k.cancelado && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-normal text-slate-600">cancelado</span>}
          </h2>
          <p className="text-xs text-slate-500">
            {fmtDoc(k.documento)}
            {k.contato ? ` · ${k.contato}` : ''}
            {k.telefone ? ` · ${k.telefone}` : ''}
            {k.email ? ` · ${k.email}` : ''}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Vigência {dataBr(k.dataInicio)} a {dataBr(k.dataFim)} · lançado por {k.criadoPor ?? '—'} em{' '}
            {new Date(k.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-slate-900">{brl(k.valorTotal)}</div>
          {k.arquivos.length > 1 ? (
            <div className="flex flex-col items-end">
              {k.arquivos.map((a, i) => (
                <a
                  key={i}
                  href={`/api/financeiro/permuta?id=${k.id}&n=${i}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-700 underline"
                >
                  📄 {a.nome}
                </a>
              ))}
            </div>
          ) : k.temArquivo && (
            <a
              href={`/api/financeiro/permuta?id=${k.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-700 underline"
            >
              📄 {k.arquivoNome ?? 'contrato'}
            </a>
          )}
        </div>
      </div>

      {k.contrapartida && (
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-medium">O parceiro entrega:</span> {k.contrapartida}
        </p>
      )}
      {k.vencimentos.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-medium">Parcelas:</span>{' '}
          {k.vencimentos.map((v) => `${dataBr(v.data)} ${brl(v.valor)}`).join(' · ')}
        </p>
      )}
      {k.observacao && <p className="mt-1 text-sm text-slate-500">{k.observacao}</p>}
      {k.cancelado && <p className="mt-1 text-xs text-slate-500">Cancelado: {k.cancelado.motivo}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500">
              <th className="py-1 pr-3">Casa</th>
              <th className="py-1 pr-3 text-right">{k.tipo === 'pagar' ? 'A pagar' : k.tipo === 'receber' ? 'A receber' : 'Crédito'}</th>
              <th className="py-1 pr-3">Situação</th>
              <th className="py-1 pr-3">Cliente no PDV</th>
              <th className="py-1 text-right">Saldo hoje</th>
            </tr>
          </thead>
          <tbody>
            {k.creditos.map((c) => {
              const s = situacao(c, k.tipo);
              return (
                <tr key={c.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3">{c.casa}</td>
                  <td className="py-2 pr-3 text-right">{brl(c.valor)}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${s.cor}`}>{s.texto}</span>
                    {(c.erro || c.fiadoErro) && <div className="mt-1 text-xs text-red-600">{c.erro ?? c.fiadoErro}</div>}
                    {c.fiadoDesligado && c.status === 'lancado' && k.tipo === 'credito' && (
                      <div className="mt-1 text-xs text-amber-700">
                        ⚠ O fiado desse cliente está desligado (limite zero) — ligue o limite no cadastro pra ele conseguir consumir.
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{c.codigo ?? '—'}</td>
                  <td className="py-2 text-right">
                    {k.tipo === 'pagar' ? (
                      c.contaPagarIds?.length ? (
                        <a href="/financeiro?status=aberto" className="text-xs text-sky-700 underline">ver no contas a pagar</a>
                      ) : (
                        '—'
                      )
                    ) : c.saldo == null ? (
                      '—'
                    ) : c.saldo < 0 ? (
                      <span className="text-emerald-700">crédito {brl(-c.saldo)}</span>
                    ) : (
                      <span className={c.saldo > 0 ? 'text-red-600' : 'text-slate-600'}>deve {brl(c.saldo)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {podeCriar && !k.cancelado && (
        <div className="mt-3 flex flex-wrap gap-2">
          {temErro && (
            <button
              disabled={ocupado}
              onClick={() => acao({ acao: 'reprocessar', id: k.id })}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              ↻ Tentar de novo
            </button>
          )}
          <button
            disabled={ocupado}
            onClick={() => {
              const motivo = prompt('Motivo do cancelamento? (crédito já lançado continua na conta do parceiro — estorne pelo fiado se precisar)');
              if (motivo && motivo.trim().length >= 3) acao({ acao: 'cancelar', id: k.id, motivo: motivo.trim() });
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar contrato
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </section>
  );
}

function NovaPermuta({ casas, podePagar, onFechar }: { casas: CasaOpcao[]; podePagar: boolean; onFechar: () => void }) {
  const router = useRouter();
  const padrao = casas.filter((c) => c.id === BAR || c.id === MAR).map((c) => c.id);
  const [parceiro, setParceiro] = useState('');
  const [documento, setDocumento] = useState('');
  const [contato, setContato] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [total, setTotal] = useState('');
  const [contrapartida, setContrapartida] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [obs, setObs] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const enviados = useRef(new WeakMap<File, string>());
  const [tipo, setTipo] = useState<TipoPermuta>('credito');
  const [parcelas, setParcelas] = useState<Array<{ data: string; valor: string }>>([]);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>(padrao.length ? padrao : casas.slice(0, 1).map((c) => c.id));
  const [valores, setValores] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const totalNum = parseValorBr(total) ?? 0;

  // Divide igual entre as casas marcadas (centavo que sobra vai pra primeira),
  // até o dono mexer num valor.
  const divisao = useMemo(() => {
    if (manual) return marcadas.map((id) => ({ id, valor: parseValorBr(valores[id] ?? '') ?? 0 }));
    const cent = Math.round(totalNum * 100);
    const n = marcadas.length || 1;
    const base = Math.floor(cent / n);
    return marcadas.map((id, i) => ({ id, valor: (base + (i === 0 ? cent - base * n : 0)) / 100 }));
  }, [manual, marcadas, valores, totalNum]);
  const somaDiv = divisao.reduce((s, d) => s + Math.round(d.valor * 100), 0) / 100;
  const fecha = Math.round(somaDiv * 100) === Math.round(totalNum * 100);

  const somaParc = parcelas.reduce((s, p) => s + Math.round((parseValorBr(p.valor) ?? 0) * 100), 0) / 100;

  function addArquivos(lista: FileList | null) {
    if (!lista?.length) return;
    const novos = Array.from(lista);
    setArquivos((a) => [...a, ...novos]);
  }

  /** Sobe o que ainda não subiu; devolve [{path, nome}] na ordem. */
  async function enviarTodos(): Promise<Array<{ path: string; nome: string }>> {
    const out: Array<{ path: string; nome: string }> = [];
    for (const [i, f] of arquivos.entries()) {
      let path = enviados.current.get(f);
      if (!path) {
        setEtapa(`Enviando ${arquivos.length > 1 ? `arquivo ${i + 1} de ${arquivos.length}` : 'o contrato'}…`);
        const r1 = await fetch('/api/financeiro/permuta', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acao: 'upload_url', nome: f.name, tamanho: f.size }),
        });
        const p = await r1.json().catch(() => ({}));
        if (!r1.ok) throw new Error(p.error ?? 'falha ao preparar o envio');
        const up = await createClient()
          .storage.from(String(p.bucket))
          .uploadToSignedUrl(String(p.path), String(p.token), f, { contentType: f.type || 'application/octet-stream' });
        if (up.error) throw new Error(up.error.message);
        path = String(p.path);
        enviados.current.set(f, path);
      }
      out.push({ path, nome: f.name });
    }
    return out;
  }

  async function lerComIa() {
    setErro(null);
    setLeitura(null);
    if (arquivos.length === 0) return setErro('Tire a foto ou escolha o arquivo do contrato primeiro.');
    setLendo(true);
    try {
      const lista = await enviarTodos();
      setEtapa('Lendo o contrato…');
      const r = await fetch('/api/financeiro/permuta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'ler', arquivos: lista }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'a leitura falhou');
      const l = j.lido as {
        parceiroNome: string | null; documento: string | null; contato: string | null; telefone: string | null;
        email: string | null; valorTotal: number | null; contrapartida: string | null; dataInicio: string | null;
        dataFim: string | null; tipo: TipoPermuta | null; tipoMotivo: string | null;
        vencimentos: Array<{ data: string; valor: number }>; divisao: Array<{ filialId: string; valor: number }>;
        observacao: string | null; aviso: string | null;
      };
      const br = (v: number) => v.toFixed(2).replace('.', ',');
      if (l.parceiroNome) setParceiro(l.parceiroNome);
      if (l.documento) setDocumento(l.documento);
      if (l.contato) setContato(l.contato);
      if (l.telefone) setTelefone(l.telefone);
      if (l.email) setEmail(l.email);
      if (l.valorTotal) setTotal(br(l.valorTotal));
      if (l.contrapartida) setContrapartida(l.contrapartida);
      if (l.dataInicio) setInicio(l.dataInicio);
      if (l.dataFim) setFim(l.dataFim);
      if (l.observacao) setObs(l.observacao);
      const t = l.tipo === 'pagar' && !podePagar ? null : l.tipo;
      if (t) setTipo(t);
      if (l.vencimentos.length && t !== 'credito') setParcelas(l.vencimentos.map((v) => ({ data: v.data, valor: br(v.valor) })));
      const div = l.divisao.filter((d) => casas.some((c) => c.id === d.filialId));
      if (div.length) {
        setMarcadas(div.map((d) => d.filialId));
        setValores(Object.fromEntries(div.map((d) => [d.filialId, br(d.valor)])));
        setManual(true);
      }
      const partes = [
        'Pronto — confira os campos antes de salvar.',
        t ? `Tipo: ${nomeTipo(t)}${l.tipoMotivo ? ` (“${l.tipoMotivo}”)` : ''}.` : null,
        l.tipo === 'pagar' && !podePagar ? 'A IA achou que é conta a pagar, mas você não tem permissão pra lançar conta a pagar.' : null,
        div.length ? 'A divisão entre as casas veio do contrato.' : 'O contrato não diz a divisão entre as casas — ajuste abaixo.',
        l.aviso ? `⚠ ${l.aviso}` : null,
      ];
      setLeitura(partes.filter(Boolean).join(' '));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
      setEtapa(null);
    }
  }

  function marcar(id: string, on: boolean) {
    setMarcadas((m) => (on ? [...m, id] : m.filter((x) => x !== id)));
  }

  async function salvar() {
    setErro(null);
    const doc = documento.replace(/\D/g, '');
    if (parceiro.trim().length < 2) return setErro('Informe o nome do parceiro.');
    if (doc.length !== 14 && doc.length !== 11) return setErro('Informe o CNPJ (ou CPF) do parceiro.');
    if (!(totalNum > 0)) return setErro('Informe o valor do contrato.');
    if (marcadas.length === 0) return setErro('Marque ao menos uma casa.');
    if (!fecha) return setErro(`A divisão (${brl(somaDiv)}) não fecha com o valor do contrato (${brl(totalNum)}).`);
    if (divisao.some((d) => !(d.valor > 0))) return setErro('Toda casa marcada precisa de valor.');
    const venc = tipo === 'credito' ? [] : parcelas.map((p) => ({ data: p.data, valor: parseValorBr(p.valor) ?? 0 }));
    if (venc.some((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v.data) || !(v.valor > 0))) return setErro('Toda parcela precisa de data e valor.');
    if (venc.length && Math.round(somaParc * 100) !== Math.round(totalNum * 100)) {
      return setErro(`As parcelas (${brl(somaParc)}) não fecham com o valor do contrato (${brl(totalNum)}).`);
    }
    try {
      const lista = await enviarTodos();
      setEtapa(tipo === 'pagar' ? 'Gravando e lançando a conta a pagar…' : tipo === 'receber' ? 'Gravando e lançando a cobrança…' : 'Gravando e lançando o crédito…');
      const r2 = await fetch('/api/financeiro/permuta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          acao: 'criar',
          parceiroNome: parceiro.trim(),
          documento: doc,
          contato: contato.trim() || null,
          telefone: telefone.trim() || null,
          email: email.trim() || null,
          valorTotal: totalNum,
          contrapartida: contrapartida.trim() || null,
          dataInicio: inicio || null,
          dataFim: fim || null,
          observacao: obs.trim() || null,
          arquivoPath: lista[0]?.path ?? null,
          arquivoNome: lista[0]?.nome ?? null,
          tipo,
          arquivos: lista,
          vencimentos: venc,
          creditos: divisao.map((d) => ({ filialId: d.id, valor: d.valor })),
        }),
      });
      const j = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(j.error ?? 'falhou');
      onFechar();
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEtapa(null);
    }
  }

  const campo = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Nova permuta</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="text-sm sm:col-span-2">
          Contrato (PDF, Word ou foto — pode ser várias páginas)
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              📸 Tirar foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  addArquivos(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              📎 Escolher arquivos
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,image/*"
                onChange={(e) => {
                  addArquivos(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            <button
              type="button"
              disabled={lendo || !!etapa || arquivos.length === 0}
              onClick={lerComIa}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {lendo ? etapa ?? 'Lendo…' : '✨ Ler com IA e preencher'}
            </button>
          </div>
          {arquivos.length > 0 && (
            <ul className="mt-2 space-y-1">
              {arquivos.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                  📄 {f.name} <span className="text-slate-400">({Math.ceil(f.size / 1024)} KB)</span>
                  <button
                    type="button"
                    onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))}
                    className="text-red-600 underline"
                  >
                    tirar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {leitura && <p className="mt-2 rounded-md bg-indigo-50 p-2 text-xs text-indigo-800">{leitura}</p>}
        </div>
        <div className="text-sm sm:col-span-2">
          O que esse contrato gera
          <div className="mt-1 flex flex-wrap gap-2">
            {TIPOS.filter((t) => t.id !== 'pagar' || podePagar).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTipo(t.id)}
                className={`rounded-md border px-3 py-1.5 text-sm ${tipo === t.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
              >
                {t.nome}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{TIPOS.find((t) => t.id === tipo)?.ajuda}</p>
        </div>
        <label className="text-sm">
          Empresa parceira *
          <input value={parceiro} onChange={(e) => setParceiro(e.target.value)} className={campo} placeholder="Razão social ou nome fantasia" />
        </label>
        <label className="text-sm">
          CNPJ (ou CPF) *
          <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={campo} inputMode="numeric" />
        </label>
        <label className="text-sm">
          Contato (quem vai consumir / responsável)
          <input value={contato} onChange={(e) => setContato(e.target.value)} className={campo} />
        </label>
        <label className="text-sm">
          Celular
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={campo} inputMode="tel" placeholder="79 9…" />
        </label>
        <label className="text-sm">
          E-mail
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={campo} type="email" />
        </label>
        <label className="text-sm">
          {tipo === 'pagar' ? 'Valor total a pagar *' : tipo === 'receber' ? 'Valor total a receber *' : 'Valor total do crédito *'}
          <input value={total} onChange={(e) => setTotal(e.target.value)} className={campo} inputMode="decimal" placeholder="2.500,00" />
        </label>
        <label className="text-sm">
          Vigência — início
          <input value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} type="date" />
        </label>
        <label className="text-sm">
          Vigência — fim
          <input value={fim} onChange={(e) => setFim(e.target.value)} className={campo} type="date" />
        </label>
        <label className="text-sm sm:col-span-2">
          O que o parceiro entrega em troca
          <textarea value={contrapartida} onChange={(e) => setContrapartida(e.target.value)} className={campo} rows={2} />
        </label>
        <label className="text-sm sm:col-span-2">
          Observação
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} className={campo} rows={2} />
        </label>
      </div>

      {tipo !== 'credito' && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-800">Parcelas (vencimentos)</h3>
            <button
              type="button"
              onClick={() => setParcelas((p) => [...p, { data: '', valor: '' }])}
              className="text-xs text-sky-700 underline"
            >
              + parcela
            </button>
          </div>
          {parcelas.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              Sem parcela: vence uma vez só, no início da vigência (ou hoje).
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {parcelas.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-slate-500">{i + 1}.</span>
                  <input
                    type="date"
                    value={p.data}
                    onChange={(e) => setParcelas((l) => l.map((x, j) => (j === i ? { ...x, data: e.target.value } : x)))}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <input
                    value={p.valor}
                    onChange={(e) => setParcelas((l) => l.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                    className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                  <button type="button" onClick={() => setParcelas((l) => l.filter((_, j) => j !== i))} className="text-xs text-red-600 underline">
                    tirar
                  </button>
                </div>
              ))}
              <p className={`text-xs ${Math.round(somaParc * 100) === Math.round(totalNum * 100) ? 'text-slate-500' : 'text-red-600'}`}>
                Soma das parcelas: {brl(somaParc)} de {brl(totalNum)} — cada casa paga/recebe a sua parte em cada parcela
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-800">
            {tipo === 'pagar' ? 'Quanto cada casa paga' : tipo === 'receber' ? 'Quanto cada casa recebe' : 'Crédito em cada casa'}
          </h3>
          {manual ? (
            <button onClick={() => setManual(false)} className="text-xs text-sky-700 underline">dividir igual</button>
          ) : (
            <span className="text-xs text-slate-500">dividido igual — edite um valor pra mudar</span>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {casas.map((c) => {
            const on = marcadas.includes(c.id);
            const v = divisao.find((d) => d.id === c.id)?.valor ?? 0;
            return (
              <div key={c.id} className="flex items-center gap-3">
                <label className="flex w-48 items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} onChange={(e) => marcar(c.id, e.target.checked)} />
                  {c.nome}
                </label>
                {on && (
                  <input
                    value={manual ? valores[c.id] ?? '' : v.toFixed(2).replace('.', ',')}
                    onChange={(e) => {
                      if (!manual) {
                        const atual: Record<string, string> = {};
                        for (const d of divisao) atual[d.id] = d.valor.toFixed(2).replace('.', ',');
                        setValores({ ...atual, [c.id]: e.target.value });
                        setManual(true);
                      } else setValores((s) => ({ ...s, [c.id]: e.target.value }));
                    }}
                    className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                    inputMode="decimal"
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className={`mt-2 text-xs ${fecha ? 'text-slate-500' : 'text-red-600'}`}>
          Soma: {brl(somaDiv)} de {brl(totalNum)}
        </p>
      </div>

      {tipo === 'credito' && (
      <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        Ao salvar: se o parceiro ainda não é cliente da casa, o cadastro é criado na loja com o fiado travado no
        crédito (não passa do valor). O crédito entra como pagamento na conta corrente dele (forma &quot;Crédito
        Virtual&quot;) — leva de 1 a 5 minutos pra aparecer no PDV.
      </p>
      )}
      {tipo === 'receber' && (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          Ao salvar: o parceiro vira cliente da casa (se ainda não for) e o valor entra como débito a prazo na conta
          corrente dele, vencendo na 1ª parcela — aparece em Contas a receber (fiado) e no PDV.
        </p>
      )}
      {tipo === 'pagar' && (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          Ao salvar: o parceiro vira fornecedor da casa (se ainda não for) e entra uma conta a pagar por parcela em
          cada casa marcada, já no Financeiro → Contas a pagar.
        </p>
      )}

      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={!!etapa}
          onClick={salvar}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {etapa ?? (tipo === 'pagar' ? 'Salvar e lançar a conta a pagar' : tipo === 'receber' ? 'Salvar e lançar a conta a receber' : 'Salvar e lançar o crédito')}
        </button>
        <button disabled={!!etapa} onClick={onFechar} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
          Cancelar
        </button>
      </div>
    </section>
  );
}
