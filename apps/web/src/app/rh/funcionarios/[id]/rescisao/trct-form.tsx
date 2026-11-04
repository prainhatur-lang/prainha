'use client';

import { useMemo, useState } from 'react';
import {
  AVISO_LABEL,
  CODIGO_AFASTAMENTO,
  TIPO_LABEL,
  calcularTrct,
  somarDiasYmd,
  tipoEhExperiencia,
  tipoTemAviso,
  type AvisoPrevio,
  type ExtraTrct,
  type TipoRescisao,
} from '@/lib/rh/trct';

interface Pessoa {
  nome: string;
  cpf: string | null;
  endereco: string | null;
  cargo: string | null;
  cbo: string | null;
  matricula: string | null;
  empresa: string;
  cnpj: string | null;
  casa: string;
  regime: string | null;
  motivo: string | null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtCpf = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c || '—';
};
const fmtCnpj = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c || '—';
};
const num = (s: string) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function tipoSugerido(admissao: string, afastamento: string, motivo: string | null): TipoRescisao {
  const m = (motivo ?? '').toLowerCase();
  const dias = admissao && afastamento ? diasEntre(admissao, afastamento) + 1 : 999;
  const pedido = m.includes('pedido') || m.includes('pediu');
  if (dias <= 90) return pedido ? 'experiencia_empregado' : 'experiencia_empregador';
  if (m.includes('justa')) return 'justa_causa';
  if (m.includes('acordo')) return 'acordo';
  return pedido ? 'pedido_demissao' : 'sem_justa_causa';
}

export function TrctForm(props: {
  pessoa: Pessoa;
  inicial: { salario: number; admissao: string; afastamento: string; noturno: number };
}) {
  const { pessoa, inicial } = props;
  const [salario, setSalario] = useState(String(inicial.salario || ''));
  const [admissao, setAdmissao] = useState(inicial.admissao);
  const [afastamento, setAfastamento] = useState(inicial.afastamento);
  const [tipo, setTipo] = useState<TipoRescisao>(tipoSugerido(inicial.admissao, inicial.afastamento, pessoa.motivo));
  const [aviso, setAviso] = useState<AvisoPrevio>('indenizado');
  // Contrato de experiência de 45 dias (o padrão da E.B.): fim = admissão + 44.
  const [fimExp, setFimExp] = useState(inicial.admissao ? somarDiasYmd(inicial.admissao, 44) : '');
  const [art480, setArt480] = useState(false);
  const [feriasVenc, setFeriasVenc] = useState('0');
  const [adiant13, setAdiant13] = useState('');
  const [dependentes, setDependentes] = useState('0');
  const [saldoFgts, setSaldoFgts] = useState('');
  const [extras, setExtras] = useState<{ descricao: string; valor: string; tipo: 'P' | 'D'; tributavel: boolean }[]>(
    inicial.noturno > 0
      ? [{ descricao: 'Adicional noturno e reflexos do mês (ponto)', valor: inicial.noturno.toFixed(2).replace('.', ','), tipo: 'P', tributavel: true }]
      : [],
  );

  const calc = useMemo(() => {
    if (!admissao || !afastamento || !(num(salario) > 0) || afastamento < admissao) return null;
    const ex: ExtraTrct[] = extras
      .map((e) => ({ descricao: e.descricao, valor: num(e.valor), tipo: e.tipo, tributavel: e.tributavel }))
      .filter((e) => e.valor > 0);
    return calcularTrct({
      salario: num(salario),
      admissao,
      afastamento,
      tipo,
      aviso,
      fimExperiencia: fimExp || null,
      descontarArt480: art480,
      feriasVencidas: Number(feriasVenc) || 0,
      adiantamento13: num(adiant13),
      dependentesIr: Number(dependentes) || 0,
      saldoFgts: saldoFgts ? num(saldoFgts) : null,
      extras: ex,
    });
  }, [salario, admissao, afastamento, tipo, aviso, fimExp, art480, feriasVenc, adiant13, dependentes, saldoFgts, extras]);

  const avisosPedido: AvisoPrevio[] = ['nao_cumprido', 'dispensado', 'trabalhado'];
  const avisosEmpresa: AvisoPrevio[] = ['indenizado', 'trabalhado'];
  const opcoesAviso = tipo === 'pedido_demissao' ? avisosPedido : avisosEmpresa;
  const avisoValido = opcoesAviso.includes(aviso) ? aviso : opcoesAviso[0];
  if (avisoValido !== aviso && tipoTemAviso(tipo)) setTimeout(() => setAviso(avisoValido), 0);

  const proventos = calc?.verbas.filter((v) => v.tipo === 'P') ?? [];
  const descontos = calc?.verbas.filter((v) => v.tipo === 'D') ?? [];
  const input = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm';
  const rotulo = 'block text-xs font-medium text-slate-600';

  return (
    <div className="space-y-6">
      {/* Formulário — some na impressão */}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 print:hidden">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={rotulo}>
            Salário mensal (R$)
            <input className={input} value={salario} onChange={(e) => setSalario(e.target.value)} inputMode="decimal" />
          </label>
          <label className={rotulo}>
            Admissão
            <input type="date" className={input} value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
          </label>
          <label className={rotulo}>
            Afastamento (último dia)
            <input type="date" className={input} value={afastamento} onChange={(e) => setAfastamento(e.target.value)} />
          </label>
          <label className={rotulo}>
            Dependentes (IR)
            <input className={input} value={dependentes} onChange={(e) => setDependentes(e.target.value)} inputMode="numeric" />
          </label>
        </div>

        <label className={rotulo}>
          Tipo de saída
          <select className={input} value={tipo} onChange={(e) => setTipo(e.target.value as TipoRescisao)}>
            {(Object.keys(TIPO_LABEL) as TipoRescisao[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {pessoa.motivo && <p className="text-xs text-slate-500">Motivo na ficha: {pessoa.motivo}</p>}

        {tipoTemAviso(tipo) && (
          <label className={rotulo}>
            Aviso prévio
            <select className={input} value={avisoValido} onChange={(e) => setAviso(e.target.value as AvisoPrevio)}>
              {opcoesAviso.map((a) => (
                <option key={a} value={a}>
                  {AVISO_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
        )}

        {tipoEhExperiencia(tipo) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={rotulo}>
              Fim previsto do contrato de experiência
              <input type="date" className={input} value={fimExp} onChange={(e) => setFimExp(e.target.value)} />
            </label>
            {tipo === 'experiencia_empregado' && (
              <label className="flex items-start gap-2 pt-5 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5" checked={art480} onChange={(e) => setArt480(e.target.checked)} />
                <span>
                  Descontar a indenização do art. 480 (metade dos dias que faltavam). É opcional: a empresa pode não cobrar.
                </span>
              </label>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <label className={rotulo}>
            Férias vencidas não gozadas (períodos)
            <select className={input} value={feriasVenc} onChange={(e) => setFeriasVenc(e.target.value)}>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
          <label className={rotulo}>
            13º já adiantado (R$)
            <input className={input} value={adiant13} onChange={(e) => setAdiant13(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </label>
          <label className={rotulo}>
            Saldo do FGTS pra multa (R$)
            <input className={input} value={saldoFgts} onChange={(e) => setSaldoFgts(e.target.value)} inputMode="decimal" placeholder="em branco = estimado" />
          </label>
        </div>

        <div>
          <p className={rotulo}>Outros proventos e descontos (vale, adiantamento, noturno…)</p>
          <div className="mt-1 space-y-2">
            {extras.map((e, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={e.tipo}
                  onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, tipo: ev.target.value as 'P' | 'D' } : x)))}
                >
                  <option value="P">+ Provento</option>
                  <option value="D">− Desconto</option>
                </select>
                <input
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={e.descricao}
                  placeholder="Descrição"
                  onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, descricao: ev.target.value } : x)))}
                />
                <input
                  className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={e.valor}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, valor: ev.target.value } : x)))}
                />
                {e.tipo === 'P' && (
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={e.tributavel}
                      onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, tributavel: ev.target.checked } : x)))}
                    />
                    entra no INSS/FGTS
                  </label>
                )}
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>
                  remover
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-xs font-medium text-blue-700 hover:underline"
              onClick={() => setExtras([...extras, { descricao: '', valor: '', tipo: 'D', tributavel: false }])}
            >
              + adicionar linha
            </button>
          </div>
        </div>

        {calc && calc.avisos.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {calc.avisos.map((a) => (
              <li key={a}>⚠️ {a}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!calc}
            onClick={() => window.print()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            🖨 Imprimir / Salvar PDF
          </button>
          <span className="text-xs text-slate-500">
            Confira com o contador antes de pagar. Médias de horas extras e comissões não entram sozinhas: lance em “outros proventos”.
          </span>
        </div>
      </div>

      {/* Termo — o que sai na impressão */}
      {!calc ? (
        <p className="text-sm text-slate-500 print:hidden">Preencha salário, admissão e afastamento pra calcular.</p>
      ) : (
        <div className="rounded-xl border border-slate-300 bg-white p-5 text-[13px] text-slate-900 print:rounded-none print:border-0 print:p-0 print:text-[11px]">
          <h2 className="text-center text-base font-bold uppercase">Termo de Rescisão do Contrato de Trabalho</h2>

          <Secao titulo="Empregador">
            <Linha r="CNPJ" v={fmtCnpj(pessoa.cnpj)} />
            <Linha r="Razão social" v={pessoa.empresa} />
            <Linha r="Local de trabalho" v={pessoa.casa} />
          </Secao>

          <Secao titulo="Trabalhador">
            <Linha r="Nome" v={pessoa.nome} />
            <Linha r="CPF" v={fmtCpf(pessoa.cpf)} />
            <Linha r="Endereço" v={pessoa.endereco ?? '—'} />
            <Linha r="Cargo" v={`${pessoa.cargo ?? '—'}${pessoa.cbo ? ` · CBO ${pessoa.cbo}` : ''}`} />
            {pessoa.matricula && <Linha r="Matrícula" v={pessoa.matricula} />}
          </Secao>

          <Secao titulo="Contrato">
            <Linha r="Remuneração mês anterior" v={brl(num(salario))} />
            <Linha r="Admissão" v={fmtData(admissao)} />
            <Linha r="Aviso prévio" v={tipoTemAviso(tipo) ? `${AVISO_LABEL[avisoValido]}${calc.diasAviso ? ` · ${calc.diasAviso} dias` : ''}` : 'Não se aplica'} />
            <Linha r="Afastamento" v={fmtData(afastamento)} />
            {calc.fimProjetado !== afastamento && <Linha r="Projeção do aviso" v={fmtData(calc.fimProjetado)} />}
            <Linha r="Causa do afastamento" v={TIPO_LABEL[tipo]} />
            <Linha r="Código de afastamento" v={CODIGO_AFASTAMENTO[tipo]} />
            {tipoEhExperiencia(tipo) && <Linha r="Fim previsto da experiência" v={fmtData(fimExp)} />}
          </Secao>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <Tabela titulo="Verbas rescisórias" linhas={proventos} total={calc.proventos} rotuloTotal="Total bruto" />
            <Tabela titulo="Deduções" linhas={descontos} total={calc.descontos} rotuloTotal="Total deduções" />
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg border-2 border-slate-900 px-4 py-2">
            <span className="font-bold uppercase">Valor líquido a receber</span>
            <span className="text-lg font-bold">{brl(calc.liquido)}</span>
          </div>

          <div className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2 print:grid-cols-2">
            <span>Base INSS: {brl(calc.baseInss)} · 13º: {brl(calc.baseInss13)}</span>
            <span>FGTS do mês: {brl(calc.fgtsMes)} · FGTS 13º: {brl(calc.fgts13)}</span>
            {calc.multaFgtsPct > 0 && (
              <span>
                Multa FGTS {Math.round(calc.multaFgtsPct * 100)}%: {brl(calc.multaFgts)} (guia à parte)
              </span>
            )}
            <span>Pagamento até: {fmtData(calc.dataLimite)} (art. 477 §6)</span>
          </div>

          <div className="mt-12 grid gap-10 sm:grid-cols-2 print:grid-cols-2">
            <Assinatura texto={`${pessoa.empresa} — empregador`} />
            <Assinatura texto={`${pessoa.nome} — trabalhador`} />
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">Aracaju, ____ de ______________ de ______</p>
        </div>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="border-b border-slate-300 pb-0.5 text-xs font-bold uppercase text-slate-700">{titulo}</p>
      <dl className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2 print:grid-cols-2">{children}</dl>
    </div>
  );
}

function Linha({ r, v }: { r: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{r}:</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function Tabela(props: {
  titulo: string;
  linhas: { codigo: string; descricao: string; referencia: string; valor: number }[];
  total: number;
  rotuloTotal: string;
}) {
  return (
    <div>
      <p className="border-b border-slate-300 pb-0.5 text-xs font-bold uppercase text-slate-700">{props.titulo}</p>
      <table className="mt-1 w-full">
        <tbody>
          {props.linhas.map((l, i) => (
            <tr key={i} className="border-b border-slate-100 align-top">
              <td className="w-12 py-1 pr-2 text-slate-500">{l.codigo}</td>
              <td className="py-1 pr-2">
                {l.descricao}
                {l.referencia && <span className="text-slate-500"> ({l.referencia})</span>}
              </td>
              <td className="py-1 text-right tabular-nums">{brl(l.valor)}</td>
            </tr>
          ))}
          {props.linhas.length === 0 && (
            <tr>
              <td colSpan={3} className="py-1 text-slate-400">—</td>
            </tr>
          )}
          <tr className="font-bold">
            <td />
            <td className="py-1.5">{props.rotuloTotal}</td>
            <td className="py-1.5 text-right tabular-nums">{brl(props.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Assinatura({ texto }: { texto: string }) {
  return (
    <div className="text-center">
      <div className="border-t border-slate-900 pt-1 text-xs">{texto}</div>
    </div>
  );
}
