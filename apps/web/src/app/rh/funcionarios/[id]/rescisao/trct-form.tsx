'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';
import {
  AVISO_LABEL,
  CAUSA_AFASTAMENTO,
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
import type { FaltasDoPonto } from '@/lib/rh/trct-faltas';

interface Pessoa {
  nascimento: string | null;
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
const fmtCep = (c: string) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5)}` : c;
};
const fmtValor = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Empregador {
  endereco: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  cnae: string;
}

/** Campos do TRCT oficial que o cadastro não tem (PIS, CTPS, mãe...). Ficam
 *  guardados neste navegador por funcionário. Vazio = o sistema preenche. */
interface DadosTermo {
  pis: string;
  ctps: string;
  mae: string;
  nascimento: string;
  endereco: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  empEndereco: string;
  empBairro: string;
  empMunicipio: string;
  empUf: string;
  empCep: string;
  cnae: string;
  tomador: string;
  codSindical: string;
  entidadeSindical: string;
  categoria: string;
  pensaoTrct: string;
  pensaoFgts: string;
  tipoContrato: string;
  dataAviso: string;
  remAnterior: string;
  salFamilia: string;
  pagamento: string;
  preposto: string;
  prepostoCargo: string;
}

const CONTRATO_INDETERMINADO = '1. Contrato de trabalho por prazo indeterminado';
const CONTRATO_EXPERIENCIA =
  '3. Contrato de trabalho por prazo determinado sem cláusula assecuratória de direito recíproco de rescisão antecipada';
const num = (s: string) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function tipoSugerido(admissao: string, afastamento: string, motivo: string | null, temCarta = false): TipoRescisao {
  const m = (motivo ?? '').toLowerCase();
  const dias = admissao && afastamento ? diasEntre(admissao, afastamento) + 1 : 999;
  const pedido = temCarta || m.includes('pedido') || m.includes('pediu');
  if (dias <= 90) return pedido ? 'experiencia_empregado' : 'experiencia_empregador';
  if (m.includes('justa')) return 'justa_causa';
  if (m.includes('acordo')) return 'acordo';
  return pedido ? 'pedido_demissao' : 'sem_justa_causa';
}

export function TrctForm(props: {
  funcionarioId: string;
  empregador: Empregador;
  pessoa: Pessoa;
  inicial: {
    salario: number;
    admissao: string;
    afastamento: string;
    noturno: number;
    salFamilia: { cotas: number; valorCota: number } | null;
    faltasPonto: FaltasDoPonto | null;
    /** Carta de pedido de demissão subida na ficha. */
    cartaPedido?: { nome: string } | null;
  };
}) {
  const { pessoa, inicial, empregador } = props;
  const chave = `trct-dados:${props.funcionarioId}`;
  const [dados, setDados] = useState<DadosTermo>({
    pis: '',
    ctps: '',
    mae: '',
    nascimento: pessoa.nascimento ?? '',
    endereco: pessoa.endereco ?? '',
    bairro: '',
    municipio: 'ARACAJU',
    uf: 'SE',
    cep: '',
    empEndereco: empregador.endereco,
    empBairro: empregador.bairro,
    empMunicipio: empregador.municipio,
    empUf: empregador.uf,
    empCep: empregador.cep,
    cnae: empregador.cnae,
    tomador: '',
    codSindical: '',
    entidadeSindical: '',
    categoria: '01 - Empregado',
    pensaoTrct: '0,00',
    pensaoFgts: '0,00',
    tipoContrato: '',
    dataAviso: '',
    remAnterior: '',
    salFamilia: '',
    pagamento: '',
    preposto: 'ELISON VIEIRA SANTOS DO BOMFIM',
    prepostoCargo: 'SOCIO',
  });
  const [carregou, setCarregou] = useState(false);
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(chave);
      if (salvo) setDados((d) => ({ ...d, ...(JSON.parse(salvo) as Partial<DadosTermo>) }));
    } catch {
      /* sem armazenamento: segue com o padrão */
    }
    setCarregou(true);
  }, [chave]);
  useEffect(() => {
    if (!carregou) return;
    try {
      window.localStorage.setItem(chave, JSON.stringify(dados));
    } catch {
      /* ignora */
    }
  }, [carregou, chave, dados]);
  const setD = (k: keyof DadosTermo) => (e: { target: { value: string } }) => setDados((d) => ({ ...d, [k]: e.target.value }));
  const [salario, setSalario] = useState(String(inicial.salario || ''));
  const [admissao, setAdmissao] = useState(inicial.admissao);
  const [afastamento, setAfastamento] = useState(inicial.afastamento);
  const [tipo, setTipo] = useState<TipoRescisao>(
    tipoSugerido(inicial.admissao, inicial.afastamento, pessoa.motivo, !!inicial.cartaPedido),
  );
  const [aviso, setAviso] = useState<AvisoPrevio>('indenizado');
  // Contrato de experiência de 45 dias (o padrão da E.B.): fim = admissão + 44.
  const [fimExp, setFimExp] = useState(inicial.admissao ? somarDiasYmd(inicial.admissao, 44) : '');
  // Com a carta de pedido na ficha já vem marcado (é como o contador faz); dá pra desmarcar.
  const [art480, setArt480] = useState(!!inicial.cartaPedido);
  const [feriasVenc, setFeriasVenc] = useState('0');
  const [adiant13, setAdiant13] = useState('');
  const [dependentes, setDependentes] = useState('0');
  const [saldoFgts, setSaldoFgts] = useState('');
  // Faltas: já vêm do ponto (dias sem batida fora da folga e sem atestado).
  const fp = inicial.faltasPonto;
  const [faltas, setFaltas] = useState(String(fp?.faltas ?? 0));
  const [dsrPerdidos, setDsrPerdidos] = useState(String(fp?.dsr ?? 0));
  const [faltasFerias, setFaltasFerias] = useState('');
  const [extras, setExtras] = useState<{ descricao: string; valor: string; tipo: 'P' | 'D'; tributavel: boolean; codigo?: string }[]>(
    inicial.noturno > 0
      ? [{ descricao: 'Adicional noturno e reflexos do mês (ponto)', valor: inicial.noturno.toFixed(2).replace('.', ','), tipo: 'P', tributavel: true, codigo: '55' }]
      : [],
  );

  // Salário-família automático: cotas da folha do contador, proporcional aos dias do mês.
  const diasMesSaida = useMemo(() => {
    if (!admissao || !afastamento) return 30;
    const [a, m, d] = afastamento.split('-').map(Number);
    const ini = `${a}-${String(m).padStart(2, '0')}-01`;
    const de = admissao > ini ? admissao : ini;
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    if (de === ini && d === ultimo) return 30;
    return Math.max(0, Math.min(30, diasEntre(de, afastamento) + 1));
  }, [admissao, afastamento]);
  const salFamiliaAuto = inicial.salFamilia
    ? Math.round(inicial.salFamilia.cotas * inicial.salFamilia.valorCota * (diasMesSaida / 30) * 100) / 100
    : 0;
  const salFamiliaValor = dados.salFamilia.trim() ? num(dados.salFamilia) : salFamiliaAuto;

  const calc = useMemo(() => {
    if (!admissao || !afastamento || !(num(salario) > 0) || afastamento < admissao) return null;
    const ex: ExtraTrct[] = extras
      .map((e) => ({ descricao: e.descricao, valor: num(e.valor), tipo: e.tipo, tributavel: e.tributavel, codigo: e.codigo }))
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
      salarioFamilia: salFamiliaValor,
      faltas: Number(faltas) || 0,
      dsrPerdidos: Number(dsrPerdidos) || 0,
      faltasFerias: faltasFerias.trim() ? Number(faltasFerias) || 0 : undefined,
    });
  }, [salario, admissao, afastamento, tipo, aviso, fimExp, art480, feriasVenc, adiant13, dependentes, saldoFgts, extras, salFamiliaValor, faltas, dsrPerdidos, faltasFerias]);

  // Campo 23: remuneração do mês anterior ao afastamento (proporcional se entrou nele).
  const remAnteriorAuto = useMemo(() => {
    if (!admissao || !afastamento) return 0;
    const [a, m] = afastamento.split('-').map(Number);
    const pa = m === 1 ? a - 1 : a;
    const pm = m === 1 ? 12 : m - 1;
    const ini = `${pa}-${String(pm).padStart(2, '0')}-01`;
    const ultimo = new Date(Date.UTC(pa, pm, 0)).getUTCDate();
    const fim = `${pa}-${String(pm).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
    if (admissao > fim) return 0;
    if (admissao <= ini) return num(salario);
    return Math.round((num(salario) / 30) * (diasEntre(admissao, fim) + 1) * 100) / 100;
  }, [admissao, afastamento, salario]);

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
        {inicial.cartaPedido && (
          <p className="text-xs text-emerald-700">
            📄 Carta de pedido de demissão na ficha ({inicial.cartaPedido.nome}): tipo sugerido como saída pela pessoa.
          </p>
        )}

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

        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={rotulo}>
              Faltas sem atestado no mês (dias)
              <input className={input} value={faltas} onChange={(e) => setFaltas(e.target.value)} inputMode="numeric" />
            </label>
            <label className={rotulo}>
              DSR perdido (dias, 1 por semana com falta)
              <input className={input} value={dsrPerdidos} onChange={(e) => setDsrPerdidos(e.target.value)} inputMode="numeric" />
            </label>
            <label className={rotulo}>
              Faltas no período das férias (art. 130)
              <input className={input} value={faltasFerias} onChange={(e) => setFaltasFerias(e.target.value)} inputMode="numeric" placeholder={`em branco = ${Number(faltas) || 0} (as do mês)`} />
            </label>
          </div>
          {fp ? (
            <details className="mt-2 text-xs text-slate-700">
              <summary className="cursor-pointer">
                Pelo ponto de {fmtData(fp.de)} a {fmtData(fp.ate)}: {fp.diasComPonto} dia(s) com batida, {fp.faltas} falta(s) e {fp.dsr} DSR perdido(s)
                {fp.ate !== afastamento && ' — a data de saída mudou, confira'}
              </summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {fp.semanas.map((w) => (
                  <li key={w.de}>
                    {fmtData(w.de).slice(0, 5)}–{fmtData(w.ate).slice(0, 5)}:{' '}
                    {w.semPonto.length === 0
                      ? 'bateu todos os dias'
                      : `sem ponto ${w.semPonto.map((d) => d.slice(8)).join(', ')}`}
                    {w.folgas.length > 0 && ` · folga na escala ${w.folgas.map((d) => d.slice(8)).join(', ')}`}
                    {w.folgaSuposta && ' · sem escala: 1 folga suposta'}
                    {' → '}
                    <b>{w.faltas} falta(s){w.dsr ? ' + DSR' : ''}</b>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-slate-500">
                Atestado lançado abona o dia. Folga combinada fora da escala: corrija os números acima antes de imprimir.
              </p>
            </details>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Sem batida de ponto no mês da saída: faltas não calculadas, preencha se houver.</p>
          )}
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
                {e.tipo === 'P' && (
                  <select
                    className="rounded-md border border-slate-300 px-1.5 py-1.5 text-xs"
                    title="Campo do TRCT"
                    value={e.codigo ?? ''}
                    onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, codigo: ev.target.value || undefined } : x)))}
                  >
                    <option value="">outros</option>
                    <option value="51">51 Comissões</option>
                    <option value="52">52 Gratificação</option>
                    <option value="55">55 Adic. noturno</option>
                    <option value="56.1">56.1 Horas extras</option>
                    <option value="57">57 Gorjetas</option>
                    <option value="58">58 DSR</option>
                  </select>
                )}
                {e.tipo === 'D' && (
                  <select
                    className="rounded-md border border-slate-300 px-1.5 py-1.5 text-xs"
                    title="Campo do TRCT"
                    value={e.codigo ?? ''}
                    onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, codigo: ev.target.value || undefined } : x)))}
                  >
                    <option value="">outros</option>
                    <option value="100">100 Pensão</option>
                    <option value="101">101 Adiant. salarial</option>
                  </select>
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

        <details className="rounded-lg border border-slate-200 p-3" open={!dados.pis || !dados.ctps || !dados.mae}>
          <summary className="cursor-pointer text-sm font-medium text-slate-800">
            Dados do termo (PIS, CTPS, mãe, endereço, empregador…) — ficam guardados neste navegador
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={rotulo}>10 PIS/PASEP<input className={input} value={dados.pis} onChange={setD('pis')} /></label>
            <label className={rotulo}>17 CTPS (nº, série, UF)<input className={input} value={dados.ctps} onChange={setD('ctps')} placeholder="4728391 - 0010 / SE" /></label>
            <label className={rotulo}>19 Nascimento<input type="date" className={input} value={dados.nascimento} onChange={setD('nascimento')} /></label>
            <label className={rotulo}>20 Nome da mãe<input className={input} value={dados.mae} onChange={setD('mae')} /></label>
            <label className={`${rotulo} sm:col-span-2`}>12 Endereço do trabalhador<input className={input} value={dados.endereco} onChange={setD('endereco')} /></label>
            <label className={rotulo}>13 Bairro<input className={input} value={dados.bairro} onChange={setD('bairro')} /></label>
            <label className={rotulo}>16 CEP<input className={input} value={dados.cep} onChange={setD('cep')} /></label>
            <label className={rotulo}>14 Município<input className={input} value={dados.municipio} onChange={setD('municipio')} /></label>
            <label className={rotulo}>15 UF<input className={input} value={dados.uf} onChange={setD('uf')} /></label>
            <label className={rotulo}>30 Categoria<input className={input} value={dados.categoria} onChange={setD('categoria')} /></label>
            <label className={rotulo}>28 / 29 Pensão (%) TRCT · FGTS
              <span className="flex gap-2">
                <input className={input} value={dados.pensaoTrct} onChange={setD('pensaoTrct')} />
                <input className={input} value={dados.pensaoFgts} onChange={setD('pensaoFgts')} />
              </span>
            </label>
            <label className={`${rotulo} sm:col-span-2`}>03 Endereço do empregador<input className={input} value={dados.empEndereco} onChange={setD('empEndereco')} /></label>
            <label className={rotulo}>04 Bairro<input className={input} value={dados.empBairro} onChange={setD('empBairro')} /></label>
            <label className={rotulo}>07 CEP<input className={input} value={dados.empCep} onChange={setD('empCep')} /></label>
            <label className={rotulo}>05 Município<input className={input} value={dados.empMunicipio} onChange={setD('empMunicipio')} /></label>
            <label className={rotulo}>06 UF<input className={input} value={dados.empUf} onChange={setD('empUf')} /></label>
            <label className={rotulo}>08 CNAE<input className={input} value={dados.cnae} onChange={setD('cnae')} /></label>
            <label className={rotulo}>09 CNPJ/CEI tomador/obra<input className={input} value={dados.tomador} onChange={setD('tomador')} /></label>
            <label className={rotulo}>31 Código sindical<input className={input} value={dados.codSindical} onChange={setD('codSindical')} /></label>
            <label className={`${rotulo} sm:col-span-3`}>32 CNPJ e nome da entidade sindical<input className={input} value={dados.entidadeSindical} onChange={setD('entidadeSindical')} /></label>
            <label className={`${rotulo} sm:col-span-4`}>21 Tipo de contrato
              <input className={input} value={dados.tipoContrato} onChange={setD('tipoContrato')} placeholder={tipoEhExperiencia(tipo) ? CONTRATO_EXPERIENCIA : CONTRATO_INDETERMINADO} />
            </label>
            <label className={rotulo}>23 Remuneração mês anterior
              <input className={input} value={dados.remAnterior} onChange={setD('remAnterior')} placeholder={fmtValor(remAnteriorAuto)} inputMode="decimal" />
            </label>
            <label className={rotulo}>25 Data do aviso prévio<input type="date" className={input} value={dados.dataAviso || afastamento} onChange={setD('dataAviso')} /></label>
            <label className={rotulo}>62 Salário-família (R$)
              <input
                className={input}
                value={dados.salFamilia}
                onChange={setD('salFamilia')}
                inputMode="decimal"
                placeholder={inicial.salFamilia ? `${fmtValor(salFamiliaAuto)} (${inicial.salFamilia.cotas} cota(s))` : '0,00'}
              />
            </label>
            <label className={rotulo}>Data do pagamento (quitação)
              <input type="date" className={input} value={dados.pagamento || (calc?.dataLimite ?? '')} onChange={setD('pagamento')} />
            </label>
            <label className={`${rotulo} sm:col-span-2`}>150 Preposto (quem assina pela empresa)<input className={input} value={dados.preposto} onChange={setD('preposto')} /></label>
            <label className={rotulo}>Cargo do preposto<input className={input} value={dados.prepostoCargo} onChange={setD('prepostoCargo')} /></label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Em branco = o sistema preenche (o valor cinza dentro do campo).</p>
        </details>

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

      {/* Termo — o que sai na impressão. Mesmo modelo do TRCT oficial que o
          contador usa (Portaria 1.621/2010): 2 páginas, campos numerados. */}
      {!calc ? (
        <p className="text-sm text-slate-500 print:hidden">Preencha salário, admissão e afastamento pra calcular.</p>
      ) : (
        <TermoOficial
          pessoa={pessoa}
          dados={dados}
          calc={calc}
          tipo={tipo}
          admissao={admissao}
          afastamento={afastamento}
          tipoContrato={dados.tipoContrato.trim() || (tipoEhExperiencia(tipo) ? CONTRATO_EXPERIENCIA : CONTRATO_INDETERMINADO)}
          remAnterior={dados.remAnterior.trim() ? num(dados.remAnterior) : remAnteriorAuto}
          dataAviso={dados.dataAviso || afastamento}
          pagamento={dados.pagamento || calc.dataLimite}
        />
      )}
    </div>
  );
}

type Calc = NonNullable<ReturnType<typeof calcularTrct>>;

const CAB = 'bg-[#d9d9d9] text-center text-[10px] font-bold uppercase';

/** Uma célula com rótulo pequeno em cima e o valor embaixo, como no TRCT. */
function C(props: { n: string; r: string; v?: React.ReactNode; span?: number; alto?: boolean }) {
  return (
    <td colSpan={props.span ?? 1} className={`border border-black px-1 align-top ${props.alto ? 'h-[11mm]' : ''}`}>
      <div className="text-[8px] leading-tight">
        {props.n} {props.r}
      </div>
      <div className="min-h-[13px] text-[11px] leading-tight">{props.v}</div>
    </td>
  );
}

function Barra({ t, span = 12, esquerda }: { t: string; span?: number; esquerda?: boolean }) {
  return (
    <tr>
      <td colSpan={span} className={`border border-black ${CAB} ${esquerda ? '!text-left px-1' : ''}`}>
        {t}
      </td>
    </tr>
  );
}

function Cols({ n }: { n: number }) {
  return (
    <colgroup>
      {Array.from({ length: n }, (_, i) => (
        <col key={i} style={{ width: `${100 / n}%` }} />
      ))}
    </colgroup>
  );
}

interface Celula {
  rotulo: React.ReactNode;
  valor: number | null;
  destaque?: boolean;
}

function GradeVerbas({ titulo, cab, celulas }: { titulo: string; cab: string; celulas: (Celula | null)[] }) {
  const linhas: (Celula | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 3) linhas.push(celulas.slice(i, i + 3));
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {[0, 1, 2].map((i) => (
          <Fragment key={i}>
            <col style={{ width: '19.33%' }} />
            <col style={{ width: '14%' }} />
          </Fragment>
        ))}
      </colgroup>
      <tbody>
        <tr>
          <td colSpan={6} className="border-x border-black px-1 text-[10px] font-bold uppercase">
            {titulo}
          </td>
        </tr>
        <tr className="text-[10px] font-bold">
          {[0, 1, 2].map((i) => (
            <Fragment key={i}>
              <td className="border border-black px-1">{cab}</td>
              <td className="border border-black px-1">Valor</td>
            </Fragment>
          ))}
        </tr>
        {linhas.map((l, i) => (
          <tr key={i} className="h-[7.5mm]">
            {l.map((c, j) =>
              c ? (
                <Fragment key={j}>
                  <td className={`border border-black px-1 align-top text-[8.5px] leading-tight ${c.destaque ? 'bg-[#d9d9d9] align-middle text-[10px] font-bold uppercase' : ''}`}>
                    {c.rotulo}
                  </td>
                  <td className={`border border-black px-1 text-right text-[11px] ${c.destaque ? 'bg-[#d9d9d9] font-bold' : ''}`}>
                    {c.valor === null ? '' : `R$ ${fmtValor(c.valor)}`}
                  </td>
                </Fragment>
              ) : (
                <Fragment key={j}>
                  <td className="border border-black" />
                  <td className="border border-black" />
                </Fragment>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TermoOficial(props: {
  pessoa: Pessoa;
  dados: DadosTermo;
  calc: Calc;
  tipo: TipoRescisao;
  admissao: string;
  afastamento: string;
  tipoContrato: string;
  remAnterior: number;
  dataAviso: string;
  pagamento: string;
}) {
  const { pessoa, dados, calc, tipo } = props;
  const cod = CODIGO_AFASTAMENTO[tipo];
  const causa = CAUSA_AFASTAMENTO[tipo];

  // Soma por campo do TRCT; o que não tem campo próprio vai nas linhas em branco.
  const MAPA: Record<string, string> = { '66': '66.1' };
  const P_FIXOS = new Set(['50', '51', '52', '53', '54', '55', '56.1', '57', '58', '59', '60', '61', '62', '63', '64.1', '65', '66.1', '68', '69', '70', '71', '99']);
  const D_FIXOS = new Set(['100', '101', '102', '103', '104', '112.1', '112.2', '114.1', '114.2']);
  const porCodigo = new Map<string, number>();
  const ref = new Map<string, string>();
  const outrosP: Celula[] = [];
  const outrosD: Celula[] = [];
  for (const v of calc.verbas) {
    const c = MAPA[v.codigo] ?? v.codigo;
    const fixos = v.tipo === 'P' ? P_FIXOS : D_FIXOS;
    if (fixos.has(c)) {
      porCodigo.set(c, (porCodigo.get(c) ?? 0) + v.valor);
      if (v.referencia) ref.set(c, v.referencia);
    } else {
      (v.tipo === 'P' ? outrosP : outrosD).push({ rotulo: `${v.codigo} ${v.descricao}`, valor: v.valor });
    }
  }
  const val = (c: string) => Math.round((porCodigo.get(c) ?? 0) * 100) / 100;
  const avos = (c: string) => ref.get(c)?.match(/^(\d+)\/12/)?.[1] ?? '__';
  const diasAvisoInd = ref.get('69')?.match(/^(\d+)/)?.[1] ?? '___';
  const diasAvisoDesc = ref.get('103')?.match(/^(\d+)/)?.[1] ?? '___';
  const cel = (rotulo: React.ReactNode, c: string): Celula => ({ rotulo, valor: val(c) });

  const vazios = (lista: Celula[], n: number) => {
    const saida: (Celula | null)[] = lista.slice(0, n);
    while (saida.length < n) saida.push(null);
    return saida;
  };
  // Mais "outros" do que linhas: junta o resto na última.
  const juntar = (lista: Celula[], n: number): Celula[] => {
    if (lista.length <= n) return lista;
    const resto = lista.slice(n - 1);
    return [...lista.slice(0, n - 1), { rotulo: resto.map((r) => r.rotulo).join(' + '), valor: resto.reduce((s, r) => s + (r.valor ?? 0), 0) }];
  };
  const extrasP = vazios(juntar(outrosP, 7), 7);
  const extrasD = vazios(juntar(outrosD, 8), 8);

  const verbas: (Celula | null)[] = [
    cel(<>50 Saldo de {calc.diasSaldo}/dias Salário (líquido de {calc.faltasDsr}/faltas e DSR)</>, '50'),
    cel('51 Comissões', '51'),
    cel('52 Gratificação', '52'),
    cel(<>53 Adic. de Insalubridade ___%</>, '53'),
    cel(<>54 Adic. de Periculosidade ___%</>, '54'),
    cel(<>55 Adic. Noturno ___ horas ___%</>, '55'),
    cel(<>56.1 Horas Extras ___ horas a ___%</>, '56.1'),
    cel('57 Gorjetas', '57'),
    cel('58 Descanso Semanal Remunerado (DSR)', '58'),
    cel('59 Reflexo do DSR sobre Salário Variável', '59'),
    cel('60 Multa Art. 477 § 8º/CLT', '60'),
    cel('61 Multa Art. 479/CLT', '61'),
    cel('62 Salário-Família', '62'),
    cel(<>63 13º Salário Proporcional {avos('63')}/12 avos</>, '63'),
    cel(<>64.1 13º Salário-Exerc. ____ - __/12 avos</>, '64.1'),
    cel(<>65 Férias Proporc {avos('65')}/12 avos</>, '65'),
    cel(<>66.1 Férias Venc. Per. Aquis. / / a / /</>, '66.1'),
    cel('68 Terço Constituc. de Férias', '68'),
    cel(<>69 - Aviso-Prévio Indenizado {diasAvisoInd}/dias</>, '69'),
    cel('70 13º Salário (Aviso Prévio Indenizado)', '70'),
    cel('71 Férias (Aviso-Prévio Indenizado)', '71'),
    ...extrasP,
    cel('99 Ajuste de Saldo Devedor', '99'),
    { rotulo: 'Total bruto', valor: calc.proventos, destaque: true },
  ];
  const deducoes: (Celula | null)[] = [
    cel('100 Pensão Alimentícia', '100'),
    cel('101 Adiantamento Salarial', '101'),
    cel('102 Adiantamento 13º Salário', '102'),
    cel(<>103 Aviso-Prévio Indenizado{diasAvisoDesc}/dias</>, '103'),
    cel('104 Indenização Art. 480 CLT', '104'),
    cel('112.1 Previdência Social', '112.1'),
    cel(<>112.2 Prev. Social - 13º Salário</>, '112.2'),
    cel('114.1 IRRF', '114.1'),
    cel('114.2 IRRF sobre 13º Salário', '114.2'),
    ...extrasD.slice(0, 6),
    extrasD[6],
    extrasD[7],
    { rotulo: 'Total deduções', valor: calc.descontos, destaque: true },
    null,
    null,
    { rotulo: 'Valor líquido', valor: calc.liquido, destaque: true },
  ];

  const empCnpj = fmtCnpj(pessoa.cnpj);
  const cpf = fmtCpf(pessoa.cpf);
  const nasc = dados.nascimento ? fmtData(dados.nascimento) : '';

  return (
    <div className="mx-auto w-full max-w-[190mm] bg-white font-[Arial,Helvetica,sans-serif] text-black print:max-w-none">
      <style>{'@media print{@page{size:A4;margin:9mm 10mm}}'}</style>

      {/* Página 1 — TRCT */}
      <div className="border border-slate-300 p-3 print:border-0 print:p-0">
        <div className={`border border-black py-0.5 text-[15px] ${CAB}`}>Termo de Rescisão do Contrato de Trabalho</div>
        <table className="mt-3 w-full table-fixed border-collapse">
          <Cols n={12} />
          <tbody>
            <Barra t="Identificação do Empregador" />
            <tr>
              <C n="01" r="CNPJ/CEI" v={empCnpj} span={3} />
              <C n="02" r="Razão Social/Nome" v={pessoa.empresa} span={9} />
            </tr>
            <tr>
              <C n="03" r="Endereço (logradouro, nº, andar, apartamento)" v={dados.empEndereco} span={9} />
              <C n="04" r="Bairro" v={dados.empBairro} span={3} />
            </tr>
            <tr>
              <C n="05" r="Município" v={dados.empMunicipio} span={4} />
              <C n="06" r="UF" v={dados.empUf} span={1} />
              <C n="07" r="CEP" v={fmtCep(dados.empCep)} span={2} />
              <C n="08" r="CNAE" v={dados.cnae} span={2} />
              <C n="09" r="CNPJ/CEI Tomador/Obra" v={dados.tomador} span={3} />
            </tr>
            <Barra t="Identificação do Trabalhador" />
            <tr>
              <C n="10" r="PIS/PASEP" v={dados.pis} span={3} />
              <C n="11" r="Nome" v={pessoa.nome} span={9} />
            </tr>
            <tr>
              <C n="12" r="Endereço (logradouro, nº, andar, apartamento)" v={dados.endereco} span={9} />
              <C n="13" r="Bairro" v={dados.bairro} span={3} />
            </tr>
            <tr>
              <C n="14" r="Município" v={dados.municipio} span={3} />
              <C n="15" r="UF" v={dados.uf} span={1} />
              <C n="16" r="CEP" v={fmtCep(dados.cep)} span={2} />
              <C n="17" r="CTPS (nº, série, UF)" v={dados.ctps} span={4} />
              <C n="18" r="CPF" v={cpf} span={2} />
            </tr>
            <tr>
              <C n="19" r="Data de Nascimento" v={nasc} span={3} />
              <C n="20" r="Nome da Mãe" v={dados.mae} span={9} />
            </tr>
            <Barra t="Dados do Contrato" />
            <tr>
              <C n="21" r="Tipo de Contrato" v={props.tipoContrato} span={12} alto />
            </tr>
            <tr>
              <C n="22" r="Causa do Afastamento" v={causa} span={12} alto />
            </tr>
            <tr>
              <C n="23" r="Remuneração Mês Ant." v={fmtValor(props.remAnterior)} span={3} />
              <C n="24" r="Data de Admissão" v={fmtData(props.admissao)} span={2} />
              <C n="25" r="Data do Aviso Prévio" v={fmtData(props.dataAviso)} span={2} />
              <C n="26" r="Data de Afastamento" v={fmtData(props.afastamento)} span={3} />
              <C n="27" r="Cod. Afastamento" v={cod} span={2} />
            </tr>
            <tr>
              <C n="28" r="Pensão Alim. (%) TRCT" v={dados.pensaoTrct} span={3} />
              <C n="29" r="Pensão Alim. (%) FGTS" v={dados.pensaoFgts} span={3} />
              <C n="30" r="Categoria do Trabalhador" v={dados.categoria} span={6} />
            </tr>
            <tr>
              <C n="31" r="Código Sindical" v={dados.codSindical} span={3} />
              <C n="32" r="CNPJ e Nome da Entidade Sindical Laboral" v={dados.entidadeSindical} span={9} />
            </tr>
            <Barra t="Discriminação das Verbas Rescisórias" />
          </tbody>
        </table>
        <GradeVerbas titulo="Verbas rescisórias" cab="Rubrica" celulas={verbas} />
        <GradeVerbas titulo="Deduções" cab="Desconto" celulas={deducoes} />
      </div>

      {/* Página 2 — Termo de quitação */}
      <div className="mt-6 flex flex-col border border-slate-300 p-3 print:mt-0 print:h-[278mm] print:break-before-page print:border-0 print:p-0">
        <div className={`border border-black py-0.5 text-[15px] ${CAB}`}>Termo de Quitação de Rescisão do Contrato de Trabalho</div>
        <table className="mt-3 w-full table-fixed border-collapse">
          <Cols n={12} />
          <tbody>
            <Barra t="Empregador" esquerda />
            <tr>
              <C n="01" r="CNPJ/CEI" v={empCnpj} span={3} />
              <C n="02" r="Razão Social/Nome" v={pessoa.empresa} span={9} />
            </tr>
            <Barra t="Trabalhador" esquerda />
            <tr>
              <C n="10" r="PIS/PASEP" v={dados.pis} span={3} />
              <C n="11" r="Nome" v={pessoa.nome} span={9} />
            </tr>
            <tr>
              <C n="17" r="CTPS (nº, série, UF)" v={dados.ctps} span={3} />
              <C n="18" r="CPF" v={cpf} span={2} />
              <C n="19" r="Data de Nascimento" v={nasc} span={2} />
              <C n="20" r="Nome da Mãe" v={dados.mae} span={5} />
            </tr>
            <Barra t="Contrato" esquerda />
            <tr>
              <C n="22" r="Causa do Afastamento" v={causa} span={12} alto />
            </tr>
            <tr>
              <C n="24" r="Data de Admissão" v={fmtData(props.admissao)} span={2} />
              <C n="25" r="Data do Aviso Prévio" v={fmtData(props.dataAviso)} span={2} />
              <C n="26" r="Data de Afastamento" v={fmtData(props.afastamento)} span={2} />
              <C n="27" r="Cod. Afastamento" v={cod} span={3} />
              <C n="29" r="Pensão Alim. (%) FGTS" v={dados.pensaoFgts} span={3} />
            </tr>
            <tr>
              <C n="30" r="Categoria do Trabalhador" v={dados.categoria} span={12} />
            </tr>
          </tbody>
        </table>

        <p className="mt-6 text-justify text-[10.5px] leading-snug">
          No dia {fmtData(props.pagamento)} foi realizado, nos termos do art. 23 da Instrução Normativa/SRT n.º 15/2010, o
          efetivo pagamento das verbas rescisórias especificadas no corpo do TRCT, no valor líquido de R$ {fmtValor(calc.liquido)}, o
          qual, devidamente rubricado pelas partes, é parte integrante do presente Termo de Quitação.
        </p>

        <p className="mt-8 text-[10.5px]">
          ______________________ / ______, _______ de _____________________ de ____________.
        </p>

        <div className="mt-14 w-[45%]">
          <div className="border-t border-black pt-1 text-[10px] leading-tight">
            150 Assinatura do Empregador ou Preposto
            <div className="mt-0.5 text-[9px]">{pessoa.empresa}</div>
            <div className="text-[9px]">{dados.preposto}</div>
            <div className="text-[9px]">{dados.prepostoCargo}</div>
          </div>
        </div>

        <div className="mt-14 flex justify-between gap-10">
          <div className="w-[45%] border-t border-black pt-1 text-[10px]">151 Assinatura do Trabalhador</div>
          <div className="w-[45%] border-t border-black pt-1 text-[10px]">152 Assinatura do Responsável Legal do Trabalhador</div>
        </div>

        <div className="mt-auto pt-10">
          <div className="border border-black px-1 text-[10px]">156 Informações à CAIXA:</div>
          <div className="border-x border-b border-black bg-[#d9d9d9] px-2 py-1 text-center text-[10.5px] font-bold leading-snug">
            A ASSISTÊNCIA NO ATO DE RESCISÃO CONTRATUAL É GRATUITA.
            <br />
            Pode o trabalhador iniciar ação judicial quanto aos créditos resultantes das relações de trabalho até o limite de dois
            anos após a extinção do contrato de trabalho (Inc. XXIX, Art. 7º da Constituição Federal/1988).
          </div>
        </div>
      </div>
    </div>
  );
}
