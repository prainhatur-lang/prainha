'use client';

// Unidades do VGV e os meses em branco: dizer que uma unidade parou (ou voltou)
// e incluir unidade nova.

import { useState, type FormEvent } from 'react';
import { rotuloMes, somaMeses } from '@/lib/faturamento-meses';
import { SeletorMes } from './campos';
import { BOTAO, BOTAO_PEQUENO, BOTAO_SECUNDARIO, CAMPO, CARTAO, LINK } from './estilos';
import { useAcao } from './usar-acao';

/** O mesmo teto da rota. */
const NOME_MAX = 80;

export interface ItemPendencia {
  unidadeId: string;
  nome: string;
  /** Os meses em branco já por extenso: "abr a set/2026". */
  meses: string;
  /** Primeiro mês ('YYYY-MM') do bloco em branco que vem até hoje; null = só buracos no meio. */
  desde: string | null;
}

/** Aviso amarelo dos meses sem número, com o atalho pra dizer que a unidade parou. */
export function AvisoPendencias({ organizacaoId, itens }: { organizacaoId: string; itens: ItemPendencia[] }) {
  const { ocupado, erro, rodar } = useAcao();
  if (itens.length === 0) return null;

  const parou = (p: ItemPendencia) => {
    if (!p.desde) return;
    const quando = rotuloMes(p.desde);
    const pergunta =
      `Marcar ${p.nome} como parada desde ${quando}?\n\n` +
      `De ${quando} em diante ela deixa de aparecer como "em branco" e passa a contar como venda zero no VGV. ` +
      'Dá pra desfazer em "Unidades", lá embaixo.';
    if (!window.confirm(pergunta)) return;
    void rodar('unidade', { organizacaoId, acao: 'encerrar', unidadeId: p.unidadeId, desde: p.desde });
  };

  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Meses sem número lançado</p>
      <ul className="mt-1 space-y-1">
        {itens.map((p) => (
          <li key={p.unidadeId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <b className="font-medium">{p.nome}:</b> {p.meses}.
            </span>
            {p.desde && (
              <button type="button" disabled={ocupado} onClick={() => parou(p)} className={BOTAO_PEQUENO}>
                Parou de operar em {rotuloMes(p.desde)}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-800">
        Enquanto estiverem em branco, esses meses ficam fora da comparação — dos dois lados. Tem o número? Lance em{' '}
        <a href="#lancar" className="font-medium underline">
          Lançar e corrigir
        </a>
        .
      </p>
      {erro && <p className="mt-2 text-xs font-medium text-rose-700">{erro}</p>}
    </div>
  );
}

export interface UnidadeItem {
  id: string;
  nome: string;
  /** De onde vem o número: "PDV desde dez/2022" · "Digitado mês a mês". */
  origem: string;
  encerradaDesde: string | null;
}

export function UnidadesCard({
  organizacaoId,
  unidades,
  filiaisLivres,
  mesAtual,
  anoMin,
}: {
  organizacaoId: string;
  unidades: UnidadeItem[];
  /** Casas do sistema (com PDV) que ainda não estão no VGV. */
  filiaisLivres: Array<{ id: string; nome: string }>;
  mesAtual: string;
  anoMin: number;
}) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [parando, setParando] = useState<{ id: string; desde: string } | null>(null);
  const [nova, setNova] = useState(false);
  const [nome, setNome] = useState('');
  const [filialId, setFilialId] = useState('');
  const [pdvDesde, setPdvDesde] = useState(mesAtual);
  // Dá pra avisar com um mês de antecedência que a unidade para.
  const limite = somaMeses(mesAtual, 1);

  async function confirmarParada() {
    if (!parando) return;
    const ok = await rodar('unidade', {
      organizacaoId,
      acao: 'encerrar',
      unidadeId: parando.id,
      desde: parando.desde,
    });
    if (ok) setParando(null);
  }

  function voltou(u: UnidadeItem) {
    const pergunta = `Tirar a marca de parada de ${u.nome}?\n\nOs meses sem número voltam a aparecer como "em branco".`;
    if (!window.confirm(pergunta)) return;
    void rodar('unidade', { organizacaoId, acao: 'encerrar', unidadeId: u.id, desde: null });
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    const limpo = nome.trim().replace(/\s+/g, ' ');
    if (!limpo) {
      setErro('Dê um nome pra unidade.');
      return;
    }
    const corpo: Record<string, unknown> = { organizacaoId, acao: 'criar', nome: limpo };
    if (filialId) {
      corpo.filialId = filialId;
      corpo.sistemaDesde = pdvDesde;
    }
    const ok = await rodar('unidade', corpo);
    if (ok) {
      setNova(false);
      setNome('');
      setFilialId('');
    }
  }

  return (
    <div className={CARTAO}>
      <div className="px-4 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Unidades</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Quem entra na conta do VGV. Unidade marcada como parada conta como venda zero dali em diante, em vez de
          aparecer como mês em branco.
        </p>
      </div>

      <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
        {unidades.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{u.nome}</p>
              <p className="text-xs text-slate-500">
                {u.origem}
                {u.encerradaDesde && (
                  <span className="text-amber-700"> · parada desde {rotuloMes(u.encerradaDesde)}</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {u.encerradaDesde ? (
                <button type="button" disabled={ocupado} onClick={() => voltou(u)} className={BOTAO_PEQUENO}>
                  Voltou a operar
                </button>
              ) : parando?.id === u.id ? (
                <>
                  <span className="text-xs text-slate-600">Parada desde</span>
                  <SeletorMes
                    valor={parando.desde}
                    onChange={(desde) => setParando({ id: u.id, desde })}
                    anoMin={anoMin}
                    max={limite}
                    disabled={ocupado}
                  />
                  <button type="button" disabled={ocupado} onClick={confirmarParada} className={BOTAO_PEQUENO}>
                    Confirmar
                  </button>
                  <button type="button" disabled={ocupado} onClick={() => setParando(null)} className={LINK}>
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    setErro(null);
                    setParando({ id: u.id, desde: mesAtual });
                  }}
                  className={BOTAO_PEQUENO}
                >
                  Parou de operar…
                </button>
              )}
            </div>
          </li>
        ))}
        {unidades.length === 0 && (
          <li className="px-4 py-4 text-sm text-slate-500">Nenhuma unidade ainda. Inclua a primeira aqui embaixo.</li>
        )}
      </ul>

      <div className="border-t border-slate-100 px-4 py-3">
        {nova ? (
          <form onSubmit={criar} className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[12rem] flex-1">
              <span className="text-xs font-medium text-slate-600">Nome da unidade</span>
              <input
                type="text"
                value={nome}
                maxLength={NOME_MAX}
                disabled={ocupado}
                autoFocus
                onChange={(e) => {
                  setErro(null);
                  setNome(e.target.value);
                }}
                className={`${CAMPO} mt-1 block w-full`}
              />
            </label>
            {filiaisLivres.length > 0 && (
              <label className="block">
                <span className="text-xs font-medium text-slate-600">De onde vem o número</span>
                <select
                  value={filialId}
                  disabled={ocupado}
                  onChange={(e) => setFilialId(e.target.value)}
                  className={`${CAMPO} mt-1 block`}
                >
                  <option value="">Vou digitar mês a mês</option>
                  {filiaisLivres.map((f) => (
                    <option key={f.id} value={f.id}>
                      PDV — {f.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {filialId && (
              <div>
                <span className="block text-xs font-medium text-slate-600">PDV responde desde</span>
                <span className="mt-1 block">
                  <SeletorMes valor={pdvDesde} onChange={setPdvDesde} anoMin={anoMin} max={mesAtual} disabled={ocupado} />
                </span>
              </div>
            )}
            <button type="submit" disabled={ocupado || !nome.trim()} className={BOTAO}>
              {ocupado ? 'Gravando…' : 'Incluir unidade'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => setNova(false)} className={BOTAO_SECUNDARIO}>
              Cancelar
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              setErro(null);
              setNova(true);
            }}
            className={BOTAO_SECUNDARIO}
          >
            + Nova unidade
          </button>
        )}
        {erro && <p className="mt-2 text-sm font-medium text-rose-700">{erro}</p>}
      </div>
    </div>
  );
}
