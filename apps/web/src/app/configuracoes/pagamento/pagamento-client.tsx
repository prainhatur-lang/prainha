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
  /** Sicredi (API Pix direto na conta): cadastrada pela tela, cifrada. */
  propriaSicredi: boolean;
  pistasSicredi: Record<string, string | null>;
  /** Por qual adquirente esta casa cobra ONLINE hoje. */
  adquirenteOnline: 'cielo' | 'rede';
  /** Cartão na maquininha (LIO) por qual adquirente. */
  adquirenteMaquininha: 'cielo' | 'rede';
  /** Pix por: NULL = igual ao adquirente online (como sempre foi). */
  pixProvedor: 'cielo' | 'rede' | 'sicredi' | 'inter' | null;
  pixChave: string;
  /** O que falta pra ligar o Pix no banco (null = pronto). */
  faltaPix: { sicredi: string | null; inter: string | null };
}

type Campo = { chave: string; rotulo: string; ajuda: string; segredo?: boolean; arquivo?: string };

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

/** API Pix da Sicredi (pedido do dono 12/11/2026: as envs não cabem mais na Vercel). */
const CAMPOS_SICREDI: Campo[] = [
  { chave: 'clientId', rotulo: 'Client ID', ajuda: 'Portal Sicredi → API Pix → credenciais da aplicação' },
  { chave: 'clientSecret', rotulo: 'Client Secret', ajuda: 'Aparece junto com o Client ID', segredo: true },
  { chave: 'cert', rotulo: 'Certificado (.cer)', ajuda: 'O .cer que a Sicredi devolveu (ex.: 33159574000328.cer)', arquivo: '.cer,.crt,.pem' },
  { chave: 'key', rotulo: 'Chave privada (.key)', ajuda: 'O .key gerado junto com o pedido (CSR)', arquivo: '.key,.pem' },
  { chave: 'chave', rotulo: 'Chave Pix (opcional)', ajuda: 'Em branco = a do quadro "como esta casa recebe"' },
];

/** Lê o arquivo e devolve o conteúdo em base64 (é como a lib guarda .cer/.key). */
function arquivoBase64(f: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => {
      const u = String(r.result ?? '');
      ok(u.slice(u.indexOf(',') + 1));
    };
    r.onerror = () => erro(r.error);
    r.readAsDataURL(f);
  });
}

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
          <Configurador filial={f} podeEditar={podeEditar} />
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
          <CardCredencial
            filial={f}
            provedor="sicredi"
            titulo="Sicredi (API Pix direto na conta)"
            campos={CAMPOS_SICREDI}
            propriaInicial={f.propriaSicredi}
            pistas={f.pistasSicredi}
            podeEditar={podeEditar && segredoOk}
            rotuloPropria={['Usando a credencial ', 'cadastrada aqui']}
            rotuloGeral="Sem cadastro aqui: usa a da Vercel, se houver"
            nota="Depois de salvar, recarregue a página: o aviso “não configurado” do Pix por Sicredi some e dá pra escolher Sicredi no quadro acima. Apagar daqui volta pra credencial da Vercel (se a casa tiver)."
          />
        </div>
      ))}
    </div>
  );
}

type ProvPix = 'cielo' | 'rede' | 'sicredi' | 'inter' | '';

const NOME_PIX: Record<Exclude<ProvPix, ''>, string> = {
  cielo: 'Cielo',
  rede: 'Rede',
  sicredi: 'Sicredi (direto na conta)',
  inter: 'Inter (direto na conta)',
};

/** Configurador de recebimento (pedido do dono 10/11/2026): cartão por quem e
 *  Pix por quem — vale pra maquininha, QR da mesa, delivery, reserva e tudo
 *  que for Pix. Escolher Sicredi/Inter = Pix SÓ pelo banco. */
function Configurador({ filial, podeEditar }: { filial: FilialCred; podeEditar: boolean }) {
  const [maq, setMaq] = useState<'cielo' | 'rede'>(filial.adquirenteMaquininha);
  const [pix, setPix] = useState<ProvPix>(filial.pixProvedor ?? '');
  const [chave, setChave] = useState(filial.pixChave);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(url: string, body: unknown): Promise<string | null> {
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d.error ?? `Erro ${r.status}`;
  }

  async function trocarMaq(v: 'cielo' | 'rede') {
    const anterior = maq;
    setMaq(v);
    setMsg(null);
    const e = await enviar(`/api/filial/${filial.id}/taxas`, { adquirenteMaquininha: v });
    if (e) {
      setMaq(anterior);
      setMsg({ ok: false, t: e });
    } else setMsg({ ok: true, t: `Cartão na maquininha pela ${v === 'rede' ? 'Rede' : 'Cielo'} ✓` });
  }

  async function salvarPix() {
    setSalvando(true);
    setMsg(null);
    const e = await enviar(`/api/filial/${filial.id}/pix`, { pixChave: chave.trim() || null, pixProvedor: pix || null });
    setSalvando(false);
    if (e) setMsg({ ok: false, t: e });
    else
      setMsg({
        ok: true,
        t: pix ? `Pix só por ${NOME_PIX[pix]} em todos os canais ✓` : `Pix igual à cobrança online (${filial.adquirenteOnline === 'rede' ? 'Rede' : 'Cielo'}) ✓`,
      });
  }

  const falta = pix === 'sicredi' || pix === 'inter' ? filial.faltaPix[pix] : null;
  const precisaChave = pix === 'sicredi' || pix === 'inter';

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{filial.nome} — como esta casa recebe</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          Cartão na maquininha por
          <select
            value={maq}
            disabled={!podeEditar}
            onChange={(e) => trocarMaq(e.target.value === 'rede' ? 'rede' : 'cielo')}
            className={inp}
          >
            <option value="cielo">Cielo</option>
            <option value="rede">Rede</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Pix por (maquininha, QR da mesa, delivery, reserva, tudo)
          <select value={pix} disabled={!podeEditar} onChange={(e) => setPix(e.target.value as ProvPix)} className={inp}>
            <option value="">Igual à cobrança online ({filial.adquirenteOnline === 'rede' ? 'Rede' : 'Cielo'})</option>
            <option value="cielo">Cielo</option>
            <option value="rede">Rede</option>
            <option value="sicredi">
              Sicredi (direto na conta){filial.faltaPix.sicredi ? ' — não configurado' : ''}
            </option>
            <option value="inter">Inter (direto na conta){filial.faltaPix.inter ? ' — não configurado' : ''}</option>
          </select>
        </label>
      </div>
      {precisaChave && (
        <label className="mt-3 block text-xs text-slate-600">
          Chave Pix da conta {pix === 'sicredi' ? 'Sicredi' : 'Inter'} desta casa (CNPJ, e-mail, telefone ou aleatória)
          <input
            value={chave}
            disabled={!podeEditar}
            onChange={(e) => setChave(e.target.value)}
            placeholder="ex.: 33159574000328"
            className={inp}
          />
        </label>
      )}
      {falta && (
        <p className="mt-2 text-xs text-amber-800">
          ⚠️ Ainda não dá pra ligar: {falta}. Enquanto isso o Pix continua como está hoje.
        </p>
      )}
      {podeEditar && (
        <button
          onClick={salvarPix}
          disabled={salvando}
          className="mt-3 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar Pix'}
        </button>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.t}</p>}
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
  rotuloPropria,
  rotuloGeral,
}: {
  filial: FilialCred;
  provedor: 'cielo' | 'rede' | 'sicredi';
  titulo: string;
  campos: Campo[];
  propriaInicial: boolean;
  pistas: Record<string, string | null>;
  podeEditar: boolean;
  nota?: string;
  rotuloPropria?: [string, string];
  rotuloGeral?: string;
}) {
  const [propria, setPropria] = useState(propriaInicial);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [nomesArq, setNomesArq] = useState<Record<string, string>>({});

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
      setNomesArq({});
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
              rotuloPropria ? (
                <>{rotuloPropria[0]}<b className="text-emerald-700">{rotuloPropria[1]}</b></>
              ) : (
                <>Cobrando na <b className="text-emerald-700">conta própria</b> desta casa</>
              )
            ) : rotuloGeral ? (
              <>{rotuloGeral}</>
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
                  {c.arquivo ? (
                    <>
                      <input
                        type="file"
                        accept={c.arquivo}
                        disabled={!podeEditar}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const b64 = await arquivoBase64(f);
                          setValores((v) => ({ ...v, [c.chave]: b64 }));
                          setNomesArq((n) => ({ ...n, [c.chave]: f.name }));
                        }}
                        className="mt-1 block w-full text-xs text-slate-700 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium"
                      />
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {nomesArq[c.chave]
                          ? `Pronto pra salvar: ${nomesArq[c.chave]}`
                          : pista
                            ? 'Já tem arquivo salvo. Escolha outro só pra trocar.'
                            : c.ajuda}
                      </p>
                    </>
                  ) : (<>
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
                  </>)}
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
