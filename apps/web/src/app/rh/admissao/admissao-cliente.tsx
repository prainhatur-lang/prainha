'use client';

import { useCallback, useEffect, useState } from 'react';

interface Props {
  filialId: string;
  filialNome: string;
  hoje: string;
  empregadores: { cnpj: string; rotulo: string }[];
  casas?: { id: string; nome: string }[];
  empregadorPadrao: string;
}

interface Consulta {
  fonte: string;
  spcDisponivel: boolean;
  erroSpc: string | null;
  dados: {
    nome: string | null;
    email: string | null;
    telefone: string | null;
    celular: string | null;
    dataNascimento: string | null;
    mae: string | null;
    pai?: string | null;
    endereco: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  };
  existente: {
    id: string;
    nome: string;
    ativo: boolean;
    casa: string;
    empresaRegistro: string | null;
    regime: string | null;
    dataAdmissao: string | null;
    dataDesligamento: string | null;
    telefone: string | null;
  } | null;
  conviteAberto: { id: string; status: string; criadoEm: string } | null;
}

interface Convite {
  id: string;
  cpf: string;
  nome: string;
  telefone: string;
  status: string;
  termos: { cargo?: string; modelo?: string; valor?: string; admissao?: string; aso?: Aso };
  link: string;
  guiaAso?: string | null;
  expiraEm: string;
  criadoEm: string;
  abertoEm: string | null;
  assinadoEm: string | null;
  funcionarioId: string | null;
  assinaturaId: string | null;
  docs: number;
  vencido: boolean;
}

const mascaraCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
};
const fmtData = (ymd: string | null) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Maceio', dateStyle: 'short', timeStyle: 'short' }) : '—';

interface Aso {
  clinica: string;
  endereco: string;
  telefone: string;
  data: string;
  hora: string;
  observacao: string;
}
// Clínica de sempre (contas pagas de ASO vão pra MEDSEG, CNPJ 43.017.222/0001-20). Dá pra trocar no formulário.
const ASO_VAZIO: Aso = {
  clinica: 'MEDSEG (Centro Médico do Trabalhador)',
  endereco: 'Rua Bahia, 1429, Siqueira Campos, Aracaju-SE',
  telefone: '(79) 3012-2050',
  data: '',
  hora: '',
  observacao: '',
};
const CHAVE_CLINICA = 'rh_admissao_clinica_aso';
/** Clínica usada da última vez (só conveniência deste navegador). */
function clinicaSalva(): Pick<Aso, 'clinica' | 'endereco' | 'telefone'> | null {
  try {
    const j = JSON.parse(localStorage.getItem(CHAVE_CLINICA) ?? 'null');
    return j && typeof j.clinica === 'string' ? j : null;
  } catch {
    return null;
  }
}
function guardarClinica(a: Aso) {
  try {
    localStorage.setItem(CHAVE_CLINICA, JSON.stringify({ clinica: a.clinica, endereco: a.endereco, telefone: a.telefone }));
  } catch {
    /* sem storage: tudo bem */
  }
}
/** Próxima segunda-feira depois de `ymd` (registro na segunda fecha a folha da semana). */
function proximaSegunda(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + (((8 - t.getUTCDay()) % 7) || 7));
  return t.toISOString().slice(0, 10);
}
const asoOk = (a: Aso) => a.clinica.trim().length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(a.data);

const MODELOS = [
  { v: 'experiencia', t: 'Experiência (CLT mensal)' },
  { v: 'intermitente', t: 'Intermitente (por hora)' },
  { v: 'indeterminado', t: 'Prazo indeterminado (CLT mensal)' },
] as const;

const STATUS: Record<string, { t: string; c: string }> = {
  enviado: { t: 'link enviado', c: 'bg-slate-100 text-slate-700' },
  aberto: { t: 'abriu o link', c: 'bg-amber-100 text-amber-800' },
  assinado: { t: 'assinado ✓', c: 'bg-emerald-100 text-emerald-800' },
  cancelado: { t: 'cancelado', c: 'bg-rose-50 text-rose-700' },
};

export function AdmissaoCliente({ filialId, filialNome, hoje, empregadores, empregadorPadrao, casas }: Props) {
  const [cpf, setCpf] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [c, setC] = useState<Consulta | null>(null);

  const [nome, setNome] = useState('');
  const [whats, setWhats] = useState('');
  const [whatsOk, setWhatsOk] = useState(false);

  const [modelo, setModelo] = useState<'experiencia' | 'intermitente' | 'indeterminado'>('experiencia');
  const [empregador, setEmpregador] = useState(empregadorPadrao);
  const [cargo, setCargo] = useState('');
  const [cbo, setCbo] = useState('');
  const [atividades, setAtividades] = useState('');
  const [valor, setValor] = useState('1670,00');
  const [jornada, setJornada] = useState('44 horas semanais, escala 6x1, com intervalo de 1 hora');
  const [admissao, setAdmissao] = useState(hoje);
  const [expDias, setExpDias] = useState('45');
  const [expProrrogacao, setExpProrrogacao] = useState('45');
  const [local, setLocal] = useState('');
  // Onde vai trabalhar (lotação/escala) — pode ser diferente de quem registra (ex.: E.B.).
  const [lotacao, setLotacao] = useState(filialId);
  const [jornadaId, setJornadaId] = useState('');
  const [jornadas, setJornadas] = useState<{ id: string; nome: string; tipo: string }[]>([]);
  const listaCasas = casas && casas.length ? casas : [{ id: filialId, nome: filialNome }];
  const nomeLotacao = listaCasas.find((x) => x.id === lotacao)?.nome ?? filialNome;

  // Pedido do exame admissional (ASO) — opcional, vai junto no link.
  const [pedirAso, setPedirAso] = useState(false);
  const [aso, setAso] = useState<Aso>(ASO_VAZIO);
  const [asoPara, setAsoPara] = useState<string | null>(null);
  const [asoRegistro, setAsoRegistro] = useState('');
  const [asoEnviando, setAsoEnviando] = useState(false);
  useEffect(() => {
    const c0 = clinicaSalva();
    if (c0) setAso((a) => ({ ...a, ...c0 }));
  }, []);
  const campoAso = (k: keyof Aso) => (e: { target: { value: string } }) => setAso((a) => ({ ...a, [k]: e.target.value }));

  const [enviando, setEnviando] = useState(false);
  const [gerado, setGerado] = useState<{ link: string; whatsapp: string } | null>(null);
  const [convites, setConvites] = useState<Convite[]>([]);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/rh/admissao?filialId=${filialId}`);
    if (r.ok) {
      const j = await r.json();
      setConvites(j.convites ?? []);
      if (Array.isArray(j.jornadas)) setJornadas(j.jornadas);
    }
  }, [filialId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (modelo === 'intermitente') {
      setValor((v) => (v === '1670,00' ? '9,00' : v));
      setJornada((j) => (j.startsWith('44 horas') ? 'Conforme convocação, com no mínimo 3 dias de antecedência' : j));
    } else {
      setValor((v) => (v === '9,00' ? '1670,00' : v));
      setJornada((j) => (j.startsWith('Conforme convocação') ? '44 horas semanais, escala 6x1, com intervalo de 1 hora' : j));
    }
  }, [modelo]);

  useEffect(() => {
    setLotacao(filialId);
  }, [filialId]);

  // Escala: intermitente → jornada intermitente da casa; fixo → o RH escolhe a folga (ou decide na escala do mês).
  const jornadasDoModelo = jornadas.filter((j) => (modelo === 'intermitente' ? j.tipo === 'intermitente' : j.tipo !== 'intermitente'));
  // 6x1: todo dia da semana pode ser a folga fixa. Dia sem escala cadastrada aparece como "nova" e é criada ao gerar o link.
  const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const semFolgaCadastrada =
    modelo === 'intermitente'
      ? []
      : DIAS_SEMANA.map((d, i) => ({ d, i })).filter(
          ({ d }) => !jornadasDoModelo.some((j) => j.nome.trim().toLowerCase() === `mensalista folga ${d}`.toLowerCase()),
        );
  const folgaNova = jornadaId.startsWith('novo:') ? Number(jornadaId.slice(5)) : undefined;
  const nomeEscala =
    folgaNova !== undefined ? `MENSALISTA Folga ${DIAS_SEMANA[folgaNova]}` : (jornadas.find((j) => j.id === jornadaId)?.nome ?? '');
  useEffect(() => {
    if (modelo === 'intermitente' || !nomeEscala) return;
    setJornada((j) => (j.startsWith('44 horas') ? `44 horas semanais, escala 6x1 (${nomeEscala.replace(/^MENSALISTA /i, '')}), com intervalo de 1 hora` : j));
  }, [modelo, nomeEscala]);
  useEffect(() => {
    setJornadaId((atual) => {
      if (jornadasDoModelo.some((j) => j.id === atual)) return atual;
      if (atual.startsWith('novo:') && modelo !== 'intermitente') return atual;
      if (modelo !== 'intermitente') return '';
      const tab = /tabu/i.test(nomeLotacao);
      const j =
        jornadasDoModelo.find((x) => (tab ? /tabu/i.test(x.nome) : /prainha/i.test(x.nome))) ?? jornadasDoModelo[0];
      return j?.id ?? '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, jornadas, nomeLotacao]);

  async function consultar(forcarSpc = false) {
    setErro(null);
    setGerado(null);
    setConsultando(true);
    try {
      const r = await fetch('/api/rh/admissao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'consultar', filialId, cpf, forcarSpc }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'falhou');
      const d = j as Consulta;
      setC(d);
      setNome(d.dados.nome ?? d.existente?.nome ?? '');
      setWhats(d.dados.celular ?? d.existente?.telefone ?? d.dados.telefone ?? '');
      setWhatsOk(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConsultando(false);
    }
  }

  async function criar() {
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch('/api/rh/admissao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          acao: 'criar',
          filialId: lotacao,
          cpf,
          nome,
          telefone: whats,
          dadosSpc: c?.dados ?? undefined,
          ...(folgaNova !== undefined ? { folgaNova } : {}),
          termos: {
            modelo,
            empregadorCnpj: empregador,
            admissao,
            cargo,
            cbo,
            atividades,
            valor,
            jornada,
            local,
            expDias,
            expProrrogacao,
            setor: '',
            ...(jornadaId && folgaNova === undefined ? { jornadaId } : {}),
            ...(pedirAso && asoOk(aso) ? { aso } : {}),
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'falhou');
      if (pedirAso && asoOk(aso)) guardarClinica(aso);
      setGerado({ link: j.link, whatsapp: j.whatsapp });
      window.open(j.whatsapp, '_blank');
      void carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar este link? A pessoa não vai mais conseguir abrir.')) return;
    const r = await fetch('/api/rh/admissao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'cancelar', id }),
    });
    if (!r.ok) alert((await r.json()).error ?? 'falhou');
    void carregar();
  }

  function abrirAso(v: Convite) {
    setAsoPara(asoPara === v.id ? null : v.id);
    setAsoRegistro(v.termos.admissao ?? '');
    if (v.termos.aso) setAso(v.termos.aso);
  }

  async function enviarAso(v: Convite) {
    setAsoEnviando(true);
    try {
      const r = await fetch('/api/rh/admissao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          acao: 'aso',
          id: v.id,
          aso,
          ...(v.status !== 'assinado' && asoRegistro ? { admissao: asoRegistro } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'falhou');
      guardarClinica(aso);
      window.open(j.whatsapp, '_blank');
      setAsoPara(null);
      void carregar();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAsoEnviando(false);
    }
  }

  const inpAso = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';
  const camposAso = (
    <>
      <label className="text-xs text-slate-600 sm:col-span-2">
        Clínica
        <input className={inpAso} value={aso.clinica} onChange={campoAso('clinica')} placeholder="Nome da clínica de medicina do trabalho" />
      </label>
      <label className="text-xs text-slate-600 sm:col-span-2">
        Endereço da clínica
        <input className={inpAso} value={aso.endereco} onChange={campoAso('endereco')} />
      </label>
      <label className="text-xs text-slate-600">
        Telefone da clínica
        <input className={inpAso} value={aso.telefone} onChange={campoAso('telefone')} />
      </label>
      <label className="text-xs text-slate-600">
        Dia de se apresentar
        <input type="date" className={inpAso} value={aso.data} onChange={campoAso('data')} />
      </label>
      <label className="text-xs text-slate-600">
        Horário (opcional)
        <input type="time" className={inpAso} value={aso.hora} onChange={campoAso('hora')} />
      </label>
      <label className="text-xs text-slate-600">
        Observação (opcional)
        <input className={inpAso} value={aso.observacao} onChange={campoAso('observacao')} placeholder="Ir em jejum, levar carteira de vacina…" />
      </label>
    </>
  );

  const cpfDig = cpf.replace(/\D/g, '');
  const pronto = !!c && nome.trim().length > 3 && whats.replace(/\D/g, '').length >= 10 && whatsOk && cargo.trim().length > 1 && !!valor && !!admissao && !!jornadaId;
  const inp = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">1. CPF da pessoa</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input
            className="w-48 rounded-md border border-slate-300 px-3 py-2 font-mono"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={mascaraCpf(cpf)}
            onChange={(e) => setCpf(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && cpfDig.length === 11 && consultar()}
          />
          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={cpfDig.length !== 11 || consultando}
            onClick={() => consultar()}
          >
            {consultando ? 'Consultando…' : '🔎 Buscar no SPC'}
          </button>
          {c && c.fonte !== 'spc' && c.spcDisponivel && (
            <button className="text-xs text-blue-700 underline" onClick={() => consultar(true)} disabled={consultando}>
              consultar o SPC de novo (pago)
            </button>
          )}
        </div>
        {erro && <p className="mt-2 text-sm text-rose-700">{erro}</p>}

        {c && (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-xs text-slate-500">
              Fonte: {c.fonte === 'spc' ? 'SPC Brasil (agora)' : c.fonte === 'spc-cache' ? 'SPC (consulta anterior)' : c.fonte === 'nada' ? 'nada encontrado' : 'nosso cadastro'}
              {c.erroSpc ? ` · SPC: ${c.erroSpc}` : ''}
            </p>
            <div className="grid gap-1 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
              <span>
                <b>Nascimento:</b> {fmtData(c.dados.dataNascimento)}
              </span>
              <span>
                <b>Mãe:</b> {c.dados.mae ?? '— (ela preenche)'}
              </span>
              <span>
                <b>Pai:</b> {c.dados.pai ?? '— (ela preenche, se tiver)'}
              </span>
              <span>
                <b>E-mail:</b> {c.dados.email ?? '—'}
              </span>
              <span>
                <b>Telefones:</b> {[c.dados.celular, c.dados.telefone].filter(Boolean).join(' · ') || '—'}
              </span>
              <span className="sm:col-span-2">
                <b>Endereço:</b>{' '}
                {[c.dados.endereco, c.dados.numero, c.dados.bairro, c.dados.cidade && `${c.dados.cidade}/${c.dados.uf ?? ''}`, c.dados.cep]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </span>
              <span className="text-xs text-slate-500 sm:col-span-2">O SPC não traz o nome do pai: a pessoa preenche no link.</span>
            </div>
            {c.existente && (
              <p className={`rounded-md p-2 text-xs ${c.existente.ativo ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-blue-900'}`}>
                Já tem cadastro: <b>{c.existente.nome}</b> — {c.existente.casa}, {c.existente.empresaRegistro ?? 'sem registro'},{' '}
                {c.existente.ativo ? 'ATIVO' : 'desligado'} (admissão {fmtData(c.existente.dataAdmissao)}
                {c.existente.dataDesligamento ? `, saída ${fmtData(c.existente.dataDesligamento)}` : ''}).{' '}
                {c.existente.ativo
                  ? 'Se for registrar por outra empresa, faça o desligamento antes.'
                  : 'Ao assinar, o mesmo cadastro é religado aqui (CPF é único).'}
              </p>
            )}
            {c.conviteAberto && (
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                Já existe um link em aberto pra esse CPF ({fmtHora(c.conviteAberto.criadoEm)}). Mandar outro cancela o anterior.
              </p>
            )}
          </div>
        )}
      </div>

      {c && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">2. Nome e WhatsApp</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Nome completo
              <input className={inp} value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">
              WhatsApp (DDD + número)
              <input
                className={inp}
                inputMode="tel"
                value={whats}
                onChange={(e) => {
                  setWhats(e.target.value);
                  setWhatsOk(false);
                }}
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={whatsOk} onChange={(e) => setWhatsOk(e.target.checked)} />
            Confirmei com a pessoa que esse é o WhatsApp dela
          </label>
        </div>
      )}

      {c && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">3. O combinado (vai no contrato)</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              1) Quem contrata (empresa que registra)
              <select className={inp} value={empregador} onChange={(e) => setEmpregador(e.target.value)}>
                {empregadores.map((e) => (
                  <option key={e.cnpj} value={e.cnpj}>
                    {e.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              2) Onde vai trabalhar
              <select className={inp} value={lotacao} onChange={(e) => setLotacao(e.target.value)}>
                {listaCasas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              3) Salário
              <select
                className={inp}
                value={modelo === 'intermitente' ? 'hora' : 'clt'}
                onChange={(e) => setModelo(e.target.value === 'hora' ? 'intermitente' : 'experiencia')}
              >
                <option value="clt">Mensal — CLT (salário fixo)</option>
                <option value="hora">Por hora — intermitente</option>
              </select>
            </label>
            {modelo === 'intermitente' ? (
              <div className="text-xs text-slate-600">
                Contrato
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">Intermitente (por convocação)</div>
              </div>
            ) : (
              <label className="text-xs text-slate-600">
                Contrato CLT
                <select className={inp} value={modelo} onChange={(e) => setModelo(e.target.value as typeof modelo)}>
                  {MODELOS.filter((m) => m.v !== 'intermitente').map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-xs text-slate-600 sm:col-span-2">
              4) Escala em que vai trabalhar (obrigatório)
              <select
                className={`${inp} ${jornadaId ? '' : 'border-amber-400 bg-amber-50'}`}
                value={jornadaId}
                onChange={(e) => setJornadaId(e.target.value)}
              >
                <option value="" disabled>
                  {modelo === 'intermitente' ? 'Escolha a escala intermitente…' : 'Escolha a folga fixa da semana (6x1)…'}
                </option>
                {jornadasDoModelo.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.nome}
                  </option>
                ))}
                {semFolgaCadastrada.map(({ d, i }) => (
                  <option key={`novo:${i}`} value={`novo:${i}`}>
                    MENSALISTA Folga {d} (6x1, 7h20/dia — nova, cadastra ao gerar o link)
                  </option>
                ))}
              </select>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                {modelo === 'intermitente'
                  ? 'Intermitente: trabalha por convocação e conta só as horas batidas no ponto.'
                  : '6x1 com a folga fixa escolhida; o domingo de folga roda na escala do mês pela regra (homem 1 a cada 5 — CCT; mulher a cada 2 — CLT 386). Assinou → já aparece na escala do mês da casa.'}
              </span>
            </label>
            <label className="text-xs text-slate-600">
              Cargo / função
              <input className={inp} value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Garçom, Cozinheiro…" />
            </label>
            <label className="text-xs text-slate-600">
              CBO (se souber)
              <input className={inp} value={cbo} onChange={(e) => setCbo(e.target.value)} placeholder="5134-05" />
            </label>
            <label className="text-xs text-slate-600">
              {modelo === 'intermitente' ? 'Valor da hora (R$)' : 'Salário mensal (R$)'}
              <input className={inp} value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
            </label>
            <label className="text-xs text-slate-600">
              Início (data do registro)
              <input type="date" className={inp} value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
              <button type="button" className="mt-1 text-xs text-blue-700 underline" onClick={() => setAdmissao(proximaSegunda(hoje))}>
                próxima segunda ({fmtData(proximaSegunda(hoje))})
              </button>
            </label>
            {modelo === 'experiencia' && (
              <>
                <label className="text-xs text-slate-600">
                  Dias de experiência
                  <input className={inp} value={expDias} onChange={(e) => setExpDias(e.target.value)} inputMode="numeric" />
                </label>
                <label className="text-xs text-slate-600">
                  Prorrogação (dias, total máx. 90)
                  <input className={inp} value={expProrrogacao} onChange={(e) => setExpProrrogacao(e.target.value)} inputMode="numeric" />
                </label>
              </>
            )}
            <label className="text-xs text-slate-600 sm:col-span-2">
              Jornada
              <input className={inp} value={jornada} onChange={(e) => setJornada(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">
              Atividades (opcional)
              <textarea className={inp} rows={2} value={atividades} onChange={(e) => setAtividades(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">
              Local de trabalho no contrato (vazio = endereço da casa escolhida)
              <input className={inp} value={local} onChange={(e) => setLocal(e.target.value)} placeholder={nomeLotacao} />
            </label>
          </div>
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" checked={pedirAso} onChange={(e) => setPedirAso(e.target.checked)} />
              🩺 Mandar junto o pedido do exame admissional (ASO)
            </label>
            {pedirAso && (
              <>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">{camposAso}</div>
                <p className="mt-2 text-xs text-slate-600">
                  No WhatsApp vai a clínica, o dia de se apresentar, a data do registro ({fmtData(admissao)}) e o link da guia pra mostrar na clínica.
                  {!asoOk(aso) && <span className="text-amber-700"> Falta a clínica e o dia — sem isso o link sai sem o pedido.</span>}
                </p>
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!pronto || enviando}
              onClick={criar}
            >
              {enviando ? 'Gerando…' : '📲 Gerar link e abrir o WhatsApp'}
            </button>
            {!whatsOk && <span className="text-xs text-slate-500">marque que confirmou o WhatsApp</span>}
            {!jornadaId && <span className="text-xs text-amber-700">escolha a escala antes de mandar</span>}
          </div>
          {gerado && (
            <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              Link criado. Se o WhatsApp não abriu,{' '}
              <a className="font-medium underline" href={gerado.whatsapp} target="_blank" rel="noreferrer">
                clique aqui
              </a>{' '}
              ou copie: <code className="break-all text-xs">{gerado.link}</code>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Links enviados — {filialNome}</h2>
        {convites.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum ainda.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-100">
            {convites.map((v) => {
              const st = v.vencido ? { t: 'venceu', c: 'bg-slate-100 text-slate-500' } : (STATUS[v.status] ?? STATUS.enviado);
              return (
                <div key={v.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${st.c}`}>{st.t}</span>
                  <b>{v.nome}</b>
                  <span className="text-xs text-slate-500">
                    {v.termos.cargo} · início {fmtData(v.termos.admissao ?? null)} · enviado {fmtHora(v.criadoEm)}
                    {v.assinadoEm ? ` · assinou ${fmtHora(v.assinadoEm)}` : v.docs ? ` · ${v.docs} doc(s) subidos` : ''}
                  </span>
                  <span className="ml-auto flex gap-3 text-xs">
                    {v.funcionarioId && v.status === 'assinado' && (
                      <a className="text-blue-700 underline" href={`/rh/funcionarios/${v.funcionarioId}`}>
                        ficha
                      </a>
                    )}
                    {v.assinaturaId && (
                      <a className="text-blue-700 underline" href={`/rh/assinatura/${v.assinaturaId}`}>
                        comprovante
                      </a>
                    )}
                    {v.guiaAso && (
                      <a className="text-blue-700 underline" href={v.guiaAso} target="_blank" rel="noreferrer">
                        guia ASO
                      </a>
                    )}
                    {v.status !== 'cancelado' && (
                      <button className="text-amber-700 underline" onClick={() => abrirAso(v)}>
                        🩺 {v.termos.aso ? 'reenviar ASO' : 'pedir ASO'}
                      </button>
                    )}
                    {(v.status === 'enviado' || v.status === 'aberto') && !v.vencido && (
                      <>
                        <button className="text-blue-700 underline" onClick={() => navigator.clipboard.writeText(v.link)}>
                          copiar link
                        </button>
                        <button className="text-rose-700 underline" onClick={() => cancelar(v.id)}>
                          cancelar
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {asoPara === v.id && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {camposAso}
                      {v.status !== 'assinado' && (
                        <label className="text-xs text-slate-600">
                          Data do registro
                          <input type="date" className={inp} value={asoRegistro} onChange={(e) => setAsoRegistro(e.target.value)} />
                          <button type="button" className="mt-1 text-xs text-blue-700 underline" onClick={() => setAsoRegistro(proximaSegunda(hoje))}>
                            próxima segunda ({fmtData(proximaSegunda(hoje))})
                          </button>
                        </label>
                      )}
                    </div>
                    <button
                      className="mt-3 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      disabled={!asoOk(aso) || asoEnviando}
                      onClick={() => enviarAso(v)}
                    >
                      {asoEnviando ? 'Salvando…' : '📲 Salvar e mandar no WhatsApp'}
                    </button>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
