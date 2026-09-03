'use client';

import { useState } from 'react';

export interface FilialCred {
  id: string;
  nome: string;
  /** Cielo: já tem credencial própria cadastrada. */
  propria: boolean;
  /** chave → pista ("1001…7289"). O segredo nunca vem pro navegador. */
  pistas: Record<string, string | null>;
  /** Rede (e.Rede): idem. */
  propriaRede: boolean;
  pistasRede: Record<string, string | null>;
  /** Por qual adquirente esta casa cobra ONLINE hoje. */
  adquirenteOnline: 'cielo' | 'rede';
}

type Campo = { chave: string; rotulo: string; ajuda: string; segredo?: boolean };

/** As 7 chaves da Cielo, com o rótulo que a pessoa vê na tela. */
const CAMPOS_CIELO: Campo[] = [
  { chave: 'merchantId', rotulo: 'Merchant ID', ajuda: 'Identificação da loja na Cielo e-commerce' },
  { chave: 'merchantKey', rotulo: 'Merchant Key', ajuda: 'Chave secreta da loja', segredo: true },
  { chave: 'mpiClientId', rotulo: '3DS · Client ID', ajuda: 'Braspag MPI, pra autenticar o cartão' },
  { chave: 'mpiClientSecret', rotulo: '3DS · Client Secret', ajuda: 'Braspag MPI', segredo: true },
  { chave: 'establishmentCode', rotulo: '3DS · Establishment Code', ajuda: 'Em branco = usa o Merchant ID' },
  { chave: 'merchantName', rotulo: 'Nome na fatura', ajuda: 'Como aparece na fatura do cliente' },
  { chave: 'mcc', rotulo: 'MCC', ajuda: 'Ramo do estabelecimento. Restaurante = 5812' },
];

/** As chaves do e.Rede (Portal Use Rede → e-commerce → chave de integração). */
const CAMPOS_REDE: Campo[] = [
  { chave: 'pv', rotulo: 'PV (nº de filiação)', ajuda: 'Número do estabelecimento na Rede — vira o clientId' },
  { chave: 'chaveIntegracao', rotulo: 'Chave de Integração', ajuda: 'Gerada no Portal Use Rede pelo usuário master', segredo: true },
  { chave: 'softDescriptor', rotulo: 'Nome na fatura', ajuda: 'Até 18 letras, sem acento. Ex.: PRAINHA BAR' },
];

const inp =
  'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20';

export function PagamentoClient({
  filiais,
  podeEditar,
  segredoOk,
}: {
  filiais: FilialCred[];
  podeEditar: boolean;
  segredoOk: boolean;
}) {
  return (
    <div className="mt-6 space-y-6">
      {!segredoOk && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>CREDENCIAL_SECRET não está configurada no servidor.</b> É a chave que cifra as
          credenciais no banco — sem ela o Concilia se recusa a guardar. Cadastre a variável
          (mínimo 16 caracteres) na Vercel e faça um redeploy.
        </div>
      )}
      {filiais.map((f) => (
        <div key={f.id} className="space-y-3">
          <SeletorOnline filial={f} podeEditar={podeEditar} />
          <CardCredencial
            filial={f}
            provedor="cielo"
            titulo="Cielo e-commerce"
            campos={CAMPOS_CIELO}
            propriaInicial={f.propria}
            pistas={f.pistas}
            podeEditar={podeEditar && segredoOk}
          />
          <CardCredencial
            filial={f}
            provedor="rede"
            titulo="Rede (e.Rede)"
            campos={CAMPOS_REDE}
            propriaInicial={f.propriaRede}
            pistas={f.pistasRede}
            podeEditar={podeEditar && segredoOk}
            nota="Pix pela Rede só funciona com conta Itaú (chave Pix habilitada no Use Rede). A URL do webhook do Pix é cadastrada por CNPJ na central da Rede."
          />
        </div>
      ))}
    </div>
  );
}

/** "Cobrança online por": Cielo × Rede — a escolha que a fachada consulta ao criar um Pix. */
function SeletorOnline({ filial, podeEditar }: { filial: FilialCred; podeEditar: boolean }) {
  const [adq, setAdq] = useState<'cielo' | 'rede'>(filial.adquirenteOnline);
  const [msg, setMsg] = useState<string | null>(null);
  async function trocar(v: 'cielo' | 'rede') {
    const anterior = adq;
    setAdq(v);
    setMsg(null);
    try {
      const r = await fetch(`/api/filial/${filial.id}/taxas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // ecs/default obrigatórios no schema: manda vazio e o servidor só aplica o adquirente? Não —
        // pra não zerar taxas, esta troca usa a rota própria abaixo.
        body: JSON.stringify({ adquirenteOnline: v }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setAdq(anterior);
        setMsg(d.error ?? `Erro ${r.status}`);
        return;
      }
      setMsg(v === 'rede' ? 'Cobrando online pela Rede ✓' : 'Cobrando online pela Cielo ✓');
    } catch (e) {
      setAdq(anterior);
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{filial.nome}</h2>
          <p className="mt-0.5 text-xs text-slate-500">Cobrança online (Pix/cartão no site) por:</p>
        </div>
        <select
          value={adq}
          disabled={!podeEditar}
          onChange={(e) => trocar(e.target.value === 'rede' ? 'rede' : 'cielo')}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="cielo">Cielo</option>
          <option value="rede">Rede (e.Rede)</option>
        </select>
      </div>
      {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
    </div>
  );
}

function CardCredencial({
  filial,
  provedor,
  titulo,
  campos,
  propriaInicial,
  pistas,
  podeEditar,
  nota,
}: {
  filial: FilialCred;
  provedor: 'cielo' | 'rede';
  titulo: string;
  campos: Campo[];
  propriaInicial: boolean;
  pistas: Record<string, string | null>;
  podeEditar: boolean;
  nota?: string;
}) {
  const [propria, setPropria] = useState(propriaInicial);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/configuracoes/pagamento', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId: filial.id, provedor, valores }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? `Erro ${r.status}`); return; }
      setMsg(d.gravadas ? `Salvo ✓ (${d.gravadas} campo(s))` : 'Nada preenchido pra salvar');
      setValores({});
      if (d.gravadas) setPropria(true);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function desligar() {
    if (!confirm(`Apagar a credencial ${titulo} de ${filial.nome}? A partir daí ela volta a cobrar pela credencial geral do servidor.`)) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/configuracoes/pagamento?filialId=${filial.id}&provedor=${provedor}`, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg(d.error ?? `Erro ${r.status}`); return; }
      setPropria(false);
      setAberto(false);
      setMsg('Voltou pra credencial geral ✓');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="ml-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:ml-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {propria ? (
              <>Cobrando na <b className="text-emerald-700">conta própria</b> desta casa</>
            ) : (
              <>Cobrando pela <b>credencial geral</b> do servidor</>
            )}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={propria || aberto}
            disabled={!podeEditar}
            onChange={(e) => {
              if (e.target.checked) setAberto(true);
              else if (propria) desligar();
              else setAberto(false);
            }}
          />
          Credencial própria
        </label>
      </div>

      {(propria || aberto) && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map((c) => {
              const pista = pistas[c.chave];
              return (
                <div key={c.chave}>
                  <label className="text-xs font-semibold text-slate-700">{c.rotulo}</label>
                  <input
                    type={c.segredo ? 'password' : 'text'}
                    autoComplete="off"
                    value={valores[c.chave] ?? ''}
                    disabled={!podeEditar}
                    onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
                    placeholder={pista ? `salvo: ${pista}` : c.ajuda}
                    className={inp}
                  />
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {pista ? 'Deixe em branco pra manter o que já está salvo.' : c.ajuda}
                  </p>
                </div>
              );
            })}
          </div>
          {nota && <p className="mt-3 text-[11px] leading-relaxed text-amber-800">{nota}</p>}
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            O que você digita aqui é guardado cifrado e <b>nunca volta pra tela</b> — depois de
            salvar aparece só um pedaço (ex: <code>1001…7289</code>) pra você reconhecer. Pra
            trocar, digite o valor novo por cima.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={salvar}
              disabled={!podeEditar || salvando}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
            {msg && <span className="text-xs text-slate-600">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
