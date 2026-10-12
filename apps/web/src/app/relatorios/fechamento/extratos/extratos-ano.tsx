'use client';

// Grade do ano: uma linha por conta, uma coluna por mês. Clicar num mês vazio
// abre a escolha do arquivo; clicar num mês com ✓ mostra os arquivos pra baixar.
// É AQUI que o extrato entra (12/10: o dono tirou a importação do Fechamento do
// mês, que ficou só pra ver e baixar): envio de arquivo, "⚡ baixar" direto do
// Inter no mês que falta e a lista de contas (adicionar, não pedir mais).

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ContaExtratoDoAno } from '@/lib/extratos-fechamento';

interface Props {
  ano: number;
  hojeAno: number;
  hojeMes: number;
  contas: ContaExtratoDoAno[];
  podeEnviar: boolean;
  extensoes: string[];
  /** Casas em que este usuário pode cadastrar conta. */
  casas: Array<{ id: string; nome: string }>;
  /** Pode cadastrar conta de empresa que não é uma das casas. */
  podeEmpresa: boolean;
  /** Contas do Inter com integração: o extrato do mês pode vir direto do banco. */
  interIds: string[];
}

const OUTRA = '__outra__';

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DOZE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** dd/mm/aa hh:mm em BRT (UTC−3 fixo), igual no servidor e no navegador. */
function quando(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)} ${d.slice(11, 16)}`;
}

function tamanho(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function nomeConta(c: { banco: string; apelido: string | null }): string {
  return c.apelido ? `${c.banco} · ${c.apelido}` : c.banco;
}

/** Planilha que o sistema montou com o que o Inter respondeu (não foi alguém que enviou). */
function veioDoInter(nome: string): boolean {
  return /^extrato-inter-\d{4}-\d{2}-automatico\.xlsx$/.test(nome);
}

export function ExtratosAno({ ano, hojeAno, hojeMes, contas, podeEnviar, extensoes, casas, podeEmpresa, interIds }: Props) {
  const router = useRouter();
  /** Conta do Inter com integração: o extrato do mês pode vir direto da API do banco. */
  const contaDoInter = (c: { id: string }) => interIds.includes(c.id);
  const input = useRef<HTMLInputElement | null>(null);
  const alvo = useRef<{ contaId: string; mes: number } | null>(null);
  const [aberto, setAberto] = useState<{ contaId: string; mes: number } | null>(null);
  const [enviando, setEnviando] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  /** "3 de 27" enquanto baixa do Inter, em fila, tudo que falta no ano. */
  const [lote, setLote] = useState('');
  const [novaAberta, setNovaAberta] = useState(false);
  const [dono, setDono] = useState(casas[0]?.id ?? OUTRA);
  const [empresa, setEmpresa] = useState('');
  const [banco, setBanco] = useState('');
  const [apelido, setApelido] = useState('');
  const [erroNova, setErroNova] = useState('');

  /** O mês já acabou, está correndo ou ainda não chegou. */
  function estado(mes: number): 'encerrado' | 'andamento' | 'futuro' {
    if (ano < hojeAno || (ano === hojeAno && mes < hojeMes)) return 'encerrado';
    if (ano === hojeAno && mes === hojeMes) return 'andamento';
    return 'futuro';
  }

  const temArquivo = (c: ContaExtratoDoAno) => DOZE.some((m) => (c.meses[m]?.length ?? 0) > 0);
  // Quem envia vê também a conta em "não pedir mais" (apagada, sem contar como
  // falta), pra continuar subindo arquivo nela; quem só baixa vê como antes.
  const mostradas = contas.filter((c) => c.ativo || temArquivo(c) || podeEnviar);
  const encerrados = DOZE.filter((m) => estado(m) === 'encerrado');
  const pedidos = mostradas.filter((c) => c.ativo).length * encerrados.length;
  const enviados = mostradas
    .filter((c) => c.ativo)
    .reduce((s, c) => s + encerrados.filter((m) => (c.meses[m]?.length ?? 0) > 0).length, 0);

  // Conta do Inter pedida, mês encerrado e sem arquivo: dá pra baixar direto do banco.
  const faltamInter = mostradas
    .filter((c) => c.ativo && contaDoInter(c))
    .flatMap((c) => encerrados.filter((m) => (c.meses[m]?.length ?? 0) === 0).map((m) => ({ conta: c, mes: m })));
  const empresasConhecidas = [...new Set(contas.filter((c) => !c.filialId).map((c) => c.titular))];

  // Um bloco por dono da conta, na ordem da lista.
  const grupos: Array<{ chave: string; titular: string; contas: ContaExtratoDoAno[] }> = [];
  for (const c of mostradas) {
    const chave = c.filialId ?? `empresa:${c.titular}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) {
      g = { chave, titular: c.titular, contas: [] };
      grupos.push(g);
    }
    g.contas.push(c);
  }

  async function chamar(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `erro ${r.status}`);
    return j;
  }

  function escolher(contaId: string, mes: number) {
    alvo.current = { contaId, mes };
    input.current?.click();
  }

  async function enviar(lista: FileList | null) {
    const destino = alvo.current;
    const arquivos = lista ? Array.from(lista) : [];
    if (!destino || arquivos.length === 0) return;
    const chave = `${destino.contaId}:${destino.mes}`;
    const conta = contas.find((c) => c.id === destino.contaId);
    setErro('');
    try {
      for (let i = 0; i < arquivos.length; i++) {
        const file = arquivos[i]!;
        setEnviando((s) => ({ ...s, [chave]: arquivos.length > 1 ? `${i + 1}/${arquivos.length}` : '…' }));
        const passo1 = await chamar('/api/extratos-fechamento/upload-url', 'POST', {
          contaId: destino.contaId,
          ano,
          mes: destino.mes,
          nome: file.name,
          tamanho: file.size,
        });
        const up = await createClient()
          .storage.from(String(passo1.bucket))
          .uploadToSignedUrl(String(passo1.path), String(passo1.token), file, {
            contentType: file.type || 'application/octet-stream',
          });
        if (up.error) throw new Error(`não consegui guardar o arquivo: ${up.error.message}`);
        await chamar('/api/extratos-fechamento/arquivos', 'POST', {
          contaId: destino.contaId,
          ano,
          mes: destino.mes,
          path: passo1.path,
          nome: file.name,
          contentType: file.type,
        });
      }
      setAberto(destino);
    } catch (e) {
      setErro(
        `${conta ? `${nomeConta(conta)} (${conta.titular})` : 'Conta'}, ${MESES[destino.mes]}: ${(e as Error).message}`,
      );
    } finally {
      setEnviando((s) => ({ ...s, [chave]: '' }));
      if (input.current) input.current.value = '';
      router.refresh();
    }
  }

  /** Pede ao Inter o extrato de uma conta num mês. Devolve '' ou o motivo de não ter vindo. */
  async function pedirAoInter(contaId: string, mes: number): Promise<string> {
    const chave = `${contaId}:${mes}`;
    setEnviando((s) => ({ ...s, [chave]: '⚡…' }));
    try {
      for (let tentativa = 0; ; tentativa++) {
        try {
          await chamar('/api/extratos-fechamento/inter', 'POST', { contaId, ano, mes });
          return '';
        } catch (e) {
          const msg = (e as Error).message;
          // 429 = o Inter mandou ir mais devagar: espera e tenta de novo.
          if (tentativa < 2 && /\(429\)/.test(msg)) {
            await new Promise((ok) => setTimeout(ok, 20_000));
            continue;
          }
          return msg;
        }
      }
    } finally {
      setEnviando((s) => ({ ...s, [chave]: '' }));
    }
  }

  /** Clique no mês que falta de uma conta do Inter: baixa direto do banco. */
  async function buscarNoInter(contaId: string, mes: number) {
    if (lote) return;
    const conta = contas.find((c) => c.id === contaId);
    setErro('');
    const falha = await pedirAoInter(contaId, mes);
    if (falha) setErro(`${conta ? `${nomeConta(conta)} (${conta.titular})` : 'Conta'}, ${MESES[mes]}: ${falha}`);
    // Abre o mês: veio → o arquivo pra baixar; não veio → o botão de enviar o arquivo do banco.
    setAberto({ contaId, mes });
    router.refresh();
  }

  /** Baixa do Inter, um de cada vez, todos os meses que faltam das contas do Inter neste ano. */
  async function baixarFaltantes() {
    if (lote || faltamInter.length === 0) return;
    const fila = faltamInter;
    const falhas: string[] = [];
    const semIntegracao = new Set<string>();
    setErro('');
    for (let i = 0; i < fila.length; i++) {
      const { conta, mes } = fila[i]!;
      if (semIntegracao.has(conta.id)) continue;
      setLote(`${i + 1} de ${fila.length}`);
      const falha = await pedirAoInter(conta.id, mes);
      if (/sem integra/i.test(falha)) {
        semIntegracao.add(conta.id);
        falhas.push(falha);
      } else if (falha) {
        falhas.push(`${nomeConta(conta)} (${conta.titular}), ${MESES[mes]}: ${falha}`);
      }
      router.refresh();
    }
    setLote('');
    if (falhas.length > 0) setErro(`Não vieram do Inter — ${falhas.join(' · ')}`);
  }

  async function pedir(conta: ContaExtratoDoAno, ativo: boolean) {
    if (ocupado) return;
    if (
      !ativo &&
      !window.confirm(
        `Parar de pedir o extrato de ${nomeConta(conta)} (${conta.titular})? A conta continua aqui e continua aceitando arquivo; só deixa de contar como falta.`,
      )
    ) {
      return;
    }
    setOcupado(true);
    setErro('');
    try {
      await chamar(`/api/extratos-fechamento/contas/${conta.id}`, 'PATCH', { ativo });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      router.refresh();
    }
  }

  async function adicionarConta() {
    if (ocupado) return;
    setErroNova('');
    if (!banco.trim()) return setErroNova('Informe o banco.');
    if (dono === OUTRA && !empresa.trim()) return setErroNova('Informe o nome da empresa.');
    setOcupado(true);
    try {
      await chamar('/api/extratos-fechamento/contas', 'POST', {
        filialId: dono === OUTRA ? '' : dono,
        empresa: dono === OUTRA ? empresa : '',
        banco,
        apelido,
      });
      setBanco('');
      setApelido('');
      setEmpresa('');
      setNovaAberta(false);
      router.refresh();
    } catch (e) {
      setErroNova((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function tirar(arquivoId: string, nome: string, mes: number) {
    if (ocupado) return;
    if (!window.confirm(`Tirar "${nome}" da lista de ${MESES[mes]}/${ano}?`)) return;
    setOcupado(true);
    setErro('');
    try {
      await chamar(`/api/extratos-fechamento/arquivos/${arquivoId}`, 'DELETE');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      router.refresh();
    }
  }

  const contaAberta = aberto ? contas.find((c) => c.id === aberto.contaId) : undefined;
  const arquivosAbertos = aberto && contaAberta ? (contaAberta.meses[aberto.mes] ?? []) : [];
  const accept = extensoes.map((e) => `.${e}`).join(',');
  const campo = 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => void enviar(e.target.files)}
      />

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {podeEnviar
            ? 'Clique no mês vazio pra enviar o arquivo do banco; no ✓ pra ver, baixar ou enviar outro. '
            : 'Clique no ✓ pra ver e baixar o arquivo. '}
          Aceita {extensoes.slice(0, 4).map((e) => e.toUpperCase()).join(', ')}… O arquivo só é guardado, nada é lançado a partir dele.
          {podeEnviar && (
            <>
              {' '}
              <b className="font-medium text-orange-700">⚡ baixar</b> = conta do Inter ligada ao banco: o extrato do mês vem
              direto de lá, em planilha (o mês que fecha entra sozinho no dia 1).
            </>
          )}
        </p>
        {podeEnviar && (faltamInter.length > 0 || lote) && (
          <button
            type="button"
            onClick={() => void baixarFaltantes()}
            disabled={!!lote}
            title="Baixa do Inter, um de cada vez, o extrato de todos os meses que faltam das contas do Inter neste ano."
            className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-70"
          >
            {lote
              ? `⚡ Baixando do Inter… ${lote}`
              : `⚡ Baixar do Inter ${faltamInter.length === 1 ? 'o que falta' : `os ${faltamInter.length} que faltam`}`}
          </button>
        )}
        {pedidos > 0 && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              enviados === pedidos ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {enviados} de {pedidos} enviados{enviados < pedidos ? ` · faltam ${pedidos - enviados}` : ''}
          </span>
        )}
      </div>

      {erro && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{erro}</p>}
      {mostradas.length === 0 && (
        <p className="text-xs text-slate-400">Nenhuma conta na lista das casas que você acessa.</p>
      )}

      {mostradas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white py-1.5 pr-3 text-left text-[11px] font-medium text-slate-500">
                  Conta
                </th>
                {DOZE.map((m) => (
                  <th key={m} className="px-1 py-1.5 text-center text-[11px] font-medium">
                    <Link
                      href={`/relatorios/fechamento?ano=${ano}&mes=${m}`}
                      title={`Abrir o fechamento de ${MESES[m]}/${ano}`}
                      className={estado(m) === 'futuro' ? 'text-slate-300' : 'text-slate-500 hover:text-sky-700'}
                    >
                      {MES_CURTO[m]}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            {grupos.map((g) => (
              <tbody key={g.chave}>
                <tr>
                  <td
                    colSpan={13}
                    className="border-t border-slate-200 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {g.titular}
                  </td>
                </tr>
                {g.contas.map((c) => (
                  <tr key={c.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1 pr-3 text-sm font-medium text-slate-900">
                      <span className={c.ativo ? '' : 'text-slate-400'}>{nomeConta(c)}</span>
                      {!c.ativo && <span className="ml-1 text-[10px] font-normal text-slate-400">(não é mais pedida)</span>}
                      {podeEnviar && (
                        <button
                          type="button"
                          onClick={() => void pedir(c, !c.ativo)}
                          disabled={ocupado}
                          className={`ml-2 text-[10px] font-normal disabled:opacity-50 ${
                            c.ativo ? 'text-slate-300 hover:text-slate-600' : 'text-sky-700 hover:text-sky-900'
                          }`}
                        >
                          {c.ativo ? 'não pedir mais' : 'voltar a pedir'}
                        </button>
                      )}
                    </td>
                    {DOZE.map((m) => {
                      const chave = `${c.id}:${m}`;
                      const qtd = c.meses[m]?.length ?? 0;
                      const est = estado(m);
                      const selecionado = aberto?.contaId === c.id && aberto.mes === m;
                      const base = 'block h-8 w-full rounded-md border text-[11px] font-medium';
                      let celula: React.ReactNode;
                      if (enviando[chave]) {
                        celula = (
                          <span className={`${base} border-sky-200 bg-sky-50 leading-8 text-sky-700`}>{enviando[chave]}</span>
                        );
                      } else if (qtd > 0) {
                        celula = (
                          <button
                            type="button"
                            onClick={() => setAberto(selecionado ? null : { contaId: c.id, mes: m })}
                            title={`${MESES[m]}/${ano}: ${qtd === 1 ? '1 arquivo' : `${qtd} arquivos`}`}
                            className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ${
                              selecionado ? 'ring-2 ring-emerald-500' : ''
                            }`}
                          >
                            ✓{qtd > 1 ? ` ${qtd}` : ''}
                          </button>
                        );
                      } else if (est === 'futuro') {
                        celula = <span className={`${base} border-transparent leading-8 text-slate-300`}>·</span>;
                      } else if (podeEnviar) {
                        // Conta do Inter em mês encerrado: o clique baixa direto do banco.
                        const direto = est === 'encerrado' && contaDoInter(c);
                        celula = (
                          <button
                            type="button"
                            onClick={() => (direto ? void buscarNoInter(c.id, m) : escolher(c.id, m))}
                            disabled={!!lote}
                            title={
                              direto
                                ? `Baixar direto do Inter o extrato de ${MESES[m]}/${ano} — ${nomeConta(c)} (${c.titular})`
                                : `Enviar o extrato de ${MESES[m]}/${ano} — ${nomeConta(c)} (${c.titular})`
                            }
                            className={`${base} whitespace-nowrap border-dashed ${
                              !c.ativo
                                ? 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                                : direto
                                  ? 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100'
                                  : est === 'encerrado'
                                    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                    : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            {direto ? '⚡ baixar' : 'enviar'}
                          </button>
                        );
                      } else {
                        celula = (
                          <span
                            className={`${base} leading-8 ${
                              c.ativo && est === 'encerrado'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-transparent text-slate-300'
                            }`}
                          >
                            {c.ativo && est === 'encerrado' ? 'falta' : '—'}
                          </span>
                        );
                      }
                      return (
                        <td key={m} className="px-0.5 py-1 text-center">
                          {celula}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {aberto && contaAberta && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {nomeConta(contaAberta)} ({contaAberta.titular}) — {MESES[aberto.mes]}/{ano}
            </h3>
            <div className="flex items-center gap-3">
              {podeEnviar && estado(aberto.mes) === 'encerrado' && contaDoInter(contaAberta) && (
                <button
                  type="button"
                  onClick={() => void buscarNoInter(aberto.contaId, aberto.mes)}
                  disabled={!!lote || !!enviando[`${aberto.contaId}:${aberto.mes}`]}
                  title="Busca o extrato do mês na API do Inter e guarda em planilha (XLSX). Se o banco postou lançamento depois, entra a planilha nova no lugar da automática anterior."
                  className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-60"
                >
                  {enviando[`${aberto.contaId}:${aberto.mes}`] ? 'Buscando…' : '⚡ Buscar no Inter'}
                </button>
              )}
              {podeEnviar && (
                <button
                  type="button"
                  onClick={() => escolher(aberto.contaId, aberto.mes)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {arquivosAbertos.length > 0 ? 'Enviar outro' : 'Enviar arquivo'}
                </button>
              )}
              <button type="button" onClick={() => setAberto(null)} className="text-xs text-slate-500 hover:text-slate-700">
                fechar
              </button>
            </div>
          </div>
          {arquivosAbertos.length === 0 && <p className="text-xs text-slate-400">Nenhum arquivo deste mês.</p>}
          <div className="space-y-1">
            {arquivosAbertos.map((a) => (
              <div key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <a
                  href={`/api/extratos-fechamento/arquivos/${a.id}`}
                  className="break-all font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900"
                >
                  ⬇ {a.nome}
                </a>
                <span className="text-[11px] text-slate-400">
                  {[tamanho(a.tamanhoBytes), quando(a.enviadoEm), a.enviadoPor].filter(Boolean).join(' · ')}
                </span>
                {veioDoInter(a.nome) && (
                  <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                    direto do Inter
                  </span>
                )}
                {podeEnviar && (
                  <button
                    type="button"
                    onClick={() => void tirar(a.id, a.nome, aberto.mes)}
                    disabled={ocupado}
                    className="text-[11px] text-slate-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    tirar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {podeEnviar && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {!novaAberta ? (
            <button
              type="button"
              onClick={() => setNovaAberta(true)}
              className="text-xs font-medium text-sky-700 hover:text-sky-900"
            >
              + Adicionar conta
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-slate-500">
                De quem é a conta
                <select value={dono} onChange={(e) => setDono(e.target.value)} className={`mt-0.5 block ${campo}`}>
                  {casas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                  {podeEmpresa && <option value={OUTRA}>Outra empresa (não é uma das casas)</option>}
                </select>
              </label>
              {dono === OUTRA && (
                <label className="text-[11px] text-slate-500">
                  Empresa
                  <input
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
                    list="extrato-empresas"
                    maxLength={80}
                    placeholder="ex.: Lelis"
                    className={`mt-0.5 block w-40 ${campo}`}
                  />
                  <datalist id="extrato-empresas">
                    {empresasConhecidas.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
              )}
              <label className="text-[11px] text-slate-500">
                Banco
                <input
                  value={banco}
                  onChange={(e) => setBanco(e.target.value)}
                  maxLength={60}
                  placeholder="ex.: Caixa"
                  className={`mt-0.5 block w-40 ${campo}`}
                />
              </label>
              <label className="text-[11px] text-slate-500">
                Detalhe (opcional)
                <input
                  value={apelido}
                  onChange={(e) => setApelido(e.target.value)}
                  maxLength={80}
                  placeholder="ex.: aplicação"
                  className={`mt-0.5 block w-36 ${campo}`}
                />
              </label>
              <button
                type="button"
                onClick={() => void adicionarConta()}
                disabled={ocupado}
                className="rounded-md border border-sky-600 bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                Adicionar
              </button>
              <button
                type="button"
                onClick={() => {
                  setNovaAberta(false);
                  setErroNova('');
                }}
                className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                cancelar
              </button>
              {erroNova && <p className="w-full text-[11px] text-rose-600">{erroNova}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
