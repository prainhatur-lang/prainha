'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hojeBr } from '@/lib/datas';

interface Funcionario {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  endereco: string | null;
  cargo: string | null;
  setor: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  ativo: boolean;
  regimeSalarial: string | null;
  salarioBase: string | null;
  precisaRevisao: boolean;
  observacao: string | null;
  temFornecedor: boolean;
  /** Já marcado como cliente (consome/faz fiado na casa). */
  temCliente: boolean;
  /** Vínculo de pagamento da folha (fornecedor_folha + PIX do fornecedor). */
  pagamento: {
    papel: string;
    gerenteModelo: string | null;
    gerenteValorFixoDia: string | null;
    diaristaModelo: string;
    diaristaTaxaHoraOverride: string | null;
    diaristaValorFixoDia: string | null;
    bonusFixoSemanal: string | null;
    bonusPorDia: string | null;
    chavePix: string | null;
    bancoNome: string | null;
    bancoAgencia: string | null;
    bancoConta: string | null;
  } | null;
  temColaborador: boolean;
  temUsuarioOperacao: boolean;
  /** Filiais ADICIONAIS onde também bate ponto (quem circula entre lojas). */
  filiaisExtras: string[];
}

interface Props {
  filialId: string;
  funcionarios: Funcionario[];
  cargos: string[];
  /** Demais filiais do usuário, pra marcar "também trabalha em". */
  outrasFiliais: { id: string; nome: string }[];
}

const SETORES = ['SALAO', 'COZINHA', 'PRODUCAO', 'ADM', 'BAR', 'LIMPEZA', 'SEGURANCA', 'LOGISTICA'];
// Só sugere o texto (motivoDesligamento continua varchar livre) — não muda
// schema nem quebra o que já está cadastrado. Alimenta a quebra por motivo
// do relatório de turnover.
const MOTIVOS_DESLIGAMENTO = [
  'Pedido de demissão',
  'Dispensa sem justa causa',
  'Dispensa com justa causa',
  'Fim de contrato',
  'Acordo entre as partes',
];

function fmtCpf(cpf: string | null): string {
  if (!cpf) return '—';
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function FuncionariosManager({ filialId, funcionarios, cargos, outrasFiliais }: Props) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const ativos = funcionarios.filter((f) => f.ativo);
  const desligados = funcionarios.filter((f) => !f.ativo);

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-md border p-3 text-sm ${
            msg.tipo === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">Ativos ({ativos.length})</h2>
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            ➕ Novo funcionário
          </button>
        </header>

        {criando && (
          <FuncionarioForm
            filialId={filialId}
            cargos={cargos}
            outrasFiliais={outrasFiliais}
            onCancel={() => setCriando(false)}
            onSaved={(texto) => {
              setCriando(false);
              setMsg({ tipo: 'ok', texto });
              router.refresh();
            }}
            onError={(texto) => setMsg({ tipo: 'erro', texto })}
          />
        )}

        {ativos.length === 0 && !criando ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nenhum funcionário ativo ainda. Clique em &quot;Novo funcionário&quot;.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Nome</th>
                  <th className="px-4 py-2 text-left">CPF</th>
                  <th className="px-4 py-2 text-left">Cargo</th>
                  <th className="px-4 py-2 text-left">Setor</th>
                  <th className="px-4 py-2 text-left">Admissão</th>
                  <th className="px-4 py-2 text-left">Vínculos</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ativos.map((f) => (
                  <FuncionarioRow
                    key={f.id}
                    f={f}
                    cargos={cargos}
                    outrasFiliais={outrasFiliais}
                    editando={editando === f.id}
                    onEditar={() => setEditando(editando === f.id ? null : f.id)}
                    onSaved={(texto) => {
                      setEditando(null);
                      setMsg({ tipo: 'ok', texto });
                      router.refresh();
                    }}
                    onError={(texto) => setMsg({ tipo: 'erro', texto })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {desligados.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-600">
            Desligados ({desligados.length})
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-200">
            {desligados.map((f) => (
              <li key={f.id} className="px-5 py-2 text-sm text-slate-500">
                {f.nome} — desligado em {fmtData(f.dataDesligamento)}
                {f.observacao ? ` · ${f.observacao}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function VinculoBadges({ f }: { f: Funcionario }) {
  return (
    <div className="flex flex-wrap gap-1">
      {f.temFornecedor && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
          Folha
        </span>
      )}
      {f.temColaborador && (
        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700 ring-1 ring-orange-200">
          Cozinha
        </span>
      )}
      {f.temUsuarioOperacao && (
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">
          Login PDV
        </span>
      )}
      {f.filiaisExtras.length > 0 && (
        <span
          className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200"
          title="Também bate ponto em outra(s) loja(s)"
        >
          🔁 +{f.filiaisExtras.length} loja{f.filiaisExtras.length > 1 ? 's' : ''}
        </span>
      )}
      {f.precisaRevisao && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
          ⚠ Revisar
        </span>
      )}
    </div>
  );
}

function FuncionarioRow({
  f,
  cargos,
  outrasFiliais,
  editando,
  onEditar,
  onSaved,
  onError,
}: {
  f: Funcionario;
  cargos: string[];
  outrasFiliais: { id: string; nome: string }[];
  editando: boolean;
  onEditar: () => void;
  onSaved: (texto: string) => void;
  onError: (texto: string) => void;
}) {
  return (
    <>
      <tr className={`hover:bg-slate-50 ${f.precisaRevisao ? 'bg-amber-50/50' : ''}`}>
        <td className="px-4 py-2 font-medium text-slate-900">{f.nome}</td>
        <td className="px-4 py-2 text-slate-600">{fmtCpf(f.cpf)}</td>
        <td className="px-4 py-2 text-slate-600">{f.cargo ?? '—'}</td>
        <td className="px-4 py-2 text-slate-600">{f.setor ?? '—'}</td>
        <td className="px-4 py-2 text-slate-600">{fmtData(f.dataAdmissao)}</td>
        <td className="px-4 py-2">
          <VinculoBadges f={f} />
        </td>
        <td className="px-4 py-2 text-right">
          <button
            type="button"
            onClick={onEditar}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {editando ? 'Fechar' : 'Editar'}
          </button>
        </td>
      </tr>
      {editando && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-4">
            <FuncionarioForm
              filialId=""
              funcionario={f}
              cargos={cargos}
              outrasFiliais={outrasFiliais}
              onCancel={onEditar}
              onSaved={onSaved}
              onError={onError}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function FuncionarioForm({
  filialId,
  funcionario,
  cargos,
  outrasFiliais,
  onCancel,
  onSaved,
  onError,
}: {
  filialId: string;
  funcionario?: Funcionario;
  cargos: string[];
  outrasFiliais: { id: string; nome: string }[];
  onCancel: () => void;
  onSaved: (texto: string) => void;
  onError: (texto: string) => void;
}) {
  const editar = !!funcionario;
  const [nome, setNome] = useState(funcionario?.nome ?? '');
  const [cpf, setCpf] = useState(funcionario?.cpf ?? '');
  const [telefone, setTelefone] = useState(funcionario?.telefone ?? '');
  const [endereco, setEndereco] = useState(funcionario?.endereco ?? '');
  const [cargo, setCargo] = useState(funcionario?.cargo ?? '');
  const [setor, setSetor] = useState(funcionario?.setor ?? '');
  const [dataAdmissao, setDataAdmissao] = useState(funcionario?.dataAdmissao ?? '');
  const [regimeSalarial, setRegimeSalarial] = useState(funcionario?.regimeSalarial ?? '');
  const [salarioBase, setSalarioBase] = useState(funcionario?.salarioBase ?? '');
  const [filiaisExtras, setFiliaisExtras] = useState<string[]>(funcionario?.filiaisExtras ?? []);
  // --- Pagamento (folha) — unificado no cadastro ---
  const pg = funcionario?.pagamento ?? null;
  const [papel, setPapel] = useState(pg?.papel ?? '');
  const [diaristaModelo, setDiaristaModelo] = useState(pg?.diaristaModelo ?? 'por_hora');
  const [diaristaTaxaHora, setDiaristaTaxaHora] = useState(pg?.diaristaTaxaHoraOverride ?? '');
  const [diaristaValorDia, setDiaristaValorDia] = useState(pg?.diaristaValorFixoDia ?? '');
  const [gerenteModelo, setGerenteModelo] = useState(pg?.gerenteModelo ?? '1pp_dos_10pct');
  const [gerenteValorDia, setGerenteValorDia] = useState(pg?.gerenteValorFixoDia ?? '');
  const [bonusSemanal, setBonusSemanal] = useState(pg?.bonusFixoSemanal ?? '');
  const [bonusDia, setBonusDia] = useState(pg?.bonusPorDia ?? '');
  const [chavePix, setChavePix] = useState(pg?.chavePix ?? '');
  const [bancoNome, setBancoNome] = useState(pg?.bancoNome ?? '');
  const [bancoAgencia, setBancoAgencia] = useState(pg?.bancoAgencia ?? '');
  const [bancoConta, setBancoConta] = useState(pg?.bancoConta ?? '');
  // como a pessoa recebe: PIX ou depósito em conta (o cadastro já diz qual é)
  // Papel de CLIENTE é escolha, não consequência: "cadastrar um vendedor não
  // quer dizer que ele SEJA cliente" (dono). Já vinculado = marcado e travado.
  const [tambemCliente, setTambemCliente] = useState(funcionario?.temCliente ?? false);
  const [formaPagamento, setFormaPagamento] = useState<'pix' | 'banco'>(
    pg?.bancoNome || pg?.bancoConta ? 'banco' : 'pix',
  );
  const [desligando, setDesligando] = useState(false);
  const [motivoDesligamento, setMotivoDesligamento] = useState('');
  const [salvando, setSalvando] = useState(false);

  function toggleFilialExtra(id: string) {
    setFiliaisExtras((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar() {
    const cpfDigits = cpf.replace(/\D/g, '');
    if (cpfDigits && cpfDigits.length !== 11) {
      onError('CPF precisa ter 11 dígitos (ou deixe em branco).');
      return;
    }
    setSalvando(true);
    try {
      const body = {
        nome: nome.trim(),
        cpf: cpfDigits || null,
        telefone: telefone.trim() || null,
        endereco: endereco.trim() || null,
        cargo: cargo || null,
        setor: setor || null,
        dataAdmissao: dataAdmissao || null,
        regimeSalarial: regimeSalarial || null,
        salarioBase: regimeSalarial ? salarioBase || null : null,
        ...(editar ? { precisaRevisao: false, filiaisExtras } : { tambemCliente }),
      };
      const res = await fetch(editar ? `/api/rh/funcionario/${funcionario.id}` : '/api/rh/funcionario', {
        method: editar ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editar ? body : { ...body, filialId }),
      });
      const json = await res.json();
      if (!res.ok) {
        onError(json.error ?? 'Erro ao salvar');
        return;
      }
      // Pagamento (folha): cria/atualiza o vínculo — o backend cria o
      // fornecedor sozinho se a pessoa ainda não tiver.
      if (papel) {
        const idFunc = editar ? funcionario.id : json.funcionario?.id;
        if (idFunc) {
          const num = (t: string) => {
            const v = Number(String(t).replace(/\./g, '').replace(',', '.'));
            return Number.isFinite(v) && v > 0 ? v : null;
          };
          const rp = await fetch(`/api/rh/funcionario/${idFunc}/pagamento`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              papel,
              gerenteModelo: papel === 'gerente' ? gerenteModelo : null,
              gerenteValorFixoDia:
                papel === 'gerente' && gerenteModelo === 'fixo_por_dia' ? num(gerenteValorDia) : null,
              diaristaModelo: papel === 'diarista' ? diaristaModelo : 'por_hora',
              diaristaTaxaHoraOverride:
                papel === 'diarista' && diaristaModelo === 'por_hora' ? num(diaristaTaxaHora) : null,
              diaristaValorFixoDia:
                papel === 'diarista' && diaristaModelo === 'fixo_por_dia' ? num(diaristaValorDia) : null,
              bonusFixoSemanal: num(bonusSemanal),
              bonusPorDia: num(bonusDia),
              tambemCliente,
              formaPagamento,
              chavePix: formaPagamento === 'pix' ? chavePix.trim() || null : null,
              bancoNome: formaPagamento === 'banco' ? bancoNome.trim() || null : null,
              bancoAgencia: formaPagamento === 'banco' ? bancoAgencia.trim() || null : null,
              bancoConta: formaPagamento === 'banco' ? bancoConta.trim() || null : null,
            }),
          });
          if (!rp.ok) {
            const jp = await rp.json().catch(() => ({}));
            onError(`Cadastro salvo, mas o pagamento falhou: ${jp.error ?? rp.status}`);
            return;
          }
        }
      }
      onSaved(editar ? `${nome} atualizado.` : `${nome} cadastrado.`);
    } finally {
      setSalvando(false);
    }
  }

  async function desligar() {
    if (!motivoDesligamento.trim()) {
      onError('Informe o motivo do desligamento.');
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch(`/api/rh/funcionario/${funcionario!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ativo: false,
          dataDesligamento: hojeBr(),
          motivoDesligamento: motivoDesligamento.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onError(json.error ?? 'Erro ao desligar');
        return;
      }
      onSaved(`${nome} desligado.`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-500">
          Nome
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          CPF
          <input
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="só números"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Telefone
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500">
          Cargo
          <select
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {cargos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Setor
          <select
            value={setor}
            onChange={(e) => setSetor(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {SETORES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Admissão
          <input
            type="date"
            value={dataAdmissao}
            onChange={(e) => setDataAdmissao(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="col-span-2 text-xs text-slate-500 sm:col-span-3">
          Endereço
          <input
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {/* PAGAMENTO — as DUAS trilhas que convivem na casa (a mesma pessoa
          pode ter as duas): registro CLT (salário/horas, pago pela empresa
          de folha) e folha SEMANAL (diárias + rateio do 10% + bônus). */}
      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
        <p className="text-xs font-semibold text-emerald-800">💰 Pagamento</p>

        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          📋 Registro (CLT) — salário e horas trabalhadas
        </p>
        <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-500">
            Regime
            <select
              value={regimeSalarial}
              onChange={(e) => setRegimeSalarial(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Sem registro (freela / só folha semanal)</option>
              <option value="clt_mensal">CLT mensal (salário fixo)</option>
              <option value="intermitente_hora">Intermitente (paga por hora do ponto)</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            {regimeSalarial === 'intermitente_hora' ? 'Valor da hora (R$)' : 'Salário (R$/mês)'}
            <input
              type="number"
              step="0.01"
              min="0"
              value={salarioBase}
              onChange={(e) => setSalarioBase(e.target.value)}
              disabled={!regimeSalarial}
              placeholder={regimeSalarial ? '0,00' : '—'}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />
          </label>
          <p className="self-end pb-1 text-[10px] leading-4 text-slate-400">
            Pago pela empresa de folha registrada; o intermitente usa as horas batidas no
            ponto. Entra como custo no fechamento.
          </p>
        </div>

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          📅 Folha semanal — diárias e rateio do 10%
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-500">
            Como recebe
            <select
              value={papel}
              onChange={(e) => setPapel(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— fora da folha semanal —</option>
              <option value="funcionario">Funcionário (rateio do 10%)</option>
              <option value="diarista">Diarista / Freela</option>
              <option value="gerente">Gerente</option>
            </select>
          </label>

          {papel === 'diarista' && (
            <>
              <label className="text-xs text-slate-500">
                Modelo da diária
                <select
                  value={diaristaModelo}
                  onChange={(e) => setDiaristaModelo(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="por_hora">Por hora trabalhada</option>
                  <option value="fixo_por_dia">Valor fixo por dia</option>
                </select>
              </label>
              {diaristaModelo === 'por_hora' ? (
                <label className="text-xs text-slate-500">
                  R$/hora (vazio = padrão da filial)
                  <input
                    value={diaristaTaxaHora}
                    onChange={(e) => setDiaristaTaxaHora(e.target.value)}
                    inputMode="decimal"
                    placeholder="ex: 10,00"
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  />
                </label>
              ) : (
                <label className="text-xs text-slate-500">
                  R$ por dia trabalhado
                  <input
                    value={diaristaValorDia}
                    onChange={(e) => setDiaristaValorDia(e.target.value)}
                    inputMode="decimal"
                    placeholder="ex: 150,00"
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  />
                </label>
              )}
            </>
          )}

          {papel === 'gerente' && (
            <>
              <label className="text-xs text-slate-500">
                Modelo do gerente
                <select
                  value={gerenteModelo}
                  onChange={(e) => setGerenteModelo(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="1pp_dos_10pct">1 ponto do 10%</option>
                  <option value="fixo_por_dia">Valor fixo por dia</option>
                </select>
              </label>
              {gerenteModelo === 'fixo_por_dia' && (
                <label className="text-xs text-slate-500">
                  R$ por dia trabalhado
                  <input
                    value={gerenteValorDia}
                    onChange={(e) => setGerenteValorDia(e.target.value)}
                    inputMode="decimal"
                    placeholder="ex: 200,00"
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  />
                </label>
              )}
            </>
          )}

          {papel && (
            <>
              <label className="text-xs text-slate-500">
                Bônus fixo semanal (R$)
                <input
                  value={bonusSemanal}
                  onChange={(e) => setBonusSemanal(e.target.value)}
                  inputMode="decimal"
                  placeholder="opcional"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                />
              </label>
              <label className="text-xs text-slate-500">
                Bônus por dia trabalhado (R$)
                <input
                  value={bonusDia}
                  onChange={(e) => setBonusDia(e.target.value)}
                  inputMode="decimal"
                  placeholder="opcional"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                />
              </label>
              <label className="text-xs text-slate-500">
                Como pagar
                <select
                  value={formaPagamento}
                  onChange={(e) => setFormaPagamento(e.target.value as 'pix' | 'banco')}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="pix">PIX</option>
                  <option value="banco">Depósito em conta</option>
                </select>
              </label>
              {formaPagamento === 'pix' ? (
                <label className="text-xs text-slate-500">
                  Chave PIX
                  <input
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                    placeholder="CPF, celular, e-mail..."
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              ) : (
                <>
                  <label className="text-xs text-slate-500">
                    Banco
                    <input
                      value={bancoNome}
                      onChange={(e) => setBancoNome(e.target.value)}
                      placeholder="ex: Itaú, Caixa, Nubank"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    Agência
                    <input
                      value={bancoAgencia}
                      onChange={(e) => setBancoAgencia(e.target.value)}
                      placeholder="0000"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    Conta (com dígito)
                    <input
                      value={bancoConta}
                      onChange={(e) => setBancoConta(e.target.value)}
                      placeholder="00000-0"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
                    />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <label className="mt-3 flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={tambemCliente}
            disabled={funcionario?.temCliente}
            onChange={(e) => setTambemCliente(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <b>Também é cliente</b> — consome na casa / faz fiado.
            <span className="block text-[11px] text-slate-500">
              {funcionario?.temCliente
                ? 'Já cadastrado como cliente — o fiado dele aparece na folha e é descontado.'
                : 'Marque só se essa pessoa consome aqui. O cadastro é o mesmo — não duplica quem já é cliente.'}
            </span>
          </span>
        </label>

        {!papel && (
          <p className="mt-2 text-[11px] text-slate-500">
            Escolha como a pessoa recebe pra entrar na folha semanal — FREELA entra aqui como Diarista, com o valor por hora ou por dia. Quem é só CLT pela
            terceirizada fica em &quot;fora da folha&quot; (o salário do bloco acima é indicador de custo).
          </p>
        )}
      </div>

      {editar && outrasFiliais.length > 0 && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">
            🔁 Também bate ponto em outra loja (quem circula entre lojas)
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {outrasFiliais.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={filiaisExtras.includes(f.id)}
                  onChange={() => toggleFilialExtra(f.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {f.nome}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={salvando || !nome.trim()}
            onClick={salvar}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
        {editar && !desligando && (
          <button
            type="button"
            onClick={() => setDesligando(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
          >
            Desligar
          </button>
        )}
      </div>

      {desligando && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3">
          <label className="text-xs text-rose-700">
            Motivo (sugestão — ajuda o relatório de turnover a agrupar)
            <select
              value=""
              onChange={(e) => e.target.value && setMotivoDesligamento(e.target.value)}
              className="mt-1 w-full rounded-md border border-rose-300 px-2 py-1.5 text-sm"
            >
              <option value="">Escolher um motivo comum…</option>
              {MOTIVOS_DESLIGAMENTO.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-xs text-rose-700">
            Motivo do desligamento
            <input
              value={motivoDesligamento}
              onChange={(e) => setMotivoDesligamento(e.target.value)}
              className="mt-1 w-full rounded-md border border-rose-300 px-2 py-1.5 text-sm"
              placeholder="ex: pedido de demissão, dispensa sem justa causa…"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={salvando}
              onClick={desligar}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
            >
              Confirmar desligamento
            </button>
            <button
              type="button"
              onClick={() => setDesligando(false)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
