'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  dataDaHora,
  diaMes,
  horaDeMadrugada,
  madrugadaDoDia,
  msgMadrugadaFutura,
  somarDias,
} from '@/lib/rh/dia-operacional';

interface BatidaCrua {
  id: string;
  quando: string;
  tipo: string;
}
interface Celula {
  chave: string;
  batidas: BatidaCrua[];
  totalMin: number;
  status: string;
}
interface Props {
  /** Casa aberta na tela: a correção grava nela, não na casa do cadastro. */
  filialId: string;
  dias: { iso: string; label: string }[];
  funcionarios: { id: string; nome: string; temRosto: boolean }[];
  grade: Celula[];
}

// O horário digitado é o da loja (BRT, sem horário de verão). Vai com o fuso
// explícito: sem ele o servidor (UTC) gravava a batida 3 horas antes.
const FUSO_BR = '-03:00';

function fmtHM(min: number): string {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
function fmtHora(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function PontoManager({ filialId, dias, funcionarios, grade }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<{ funcionarioId: string; funcionarioNome: string; dia: string } | null>(null);
  const byChave = new Map(grade.map((c) => [c.chave, c]));
  const [apagando, setApagando] = useState<string | null>(null);
  // Depois de apagar um rosto: o que cada loja respondeu ao aviso da nuvem
  // (a loja só pegava a mudança no pull dela, de 3 em 3 min — 03/10/2026, Sara).
  const [avisoRosto, setAvisoRosto] = useState<{
    nome: string;
    lojas: { nome: string; avisada: boolean; atualizada: boolean }[];
  } | null>(null);

  async function apagarRosto(funcionarioId: string, nome: string) {
    if (!confirm(`Apagar o rosto cadastrado de ${nome}?\n\nA câmera do ponto deixa de reconhecer essa pessoa; na próxima vez ela escolhe o nome e cadastra de novo.`)) return;
    setApagando(funcionarioId);
    try {
      const res = await fetch('/api/rh/ponto/apagar-rosto', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ funcionarioId }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok) setAvisoRosto({ nome, lojas: Array.isArray(j?.lojas) ? j.lojas : [] });
      if (!res.ok) alert(j?.error ?? 'Erro ao apagar o rosto');
      else router.refresh();
    } finally {
      setApagando(null);
    }
  }

  if (funcionarios.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Nenhum funcionário ativo nesta filial ainda.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {avisoRosto && (
        <div className="flex items-start justify-between gap-3 rounded-t-xl border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div>
            <p className="font-medium">Rosto de {avisoRosto.nome} apagado.</p>
            <p className="mt-0.5 text-xs text-emerald-800">
              No tablet do Ponto: rosto no molde → “Não te reconheci ainda” → tocar no nome pra cadastrar de novo.
            </p>
            {avisoRosto.lojas.length === 0 ? (
              <p className="mt-1.5 text-xs text-amber-800">As lojas pegam a mudança sozinhas em até 3 min.</p>
            ) : (
              <ul className="mt-1.5 space-y-0.5 text-xs">
                {avisoRosto.lojas.map((l) => (
                  <li key={l.nome} className={l.atualizada ? 'text-emerald-800' : 'text-amber-800'}>
                    {l.atualizada
                      ? `✓ ${l.nome}: já atualizou — o nome já está na lista do tablet`
                      : l.avisada
                        ? `… ${l.nome}: avisada, atualiza em instantes`
                        : `⏳ ${l.nome}: não respondeu agora — pega sozinha em até 3 min`}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAvisoRosto(null)}
            aria-label="Fechar aviso"
            className="rounded px-1.5 text-base leading-none text-emerald-700 hover:bg-emerald-100"
          >
            ×
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="sticky left-0 bg-slate-50 px-4 py-2 text-left">Funcionário</th>
              {dias.map((d) => (
                <th key={d.iso} className="px-3 py-2 text-center">
                  {d.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {funcionarios.map((f) => {
              let totalSemana = 0;
              return (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="sticky left-0 bg-white px-4 py-2 font-medium text-slate-900">
                    {f.nome}
                    {f.temRosto && (
                      <button
                        type="button"
                        onClick={() => apagarRosto(f.id, f.nome)}
                        disabled={apagando === f.id}
                        title="Apagar o rosto cadastrado no ponto facial — na próxima vez a câmera pede o nome de novo"
                        className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-normal text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                      >
                        {apagando === f.id ? 'apagando…' : '🙂 apagar rosto'}
                      </button>
                    )}
                  </td>
                  {dias.map((d) => {
                    const cel = byChave.get(`${f.id}|${d.iso}`);
                    totalSemana += cel?.totalMin ?? 0;
                    const incompleto = cel?.status === 'incompleto';
                    return (
                      <td
                        key={d.iso}
                        onClick={() => setModal({ funcionarioId: f.id, funcionarioNome: f.nome, dia: d.iso })}
                        className={`cursor-pointer px-3 py-2 text-center text-xs hover:bg-blue-50 ${
                          incompleto ? 'bg-amber-50' : ''
                        }`}
                      >
                        {!cel || cel.batidas.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div>
                            <div className="font-mono text-slate-700">
                              {cel.batidas.map((b) => fmtHora(b.quando)).join(' → ')}
                            </div>
                            <div className={incompleto ? 'font-semibold text-amber-700' : 'text-slate-500'}>
                              {incompleto ? '⚠ incompleto' : fmtHM(cel.totalMin)}
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                    {fmtHM(totalSemana)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalCorrecao
          filialId={filialId}
          funcionarioId={modal.funcionarioId}
          funcionarioNome={modal.funcionarioNome}
          dia={modal.dia}
          batidas={byChave.get(`${modal.funcionarioId}|${modal.dia}`)?.batidas ?? []}
          onClose={() => setModal(null)}
          onSalvo={() => {
            setModal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ModalCorrecao({
  filialId,
  funcionarioId,
  funcionarioNome,
  dia,
  batidas,
  onClose,
  onSalvo,
}: {
  filialId: string;
  funcionarioId: string;
  funcionarioNome: string;
  dia: string;
  batidas: BatidaCrua[];
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [acao, setAcao] = useState<'inclusao' | 'alteracao' | 'exclusao' | null>(null);
  const [batidaAlvo, setBatidaAlvo] = useState<BatidaCrua | null>(null);
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada');
  const [hora, setHora] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function iniciarInclusao() {
    setAcao('inclusao');
    setBatidaAlvo(null);
    setTipo('entrada');
    setHora('');
    setJustificativa('');
    setErro(null);
  }
  function iniciarAlteracao(b: BatidaCrua) {
    setAcao('alteracao');
    setBatidaAlvo(b);
    setTipo(b.tipo as 'entrada' | 'saida');
    setHora(fmtHoraInput(b.quando));
    setJustificativa('');
    setErro(null);
  }
  function iniciarExclusao(b: BatidaCrua) {
    setAcao('exclusao');
    setBatidaAlvo(b);
    setJustificativa('');
    setErro(null);
  }

  async function confirmar() {
    if (justificativa.trim().length < 10) {
      setErro('Justificativa precisa de pelo menos 10 caracteres.');
      return;
    }
    const body: Record<string, unknown> = { funcionarioId, filialId, dia, acao, justificativa: justificativa.trim() };
    // O dia do ponto vira às 05:00: hora antes disso é a madrugada do dia
    // seguinte (quem entrou à noite e saiu depois da meia-noite). Com o próprio
    // dia da coluna a saída ficava 24 h adiantada, na frente das entradas.
    if (acao === 'inclusao') {
      if (!hora) { setErro('Informe o horário.'); return; }
      body.quando = `${dataDaHora(dia, hora)}T${hora}:00${FUSO_BR}`;
      body.tipo = tipo;
    } else {
      body.batidaId = batidaAlvo!.id;
      if (acao === 'alteracao') {
        if (!hora) { setErro('Informe o horário.'); return; }
        body.quando = `${dataDaHora(dia, hora)}T${hora}:00${FUSO_BR}`;
        body.tipo = tipo;
      }
    }
    if (typeof body.quando === 'string' && horaDeMadrugada(hora) && new Date(body.quando).getTime() > Date.now()) {
      setErro(msgMadrugadaFutura(dia, hora));
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch('/api/rh/ponto/corrigir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErro(json.error ?? 'Erro ao salvar');
        return;
      }
      onSalvo();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">
          {funcionarioNome} — {fmtDataBr(dia)}
        </h3>

        {!acao && (
          <div className="mt-4 space-y-2">
            {batidas.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma batida neste dia.</p>
            ) : (
              <ul className="space-y-1">
                {batidas.map((b) => (
                  <li key={b.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-sm">
                    <span>
                      {b.tipo === 'entrada' ? 'Entrada' : 'Saída'} — <span className="font-mono">{fmtHora(b.quando)}</span>
                      {madrugadaDoDia(dia, new Date(b.quando)) && (
                        <span className="ml-1.5 text-xs text-slate-400">🌙 madrugada de {diaMes(somarDias(dia, 1))}</span>
                      )}
                    </span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => iniciarAlteracao(b)} className="text-xs text-blue-600 hover:underline">
                        editar
                      </button>
                      <button type="button" onClick={() => iniciarExclusao(b)} className="text-xs text-rose-600 hover:underline">
                        excluir
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-between pt-3">
              <button type="button" onClick={iniciarInclusao} className="text-sm text-blue-600 hover:underline">
                + adicionar batida
              </button>
              <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Fechar
              </button>
            </div>
          </div>
        )}

        {acao && (
          <div className="mt-4 space-y-3">
            {acao !== 'exclusao' && (
              <div className="flex gap-3">
                <label className="flex-1 text-xs text-slate-500">
                  Tipo
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as 'entrada' | 'saida')}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </select>
                </label>
                <label className="flex-1 text-xs text-slate-500">
                  Horário
                  <input
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            )}
            {acao !== 'exclusao' && horaDeMadrugada(hora) && (
              <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                🌙 Depois da meia-noite: grava como <span className="font-mono">{hora}</span> de{' '}
                {diaMes(somarDias(dia, 1))} e conta no dia {diaMes(dia)}.
              </p>
            )}
            {acao === 'exclusao' && (
              <p className="text-sm text-slate-600">
                Excluir {batidaAlvo?.tipo === 'entrada' ? 'entrada' : 'saída'} de{' '}
                <span className="font-mono">{batidaAlvo && fmtHora(batidaAlvo.quando)}</span>?
              </p>
            )}
            <label className="block text-xs text-slate-500">
              Justificativa (obrigatória)
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={2}
                placeholder="ex: esqueceu de bater a saída, confirmado com o funcionário"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            {erro && <p className="text-xs text-rose-600">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAcao(null)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Voltar
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={confirmar}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {salvando ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtHoraInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDataBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
