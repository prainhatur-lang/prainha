'use client';

// NF-e de venda da Lelis (01/11/2026): comprador pelo CNPJ, forma de pagamento,
// frete e os itens marcados na tabela de preço. "Testar antes" emite em
// homologação (sem valor fiscal); "Emitir" vale de verdade.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProdutoLinha, ConfigLelis } from './manager';

interface ItemVenda {
  produto: ProdutoLinha;
  quantidade: number;
  preco: number;
}

interface NotaLista {
  id: string;
  numero: number;
  serie: number;
  chave: string;
  status: string;
  ambiente: number;
  valorTotal: number;
  destNome: string | null;
  xmotivo: string | null;
  criadoEm: string;
}

const DEST_VAZIO = {
  documento: '',
  nome: '',
  ie: '',
  email: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  codigoMunicipio: '',
  municipio: '',
  uf: 'SE',
  cep: '',
  fone: '',
};
type Dest = typeof DEST_VAZIO;

const FORMAS: Record<string, string> = {
  '15': 'Boleto',
  '18': 'Pix / transferência',
  '01': 'Dinheiro',
  '16': 'Depósito bancário',
  '05': 'A prazo (crédito loja)',
  '90': 'Sem pagamento nesta nota',
};
const FRETES: Record<string, string> = {
  '0': 'Lelis entrega (frete nosso)',
  '1': 'Comprador retira / paga o frete',
  '9': 'Sem transporte',
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function novoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

export function VendaNfe({ config, itens, onLimpar }: { config: ConfigLelis; itens: ItemVenda[]; onLimpar: () => void }) {
  const [dest, setDest] = useState<Dest>(DEST_VAZIO);
  const [forma, setForma] = useState('15');
  const [frete, setFrete] = useState('1');
  const [cfop, setCfop] = useState('');
  const [info, setInfo] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // um id por nota e ambiente: repetir o clique cai na mesma nota
  const [ids, setIds] = useState(() => ({ teste: novoId(), real: novoId() }));
  const [notas, setNotas] = useState<NotaLista[]>([]);

  const total = useMemo(() => itens.reduce((s, i) => s + Math.round(i.quantidade * i.preco * 100) / 100, 0), [itens]);
  const semNcm = itens.filter((i) => !/^\d{8}$/.test(String(i.produto.ncm ?? '').replace(/\D/g, '')));
  const semPreco = itens.filter((i) => !(i.preco > 0));

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/lelis/nfe');
      if (r.ok) setNotas(((await r.json()) as { notas: NotaLista[] }).notas);
    } catch {
      /* lista é só consulta */
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const set = (k: keyof Dest) => (e: React.ChangeEvent<HTMLInputElement>) => setDest((d) => ({ ...d, [k]: e.target.value }));

  async function buscarCnpj() {
    const v = dest.documento.replace(/\D/g, '');
    if (v.length !== 14) {
      setAviso('Digite o CNPJ com 14 números pra buscar');
      return;
    }
    setOcupado('cnpj');
    setErro(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/nfe/consulta-destinatario?cnpj=${v}`);
      const j = await r.json();
      if (!r.ok) {
        setAviso(j.error ?? 'não achei — preencha na mão');
        return;
      }
      setDest((a) => {
        const n: Record<string, string> = { ...a };
        for (const [k, val] of Object.entries((j.dados ?? {}) as Record<string, string>)) {
          if (val && k in n) n[k] = String(val);
        }
        return n as Dest;
      });
      if (j.situacao && j.situacao !== 'ATIVA') setAviso(`Atenção: na Receita este CNPJ está ${j.situacao}.`);
      else setAviso('Dados puxados da Receita — confira a inscrição estadual e o endereço.');
    } catch {
      setAviso('consulta fora do ar — preencha na mão');
    } finally {
      setOcupado(null);
    }
  }

  async function emitir(homologacao: boolean) {
    if (!homologacao && !confirm(`Emitir a NF-e de venda de ${brl(total)} pra ${dest.nome || 'o comprador'}? Ela vale de verdade na SEFAZ.`)) return;
    setOcupado(homologacao ? 'teste' : 'real');
    setErro(null);
    setAviso(null);
    try {
      const r = await fetch('/api/lelis/nfe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: homologacao ? ids.teste : ids.real,
          homologacao,
          destinatario: dest,
          itens: itens.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade, preco: i.preco })),
          formaPagamento: forma,
          modFrete: frete,
          cfop: cfop.replace(/\D/g, '') || undefined,
          infoExtra: info.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErro(j.error ?? 'falhou');
        return;
      }
      const n = j.nota as { numero: number; serie: number };
      setAviso(
        homologacao
          ? `Teste aprovado pela SEFAZ (homologação, nº ${n.numero}). Pode emitir a de verdade.`
          : `NF-e ${n.numero} (série ${n.serie}) autorizada.${j.aviso ? ' ' + j.aviso : ''}`,
      );
      // o próximo teste/nota nasce com id novo
      setIds((x) => (homologacao ? { ...x, teste: novoId() } : { teste: novoId(), real: novoId() }));
      if (!homologacao) onLimpar();
      void carregar();
    } catch {
      setErro('sem resposta — clique de novo: o sistema confere antes de reenviar');
    } finally {
      setOcupado(null);
    }
  }

  async function cancelar(n: NotaLista) {
    const just = prompt(`Cancelar a NF-e ${n.numero}? Escreva o motivo (mínimo 15 letras). Prazo da SEFAZ: 24 h.`);
    if (!just) return;
    setOcupado('cancelar');
    setErro(null);
    try {
      const r = await fetch(`/api/lelis/nfe/${n.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa: just }),
      });
      const j = await r.json();
      if (!r.ok) setErro(j.error ?? 'não cancelou');
      else setAviso(`NF-e ${n.numero} cancelada.`);
      void carregar();
    } finally {
      setOcupado(null);
    }
  }

  const prontoCert = !!config.certificado;
  const podeEmitir =
    itens.length > 0 && semNcm.length === 0 && semPreco.length === 0 && dest.documento && dest.nome && prontoCert && !ocupado;

  const campo = 'rounded-md border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-semibold text-slate-900">NF-e de venda</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Marque a quantidade na coluna “Vender” da tabela. Natureza “Venda de mercadoria”, CFOP 5102 (SE) / 6102 (outro estado), ou
        5405/6404 com ICMS-ST já retido.
      </p>

      {!prontoCert && (
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
          Falta o certificado digital A1 da Lelis (em Dados fiscais) — sem ele a nota não sai.
        </p>
      )}

      {itens.length === 0 ? (
        <p className="mt-3 text-slate-500">Nenhum produto marcado ainda.</p>
      ) : (
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Produto</th>
              <th className="text-right">Qtd</th>
              <th className="text-right">Preço</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.produto.id} className="border-t border-slate-100">
                <td className="py-1">
                  {i.produto.descricao}
                  {!/^\d{8}$/.test(String(i.produto.ncm ?? '').replace(/\D/g, '')) && <span className="ml-1 text-red-600">(sem NCM)</span>}
                </td>
                <td className="text-right">{i.quantidade.toLocaleString('pt-BR')} {i.produto.unidade}</td>
                <td className="text-right">{brl(i.preco)}</td>
                <td className="text-right">{brl(Math.round(i.quantidade * i.preco * 100) / 100)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-1" colSpan={3}>Total da nota</td>
              <td className="text-right">{brl(total)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="flex gap-1 sm:col-span-2">
          <input className={campo + ' flex-1'} placeholder="CNPJ do comprador" value={dest.documento} onChange={set('documento')} />
          <button onClick={buscarCnpj} disabled={!!ocupado} className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-50">
            {ocupado === 'cnpj' ? '…' : 'Buscar'}
          </button>
        </div>
        <input className={campo + ' sm:col-span-2'} placeholder="Razão social" value={dest.nome} onChange={set('nome')} />
        <input className={campo} placeholder="Inscrição estadual" value={dest.ie} onChange={set('ie')} />
        <input className={campo} placeholder="E-mail (recebe a nota)" value={dest.email} onChange={set('email')} />
        <input className={campo} placeholder="Telefone" value={dest.fone} onChange={set('fone')} />
        <input className={campo} placeholder="CEP" value={dest.cep} onChange={set('cep')} />
        <input className={campo + ' sm:col-span-2'} placeholder="Rua" value={dest.logradouro} onChange={set('logradouro')} />
        <input className={campo} placeholder="Número" value={dest.numero} onChange={set('numero')} />
        <input className={campo} placeholder="Complemento" value={dest.complemento} onChange={set('complemento')} />
        <input className={campo} placeholder="Bairro" value={dest.bairro} onChange={set('bairro')} />
        <input className={campo} placeholder="Município" value={dest.municipio} onChange={set('municipio')} />
        <input className={campo} placeholder="Cód. IBGE do município" value={dest.codigoMunicipio} onChange={set('codigoMunicipio')} />
        <input className={campo} placeholder="UF" maxLength={2} value={dest.uf} onChange={set('uf')} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <label className="text-xs text-slate-600">
          Pagamento
          <select className={campo + ' mt-0.5 w-full'} value={forma} onChange={(e) => setForma(e.target.value)}>
            {Object.entries(FORMAS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Frete
          <select className={campo + ' mt-0.5 w-full'} value={frete} onChange={(e) => setFrete(e.target.value)}>
            {Object.entries(FRETES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          CFOP (vazio = automático)
          <input className={campo + ' mt-0.5 w-full'} placeholder="5102" value={cfop} onChange={(e) => setCfop(e.target.value)} />
        </label>
        <label className="text-xs text-slate-600">
          Informação extra na nota
          <input className={campo + ' mt-0.5 w-full'} placeholder="pedido nº, vencimento…" value={info} onChange={(e) => setInfo(e.target.value)} />
        </label>
      </div>

      {semPreco.length > 0 && <p className="mt-2 text-xs text-red-700">Tem produto sem preço — confira os percentuais.</p>}
      {erro && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      {aviso && <p className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-800">{aviso}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => emitir(true)} disabled={!podeEmitir} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">
          {ocupado === 'teste' ? 'Testando…' : 'Testar antes (homologação)'}
        </button>
        <button
          onClick={() => emitir(false)}
          disabled={!podeEmitir || config.emitente.nfeAmbiente !== 1}
          title={config.emitente.nfeAmbiente !== 1 ? 'Ambiente está em homologação nos Dados fiscais' : ''}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50"
        >
          {ocupado === 'real' ? 'Emitindo…' : `Emitir NF-e (${brl(total)})`}
        </button>
        {itens.length > 0 && (
          <button onClick={onLimpar} disabled={!!ocupado} className="px-2 py-1.5 text-xs text-slate-500 underline">
            limpar itens
          </button>
        )}
      </div>

      {notas.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Notas emitidas</h3>
          <table className="mt-1 w-full text-xs">
            <tbody>
              {notas.map((n) => (
                <tr key={n.id} className="border-t border-slate-100">
                  <td className="py-1">
                    {n.numero}/{n.serie}
                    {n.ambiente === 2 && <span className="ml-1 text-amber-700">(teste)</span>}
                  </td>
                  <td>{n.destNome ?? '—'}</td>
                  <td className="text-right">{brl(n.valorTotal)}</td>
                  <td className="pl-2">
                    <span className={n.status === 'AUTORIZADA' ? 'text-emerald-700' : n.status === 'CANCELADA' ? 'text-slate-400' : 'text-red-700'}>
                      {n.status}
                    </span>
                    {n.status === 'REJEITADA' && n.xmotivo && <span className="ml-1 text-slate-500">{n.xmotivo}</span>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {n.status === 'AUTORIZADA' && (
                      <>
                        <a href={`/api/lelis/nfe/${n.id}/xml`} className="text-sky-700 underline">XML</a>
                        <button onClick={() => cancelar(n)} disabled={!!ocupado} className="ml-2 text-red-700 underline">
                          cancelar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
