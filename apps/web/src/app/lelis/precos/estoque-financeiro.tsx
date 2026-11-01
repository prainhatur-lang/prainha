'use client';
// Lelis: entrada de nota, estoque, tributação da saída e contas a pagar/receber (01/11/2026).
import { useCallback, useEffect, useState } from 'react';

type Nota = {
  id: string; numero: number | null; serie: number | null; chave: string; emit_nome: string | null;
  valor_total: number | null; emissao: string | null; itens: number; itens_entrada: number; contas: number;
};
type Estoque = {
  id: string; descricao: string; unidade: string; trib_icms: string | null; cst_pis_saida: string | null;
  trib_manual: boolean; cfop_entrada: string | null; cst_icms_entrada: string | null; cst_pis_entrada: string | null;
  icms_st_unit: number | null; saldo: number; entrou: number; vendeu: number; custo: number;
};
type Pagar = {
  id: string; descricao: string | null; parcela: number | null; total_parcelas: number | null; vencimento: string;
  valor: number; pago_em: string | null; valor_pago: number | null; fornecedor: string | null;
};
type Receber = {
  id: string; comprador_nome: string | null; comprador_doc: string | null; descricao: string | null; parcela: number;
  total_parcelas: number; vencimento: string; valor: number; forma_pagamento: string | null; recebido_em: string | null;
  valor_recebido: number | null; cancelado: boolean;
};

const TRIB: Record<string, string> = { TRIBUTADO: 'Tributado', ST: 'Substituição (ST)', ISENTO: 'Isento', NAO_TRIB: 'Não tributado' };
const PIS: Record<string, string> = {
  '01': 'Tributado', '04': 'Monofásico', '05': 'ST', '06': 'Alíquota zero', '07': 'Isento', '08': 'Sem incidência', '09': 'Suspensão',
};
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dt = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

type Aba = 'notas' | 'estoque' | 'pagar' | 'receber';

export function EstoqueFinanceiroLelis() {
  const [aba, setAba] = useState<Aba>('notas');
  const [notas, setNotas] = useState<Nota[]>([]);
  const [estoque, setEstoque] = useState<Estoque[]>([]);
  const [pagar, setPagar] = useState<Pagar[]>([]);
  const [receber, setReceber] = useState<Receber[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [e, f] = await Promise.all([
      fetch('/api/lelis/entrada').then((r) => r.json()).catch(() => null),
      fetch('/api/lelis/financeiro').then((r) => r.json()).catch(() => null),
    ]);
    if (e) { setNotas(e.notas ?? []); setEstoque(e.estoque ?? []); }
    if (f) { setPagar(f.pagar ?? []); setReceber(f.receber ?? []); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function buscarSefaz() {
    setOcupado('sefaz'); setMsg('Buscando na SEFAZ… (até 1 minuto)');
    const r = await fetch('/api/lelis/buscar-sefaz', { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'sem conexão' }));
    setOcupado(null);
    if (r.error) { setMsg(`Erro: ${r.error}`); return; }
    const partes = [
      `${r.completas + r.upgrades + r.xmlPorChave} nota(s) completa(s) com XML`,
      r.resumos ? `${r.resumos} só com resumo (ciência dada: ${r.ciencias}; o XML vem na próxima busca)` : null,
      r.tribAtualizadas ? `${r.tribAtualizadas} nota(s) antiga(s) com CST/CFOP preenchido pelo XML` : null,
      r.semXml?.length ? `${r.semXml.length} sem XML ainda` : null,
      r.bloqueio ? `SEFAZ pediu pra esperar 1 hora (${r.bloqueio})` : null,
      r.aviso ? `Aviso: ${r.aviso}` : null,
    ].filter(Boolean);
    setMsg(`SEFAZ: ${partes.join(' · ')}. Produtos na tela de preço: ${r.produtos}.`);
    await carregar();
  }

  async function darEntrada(n: Nota) {
    setOcupado(n.id); setMsg(null);
    const r = await fetch('/api/lelis/entrada', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notaId: n.id }),
    }).then((x) => x.json()).catch(() => ({ error: 'sem conexão' }));
    setOcupado(null);
    if (r.error) { setMsg(`Erro: ${r.error}`); return; }
    setMsg(r.jaTinha
      ? `NF-e ${n.numero}: já tinha entrada — nada a fazer.`
      : `NF-e ${n.numero}: ${r.itens} item(ns) no estoque, ${r.contas} conta(s) a pagar.${r.semProduto ? ` ${r.semProduto} item(ns) sem produto — sincronize os produtos.` : ''}`);
    await carregar();
  }

  async function mudarTrib(p: Estoque, campo: 'tribIcms' | 'cstPisSaida', valor: string) {
    setOcupado(p.id);
    const body: Record<string, unknown> = { id: p.id, [campo]: valor === 'AUTO' ? null : valor };
    if (valor === 'AUTO') { body.tribIcms = null; body.cstPisSaida = null; }
    const r = await fetch('/api/lelis/produtos', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then((x) => x.json()).catch(() => ({ error: 'sem conexão' }));
    setOcupado(null);
    if (r.error) setMsg(`Erro: ${r.error}`);
    if (valor === 'AUTO') {
      // refaz pela nota de entrada
      await fetch('/api/lelis/sincronizar', { method: 'POST' }).catch(() => null);
    }
    await carregar();
  }

  async function baixa(tipo: 'pagar' | 'receber', id: string, data: string | null) {
    setOcupado(id);
    const r = await fetch('/api/lelis/financeiro', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tipo, id, data }),
    }).then((x) => x.json()).catch(() => ({ error: 'sem conexão' }));
    setOcupado(null);
    if (r.error) setMsg(`Erro: ${r.error}`);
    await carregar();
  }

  const abertoPagar = pagar.filter((c) => !c.pago_em).reduce((s, c) => s + c.valor, 0);
  const abertoReceber = receber.filter((c) => !c.recebido_em && !c.cancelado).reduce((s, c) => s + c.valor, 0);
  const valorEstoque = estoque.reduce((s, p) => s + Math.max(p.saldo, 0) * p.custo, 0);
  const pendentes = notas.filter((n) => n.itens_entrada === 0).length;

  const btnAba = (k: Aba, rot: string) => (
    <button
      key={k}
      onClick={() => setAba(k)}
      className={`rounded-md px-3 py-1.5 text-sm ${aba === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
    >
      {rot}
    </button>
  );

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Entrada de notas, estoque e financeiro</h2>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <span>Estoque a custo: <b>{brl(valorEstoque)}</b></span>
          <span>A pagar em aberto: <b className="text-red-700">{brl(abertoPagar)}</b></span>
          <span>A receber em aberto: <b className="text-emerald-700">{brl(abertoReceber)}</b></span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {btnAba('notas', `Notas de entrada${pendentes ? ` (${pendentes} sem entrada)` : ''}`)}
        {btnAba('estoque', 'Estoque e tributação')}
        {btnAba('pagar', 'A pagar')}
        {btnAba('receber', 'A receber')}
      </div>
      {msg && <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-800">{msg}</p>}

      {aba === 'notas' && (
        <div className="overflow-x-auto">
          <div className="mb-2">
            <button disabled={ocupado === 'sefaz'} onClick={buscarSefaz}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {ocupado === 'sefaz' ? 'Buscando…' : '⬇ Buscar notas na SEFAZ (XML)'}
            </button>
            <span className="ml-2 text-xs text-slate-500">
              Puxa as notas emitidas pra Lelis nos últimos 90 dias e preenche CST/CFOP das antigas pelo XML. Também roda sozinho às 04h e 16h.
            </span>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Notas de compra que chegaram pra Lelis (SEFAZ ou upload). “Dar entrada” põe os itens no estoque, lança as
            duplicatas no a pagar e já calcula a tributação da venda de cada produto pelo CFOP/CST da nota.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">Emissão</th><th>NF-e</th><th>Fornecedor</th><th className="text-right">Valor</th><th className="text-right">Itens</th><th className="text-right">Contas</th><th /></tr>
            </thead>
            <tbody>
              {notas.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-500">Nenhuma nota de compra da Lelis ainda.</td></tr>}
              {notas.map((n) => (
                <tr key={n.id} className="border-t border-slate-100">
                  <td className="py-1.5">{dt(n.emissao)}</td>
                  <td>{n.numero ?? '—'}</td>
                  <td className="max-w-[16rem] truncate">{n.emit_nome}</td>
                  <td className="text-right">{brl(n.valor_total)}</td>
                  <td className="text-right">{n.itens_entrada}/{n.itens}</td>
                  <td className="text-right">{n.contas}</td>
                  <td className="text-right">
                    {n.itens_entrada >= n.itens && n.itens > 0 ? (
                      <span className="text-xs text-emerald-700">✓ entrada feita</span>
                    ) : (
                      <button disabled={ocupado === n.id} onClick={() => darEntrada(n)}
                        className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        {ocupado === n.id ? '…' : 'Dar entrada'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'estoque' && (
        <div className="overflow-x-auto">
          <p className="mb-2 text-xs text-slate-500">
            Tributação da venda tirada da nota de entrada: CFOP 5405/6404 ou CST 10/60 → sai como substituição (CST 60 /
            CSOSN 500, CFOP 5405/6404); PIS/COFINS monofásico na compra → sai monofásico (CST 04). Mudou à mão (✋), nota
            nova não troca; “Automático” volta pro que a nota diz.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">Produto</th><th>Entrada (CFOP · CST · PIS)</th><th>ICMS na venda</th><th>PIS/COFINS na venda</th><th className="text-right">Entrou</th><th className="text-right">Vendeu</th><th className="text-right">Saldo</th><th className="text-right">Custo</th></tr>
            </thead>
            <tbody>
              {estoque.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="max-w-[18rem] truncate py-1.5">{p.descricao}</td>
                  <td className="text-xs text-slate-500">
                    {[p.cfop_entrada, p.cst_icms_entrada, p.cst_pis_entrada].map((x) => x ?? '—').join(' · ')}
                    {p.icms_st_unit ? ` · ST ${brl(p.icms_st_unit)}/un` : ''}
                  </td>
                  <td>
                    <select disabled={ocupado === p.id} value={p.trib_icms ?? ''} onChange={(e) => mudarTrib(p, 'tribIcms', e.target.value)}
                      className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                      <option value="" disabled>config geral</option>
                      {Object.entries(TRIB).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      {p.trib_manual && <option value="AUTO">↺ Automático (pela nota)</option>}
                    </select>
                    {p.trib_manual && <span title="escolhido à mão" className="ml-1">✋</span>}
                  </td>
                  <td>
                    <select disabled={ocupado === p.id} value={p.cst_pis_saida ?? ''} onChange={(e) => mudarTrib(p, 'cstPisSaida', e.target.value)}
                      className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                      <option value="" disabled>config geral</option>
                      {Object.entries(PIS).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
                      {p.trib_manual && <option value="AUTO">↺ Automático (pela nota)</option>}
                    </select>
                  </td>
                  <td className="text-right">{qtd(p.entrou)}</td>
                  <td className="text-right">{qtd(p.vendeu)}</td>
                  <td className={`text-right font-medium ${p.saldo < 0 ? 'text-red-700' : ''}`}>{qtd(p.saldo)} {p.unidade}</td>
                  <td className="text-right">{brl(p.custo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'pagar' && (
        <TabelaFin
          linhas={pagar.map((c) => ({
            id: c.id, quem: c.fornecedor, desc: c.descricao, venc: c.vencimento, valor: c.valor, baixa: c.pago_em, cancelado: false,
          }))}
          rotuloBaixa="Pago" ocupado={ocupado} onBaixa={(id, d) => baixa('pagar', id, d)}
          vazio="Nada a pagar. As contas entram aqui ao dar entrada numa nota de compra."
        />
      )}
      {aba === 'receber' && (
        <TabelaFin
          linhas={receber.map((c) => ({
            id: c.id, quem: c.comprador_nome, desc: c.descricao, venc: c.vencimento, valor: c.valor, baixa: c.recebido_em, cancelado: c.cancelado,
          }))}
          rotuloBaixa="Recebido" ocupado={ocupado} onBaixa={(id, d) => baixa('receber', id, d)}
          vazio="Nada a receber. Cada NF-e de venda autorizada (produção) entra aqui."
        />
      )}
    </section>
  );
}

function TabelaFin(props: {
  linhas: { id: string; quem: string | null; desc: string | null; venc: string; valor: number; baixa: string | null; cancelado: boolean }[];
  rotuloBaixa: string; ocupado: string | null; vazio: string;
  onBaixa: (id: string, data: string | null) => void;
}) {
  const h = hoje();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="py-1">Vencimento</th><th>Quem</th><th>Descrição</th><th className="text-right">Valor</th><th className="text-right">Situação</th></tr>
        </thead>
        <tbody>
          {props.linhas.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">{props.vazio}</td></tr>}
          {props.linhas.map((l) => (
            <tr key={l.id} className={`border-t border-slate-100 ${l.cancelado ? 'text-slate-400 line-through' : ''}`}>
              <td className={`py-1.5 ${!l.baixa && !l.cancelado && l.venc < h ? 'font-medium text-red-700' : ''}`}>{dt(l.venc)}</td>
              <td className="max-w-[14rem] truncate">{l.quem ?? '—'}</td>
              <td className="max-w-[16rem] truncate">{l.desc}</td>
              <td className="text-right">{brl(l.valor)}</td>
              <td className="text-right">
                {l.cancelado ? 'cancelada' : l.baixa ? (
                  <span className="text-xs text-emerald-700">
                    {props.rotuloBaixa} {dt(l.baixa)}{' '}
                    <button disabled={props.ocupado === l.id} onClick={() => props.onBaixa(l.id, null)} className="text-slate-400 underline">desfazer</button>
                  </span>
                ) : (
                  <button disabled={props.ocupado === l.id} onClick={() => props.onBaixa(l.id, h)}
                    className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-900 disabled:opacity-50">
                    {props.rotuloBaixa} hoje
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
