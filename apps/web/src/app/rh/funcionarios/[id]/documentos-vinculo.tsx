'use client';

// Entrada e saída — documentos assinados + dar baixa (25/10/2026).
// Fica na ficha do funcionário. Cada tipo da lista tem "Subir arquivo";
// o arquivo vai direto pro bucket (endereço assinado) e a linha fica em
// funcionario_documento. "Dar baixa" usa o mesmo PATCH do botão Desligar da
// lista de funcionários (que continua igual), só que com data e motivo
// escolhidos aqui.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { hojeBr } from '@/lib/datas';
import {
  DOCS_ADMISSAO,
  DOCS_DESLIGAMENTO,
  MOTIVOS_SAIDA,
  TIPOS_DOC_RESCISAO,
  faltando,
  type MomentoDoc,
  type TipoDoc,
} from '@/lib/rh/documento-vinculo';

export interface DocVinculo {
  id: string;
  momento: string;
  tipo: string;
  descricao: string | null;
  arquivoNome: string | null;
  criadoEm: string;
  /** Conta a pagar da rescisão lançada a partir deste termo (26/10/2026). */
  contaPagarId?: string | null;
}

async function chamar(body: Record<string, unknown>) {
  const r = await fetch('/api/rh/documento', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
  return j as Record<string, unknown>;
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function DocumentosVinculo(props: {
  funcionarioId: string;
  ativo: boolean;
  carteira: boolean;
  dataDesligamento: string | null;
  docs: DocVinculo[];
  podeAdmissao: boolean;
  podeDesligar: boolean;
}) {
  const { funcionarioId, ativo, carteira, docs } = props;
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [abrirBaixa, setAbrirBaixa] = useState(false);
  const [dataBaixa, setDataBaixa] = useState(hojeBr());
  const [motivo, setMotivo] = useState(MOTIVOS_SAIDA[0]);
  const [detalhe, setDetalhe] = useState('');
  const [salvandoBaixa, setSalvandoBaixa] = useState(false);
  // Mostra a parte de saída quando a pessoa já saiu, quando já tem documento de
  // saída ou quando o usuário abriu o "Dar baixa".
  const temDocSaida = docs.some((d) => d.momento === 'desligamento');
  const mostraSaida = !ativo || temDocSaida || abrirBaixa;

  async function subir(momento: MomentoDoc, tipo: string, arquivo: File) {
    setErro(null);
    setEnviando(tipo);
    try {
      const p = await chamar({ acao: 'upload_url', funcionarioId, momento, nome: arquivo.name, tamanho: arquivo.size });
      const up = await createClient()
        .storage.from(String(p.bucket))
        .uploadToSignedUrl(String(p.path), String(p.token), arquivo, { contentType: arquivo.type || 'application/octet-stream' });
      if (up.error) throw new Error(`não consegui guardar o arquivo: ${up.error.message}`);
      await chamar({ acao: 'criar', funcionarioId, momento, tipo, arquivoPath: String(p.path), arquivoNome: arquivo.name });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(null);
    }
  }

  async function cancelar(id: string) {
    const m = window.prompt('Por que tirar esse arquivo? (ex.: arquivo errado)');
    if (!m || m.trim().length < 3) return;
    setErro(null);
    try {
      await chamar({ acao: 'cancelar', id, motivo: m.trim() });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function darBaixa() {
    const faltam = faltando('desligamento', carteira, new Set(docs.filter((d) => d.momento === 'desligamento').map((d) => d.tipo)));
    const aviso = faltam.length
      ? `\n\nAinda falta subir: ${faltam.map((t) => t.rotulo).join(', ')}. Dá pra subir depois.`
      : '';
    if (!window.confirm(`Dar baixa com saída em ${dataBaixa.split('-').reverse().join('/')} (${motivo})?${aviso}`)) return;
    setSalvandoBaixa(true);
    setErro(null);
    try {
      const r = await fetch(`/api/rh/funcionario/${funcionarioId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ativo: false,
          dataDesligamento: dataBaixa,
          motivoDesligamento: detalhe.trim() ? `${motivo} — ${detalhe.trim()}` : motivo,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
      setAbrirBaixa(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoBaixa(false);
    }
  }

  return (
    <div className="space-y-6">
      {erro && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      <Lista
        titulo="Entrada (admissão)"
        momento="admissao"
        tipos={DOCS_ADMISSAO}
        carteira={carteira}
        docs={docs.filter((d) => d.momento === 'admissao')}
        pode={props.podeAdmissao}
        enviando={enviando}
        onSubir={subir}
        onCancelar={cancelar}
      />

      {mostraSaida && (
        <Lista
          titulo="Saída (desligamento)"
          momento="desligamento"
          tipos={DOCS_DESLIGAMENTO}
          carteira={carteira}
          docs={docs.filter((d) => d.momento === 'desligamento')}
          pode={props.podeDesligar}
          enviando={enviando}
          onSubir={subir}
          onCancelar={cancelar}
        />
      )}

      {ativo && props.podeDesligar && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          {!abrirBaixa ? (
            <button
              type="button"
              onClick={() => setAbrirBaixa(true)}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Dar baixa (desligar)…
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Dar baixa</p>
              <p className="text-xs text-slate-600">
                Suba os documentos de saída acima (pode ser antes ou depois). A pessoa sai das escalas e do ponto a partir
                da data de saída.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-600">
                  Último dia / data da saída
                  <input
                    type="date"
                    value={dataBaixa}
                    max={hojeBr()}
                    onChange={(e) => setDataBaixa(e.target.value)}
                    className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  Motivo
                  <select
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    {MOTIVOS_SAIDA.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[200px] flex-1 text-xs text-slate-600">
                  Observação (opcional)
                  <input
                    value={detalhe}
                    onChange={(e) => setDetalhe(e.target.value)}
                    maxLength={200}
                    placeholder="ex.: não voltou depois de 12/10"
                    className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={salvandoBaixa || !dataBaixa}
                  onClick={darBaixa}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {salvandoBaixa ? 'Salvando…' : 'Confirmar baixa'}
                </button>
                <button
                  type="button"
                  onClick={() => setAbrirBaixa(false)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Lista(props: {
  titulo: string;
  momento: MomentoDoc;
  tipos: TipoDoc[];
  carteira: boolean;
  docs: DocVinculo[];
  pode: boolean;
  enviando: string | null;
  onSubir: (m: MomentoDoc, tipo: string, f: File) => void;
  onCancelar: (id: string) => void;
}) {
  const { momento, tipos, carteira, docs } = props;
  const comArquivo = new Set(docs.map((d) => d.tipo));
  const faltam = faltando(momento, carteira, comArquivo);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{props.titulo}</h3>
        {faltam.length === 0 ? (
          <span className="text-xs font-medium text-emerald-700">✓ obrigatórios completos</span>
        ) : (
          <span className="text-xs font-medium text-amber-700">
            falta {faltam.length} obrigatório{faltam.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {tipos.map((t) => {
          const obrig = carteira ? t.clt : t.semCarteira;
          const meus = docs.filter((d) => d.tipo === t.tipo);
          return (
            <LinhaTipo
              key={t.tipo}
              tipo={t}
              obrigatorio={obrig}
              arquivos={meus}
              pode={props.pode}
              enviando={props.enviando === t.tipo}
              onSubir={(f) => props.onSubir(momento, t.tipo, f)}
              onCancelar={props.onCancelar}
            />
          );
        })}
      </ul>
      <p className="mt-1 text-[11px] text-slate-500">
        {carteira ? 'Obrigatórios pra quem tem carteira assinada.' : 'Obrigatórios pra quem trabalha sem carteira (diária/chamado).'}{' '}
        Foto do celular ou PDF, até 25 MB.
      </p>
    </div>
  );
}

function LinhaTipo(props: {
  tipo: TipoDoc;
  obrigatorio: boolean;
  arquivos: DocVinculo[];
  pode: boolean;
  enviando: boolean;
  onSubir: (f: File) => void;
  onCancelar: (id: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { tipo, arquivos } = props;
  const ok = arquivos.length > 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-800">
          <span className={ok ? 'text-emerald-600' : props.obrigatorio ? 'text-amber-600' : 'text-slate-300'}>
            {ok ? '✓' : props.obrigatorio ? '●' : '○'}
          </span>{' '}
          {tipo.rotulo}
          {props.obrigatorio && !ok && <span className="ml-1 text-[11px] text-amber-700">obrigatório</span>}
          {tipo.dica && <span className="ml-1 text-[11px] text-slate-400">({tipo.dica})</span>}
        </p>
        {arquivos.map((a) => (
          <p key={a.id} className="ml-4 text-xs text-slate-500">
            <a href={`/api/rh/documento?id=${a.id}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
              {a.arquivoNome ?? 'arquivo'}
            </a>{' '}
            · {dataCurta(a.criadoEm)}
            {props.pode && (
              <button type="button" onClick={() => props.onCancelar(a.id)} className="ml-2 text-red-600 hover:underline">
                tirar
              </button>
            )}
            {TIPOS_DOC_RESCISAO.includes(tipo.tipo) &&
              (a.contaPagarId ? (
                <a href={`/financeiro/conta/${a.contaPagarId}`} className="ml-2 text-emerald-700 hover:underline">
                  ✓ conta a pagar lançada
                </a>
              ) : (
                props.pode && <LancarRescisao documentoId={a.id} />
              ))}
          </p>
        ))}
      </div>
      {props.pode && (
        <>
          <input
            ref={ref}
            type="file"
            accept="image/*,application/pdf,.heic,.heif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) props.onSubir(f);
            }}
          />
          <button
            type="button"
            disabled={props.enviando}
            onClick={() => ref.current?.click()}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {props.enviando ? 'Enviando…' : ok ? '+ outro arquivo' : 'Subir arquivo'}
          </button>
        </>
      )}
    </li>
  );
}

// Lê o termo de rescisão pela IA e lança a conta a pagar (lib/rh/rescisao.ts).
function LancarRescisao({ documentoId }: { documentoId: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'fechado' | 'lendo' | 'form' | 'salvando'>('fechado');
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [valor, setValor] = useState('');
  const [venc, setVenc] = useState('');
  const [desc, setDesc] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/rh/rescisao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
    return j;
  }

  async function ler() {
    setErro(null);
    setEstado('lendo');
    try {
      const j = await post({ acao: 'ler', documentoId });
      setValor(j.proposta.valor != null ? String(j.proposta.valor.toFixed(2)).replace('.', ',') : '');
      setVenc(j.proposta.vencimento ?? '');
      setDesc(j.proposta.descricao ?? '');
      setAvisos(j.avisos ?? []);
      const l = j.lida ?? {};
      const partes = [
        l.causa,
        l.dataAfastamento ? `afastamento ${String(l.dataAfastamento).split('-').reverse().join('/')}` : null,
        l.bruto != null ? `bruto R$ ${Number(l.bruto).toFixed(2).replace('.', ',')}` : null,
        l.descontos != null ? `descontos R$ ${Number(l.descontos).toFixed(2).replace('.', ',')}` : null,
      ].filter(Boolean);
      setInfo(partes.length ? partes.join(' · ') : null);
      setEstado('form');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEstado('fechado');
    }
  }

  async function lancar() {
    const v = Number(valor.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return setErro('valor inválido');
    if (!venc) return setErro('falta o vencimento');
    setErro(null);
    setEstado('salvando');
    try {
      await post({ acao: 'lancar', documentoId, valor: v, vencimento: venc, descricao: desc.trim() || undefined });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEstado('form');
    }
  }

  if (estado === 'fechado' || estado === 'lendo') {
    return (
      <>
        <button
          type="button"
          disabled={estado === 'lendo'}
          onClick={ler}
          className="ml-2 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
        >
          {estado === 'lendo' ? 'Lendo o termo…' : '💰 Lançar pagamento da rescisão'}
        </button>
        {erro && <span className="ml-2 text-red-600">{erro}</span>}
      </>
    );
  }

  return (
    <span className="mt-2 block rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-slate-700">
      <span className="block text-xs font-semibold text-slate-900">Conta a pagar da rescisão</span>
      {info && <span className="mt-0.5 block text-[11px] text-slate-600">Lido do termo: {info}</span>}
      {avisos.map((a) => (
        <span key={a} className="mt-0.5 block text-[11px] text-amber-700">⚠ {a}</span>
      ))}
      <span className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-600">
          Líquido (R$)
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            className="mt-0.5 block w-28 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-[11px] text-slate-600">
          Vencimento
          <input
            type="date"
            value={venc}
            onChange={(e) => setVenc(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="min-w-[180px] flex-1 text-[11px] text-slate-600">
          Descrição
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={200}
            className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </span>
      <span className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={estado === 'salvando'}
          onClick={lancar}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {estado === 'salvando' ? 'Lançando…' : 'Lançar no contas a pagar'}
        </button>
        <button
          type="button"
          onClick={() => setEstado('fechado')}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
        >
          Cancelar
        </button>
      </span>
      {erro && <span className="mt-1 block text-xs text-red-600">{erro}</span>}
      <span className="mt-1 block text-[10px] text-slate-500">
        Vai pra casa da lotação, categoria Rescisão Contratual, em nome do funcionário.
      </span>
    </span>
  );
}
