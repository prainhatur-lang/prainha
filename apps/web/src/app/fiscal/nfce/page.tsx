// Painel das NFC-e emitidas pelo Concilia: status, valores, XML, cancelamento
// e inutilização de números queimados (rejeições que não foram reaproveitadas).

import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { brDateEnd, brDateStart } from '@/lib/datas';
import { AppHeader } from '@/components/app-header';
import { formatarDocumento } from '@/lib/nfce/documento';
import { AcoesNota } from './acoes';
import { FiltroDocumento } from './filtro-documento';
import { EmitirPedido } from './emitir-pedido';
import { XmlsDownload } from './xmls-download';

/** Cobertura fiscal: pedido fechado do espelho × nota do Concilia × nota que o
 *  Consumer emitiu (nf_venda). O que sobra é "sem nota" — o que o contador
 *  precisa enxergar. */
interface CoberturaDia {
  filial_id: string;
  dia: string;
  pedidos: number;
  valor: string;
  com_nossa: number;
  com_consumer: number;
  sem_nota: number;
  valor_sem: string;
}

interface PedidoSemNota {
  filial_id: string;
  numero: number | null;
  codigo_externo: number;
  fechado_em: string;
  valor: string;
}

async function cobertura(filialIds: string[]): Promise<CoberturaDia[]> {
  if (!filialIds.length) return [];
  const r = await db.execute(sql`
    SELECT p.filial_id::text AS filial_id,
           to_char(p.data_fechamento AT TIME ZONE 'America/Maceio', 'YYYY-MM-DD') AS dia,
           count(*)::int AS pedidos,
           COALESCE(sum(p.valor_total), 0)::text AS valor,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM nfce_emitida n
             WHERE n.filial_id = p.filial_id AND n.pedido_chave = 'fb:' || p.codigo_externo
               AND n.status = 'AUTORIZADA'))::int AS com_nossa,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM nfce_emitida n
             WHERE n.filial_id = p.filial_id AND n.pedido_chave = 'fb:' || p.codigo_externo
               AND n.status = 'AUTORIZADA')
             AND EXISTS (
             SELECT 1 FROM nf_venda nv
             WHERE nv.filial_id = p.filial_id AND nv.tipo = 'NFCE'
               AND nv.codigo_pedido_externo = p.codigo_externo))::int AS com_consumer,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM nfce_emitida n
             WHERE n.filial_id = p.filial_id AND n.pedido_chave = 'fb:' || p.codigo_externo
               AND n.status = 'AUTORIZADA')
             AND NOT EXISTS (
             SELECT 1 FROM nf_venda nv
             WHERE nv.filial_id = p.filial_id AND nv.tipo = 'NFCE'
               AND nv.codigo_pedido_externo = p.codigo_externo))::int AS sem_nota,
           COALESCE(sum(p.valor_total) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM nfce_emitida n
             WHERE n.filial_id = p.filial_id AND n.pedido_chave = 'fb:' || p.codigo_externo
               AND n.status = 'AUTORIZADA')
             AND NOT EXISTS (
             SELECT 1 FROM nf_venda nv
             WHERE nv.filial_id = p.filial_id AND nv.tipo = 'NFCE'
               AND nv.codigo_pedido_externo = p.codigo_externo)), 0)::text AS valor_sem
    FROM pedido p
    WHERE p.filial_id IN ${filialIds}
      AND p.data_fechamento >= now() - interval '14 days'
      AND COALESCE(p.valor_total, 0) > 0
    GROUP BY 1, 2
    ORDER BY 2 DESC, 1
  `);
  return r as unknown as CoberturaDia[];
}

async function pedidosSemNota(filialIds: string[]): Promise<PedidoSemNota[]> {
  if (!filialIds.length) return [];
  const r = await db.execute(sql`
    SELECT p.filial_id::text AS filial_id, p.numero, p.codigo_externo,
           to_char(p.data_fechamento AT TIME ZONE 'America/Maceio', 'DD/MM HH24:MI') AS fechado_em,
           COALESCE(p.valor_total, 0)::text AS valor
    FROM pedido p
    WHERE p.filial_id IN ${filialIds}
      AND p.data_fechamento >= now() - interval '48 hours'
      AND COALESCE(p.valor_total, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM nfce_emitida n
        WHERE n.filial_id = p.filial_id AND n.pedido_chave = 'fb:' || p.codigo_externo
          AND n.status IN ('AUTORIZADA', 'PENDENTE'))
      AND NOT EXISTS (SELECT 1 FROM nf_venda nv
        WHERE nv.filial_id = p.filial_id AND nv.tipo = 'NFCE'
          AND nv.codigo_pedido_externo = p.codigo_externo)
    ORDER BY p.data_fechamento DESC
    LIMIT 60
  `);
  return r as unknown as PedidoSemNota[];
}

export const dynamic = 'force-dynamic';

const CORES: Record<string, string> = {
  AUTORIZADA: 'bg-emerald-100 text-emerald-800',
  PENDENTE: 'bg-amber-100 text-amber-800',
  REJEITADA: 'bg-rose-100 text-rose-800',
  ERRO: 'bg-rose-100 text-rose-800',
  CANCELADA: 'bg-slate-200 text-slate-600',
  INUTILIZADA: 'bg-slate-200 text-slate-600',
};

function dataBr(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Maceio',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const STATUS = ['AUTORIZADA', 'PENDENTE', 'REJEITADA', 'ERRO', 'CANCELADA', 'INUTILIZADA'];

export default async function NfcePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await exigirPermPage('nfce.read');
  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((f) => f.id);
  const nomePorFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  // ---- filtros da lista (tudo opcional; sem filtro = as 200 últimas, como sempre) ----
  const sp = await searchParams;
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  };
  const ymd = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const f = {
    de: ymd(um('de')),
    ate: ymd(um('ate')),
    casa: ids.includes(um('casa')) ? um('casa') : '',
    status: STATUS.includes(um('status')) ? um('status') : '',
    numero: um('numero').replace(/\D/g, '').slice(0, 9),
    mesa: um('mesa').slice(0, 20),
    nfe: um('nfe') === 'sim' || um('nfe') === 'nao' ? um('nfe') : '',
    amb: um('amb') === '1' || um('amb') === '2' ? um('amb') : '',
  };
  const filtrando = Object.values(f).some(Boolean);
  // NF-e (nota grande, produção) autorizada pro cupom da linha
  const nfeDoCupom = (extra = sql``) => sql`EXISTS (
    SELECT 1 FROM nfe_emitida x
     WHERE x.nfce_origem_id = ${schema.nfceEmitida.id}
       AND x.status = 'AUTORIZADA' AND x.ambiente = 1 ${extra})`;
  const cond = [inArray(schema.nfceEmitida.filialId, ids)];
  if (f.de) cond.push(gte(schema.nfceEmitida.criadoEm, brDateStart(f.de)));
  if (f.ate) cond.push(lte(schema.nfceEmitida.criadoEm, brDateEnd(f.ate)));
  if (f.casa) cond.push(eq(schema.nfceEmitida.filialId, f.casa));
  if (f.status) cond.push(eq(schema.nfceEmitida.status, f.status));
  if (f.amb) cond.push(eq(schema.nfceEmitida.ambiente, Number(f.amb)));
  if (f.mesa) cond.push(ilike(schema.nfceEmitida.mesa, `%${f.mesa}%`));
  // número: o do cupom ou o da NF-e que saiu dele
  if (f.numero) {
    const n = Number(f.numero);
    cond.push(sql`(${schema.nfceEmitida.numero} = ${n} OR ${nfeDoCupom(sql`AND x.numero = ${n}`)})`);
  }
  if (f.nfe === 'sim') cond.push(nfeDoCupom());
  if (f.nfe === 'nao') cond.push(sql`NOT ${nfeDoCupom()}`);
  const LIMITE = filtrando ? 1000 : 200;

  const notas = ids.length
    ? await db
        .select()
        .from(schema.nfceEmitida)
        .where(and(...cond))
        .orderBy(desc(schema.nfceEmitida.criadoEm))
        .limit(LIMITE)
    : [];
  const somaFiltro = notas.reduce((t, n) => t + (n.status === 'AUTORIZADA' ? Number(n.valorTotal) : 0), 0);

  // NF-e (nota grande, produção) já autorizada pra cada cupom da lista: vira o
  // selo verde na linha e traz o CPF/CNPJ de quem recebeu a nota.
  const nfes = notas.length
    ? await db
        .select({
          origem: schema.nfeEmitida.nfceOrigemId,
          numero: schema.nfeEmitida.numero,
          serie: schema.nfeEmitida.serie,
          dest: schema.nfeEmitida.dest,
        })
        .from(schema.nfeEmitida)
        .where(
          and(
            inArray(schema.nfeEmitida.nfceOrigemId, notas.map((n) => n.id)),
            eq(schema.nfeEmitida.status, 'AUTORIZADA'),
            eq(schema.nfeEmitida.ambiente, 1),
          ),
        )
    : [];
  const nfePorCupom = new Map(nfes.map((x) => [x.origem, x]));

  const resumo = ids.length
    ? await db
        .select({
          status: schema.nfceEmitida.status,
          qtd: sql<number>`COUNT(*)::int`,
          total: sql<string>`COALESCE(SUM(${schema.nfceEmitida.valorTotal}), 0)::text`,
        })
        .from(schema.nfceEmitida)
        .where(inArray(schema.nfceEmitida.filialId, ids))
        .groupBy(schema.nfceEmitida.status)
    : [];

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pendentesFiscais = notas.filter((n) => n.status === 'REJEITADA' || n.status === 'ERRO');
  const cob = await cobertura(ids);
  const semNota = await pedidosSemNota(ids);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">NFC-e emitidas</h1>
            <p className="mt-1 text-sm text-slate-600">
              Notas emitidas pelo Concilia no fechamento de conta (caixa e maquininha). Últimas 200.
            </p>
          </div>
          <a
            href="/configuracoes/fiscal"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            ⚙ Config fiscal
          </a>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {resumo.map((r) => (
            <div key={r.status} className="rounded-lg border border-slate-200 bg-white px-4 py-2">
              <span
                className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CORES[r.status] ?? 'bg-slate-100 text-slate-700'}`}
              >
                {r.status}
              </span>
              <span className="font-mono text-sm text-slate-900">{r.qtd}</span>
              <span className="ml-2 font-mono text-xs text-slate-500">{brl(Number(r.total))}</span>
            </div>
          ))}
          {resumo.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma NFC-e emitida ainda.</p>
          )}
        </div>

        {pendentesFiscais.length > 0 && (
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            ⚠ {pendentesFiscais.length} tentativa(s) rejeitada(s)/com erro. Reemita pelo caixa
            (mesmo pedido reaproveita o número) ou <b>inutilize</b> o número abaixo — número pulado
            deve ser inutilizado até o dia 10 do mês seguinte.
          </div>
        )}

        {/* ---- visão do contador: cobertura pedido × nota ---- */}
        <h2 className="mt-10 text-lg font-bold text-slate-900">Cobertura fiscal (14 dias)</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Pedidos fechados no PDV × notas emitidas (pelo Concilia ou pelo Consumer). "Sem nota"
          inclui o que estiver na fila de reenvio da loja até a nota sair.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-3 py-2 font-medium text-slate-700">Dia</th>
                <th className="px-3 py-2 font-medium text-slate-700">Filial</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">Pedidos</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">Vendido</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">Nota Concilia</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">Nota Consumer</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">Sem nota</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">R$ sem nota</th>
              </tr>
            </thead>
            <tbody>
              {cob.map((c, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">
                    {c.dia.slice(8, 10)}/{c.dia.slice(5, 7)}
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{nomePorFilial.get(c.filial_id) ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{c.pedidos}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{brl(Number(c.valor))}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{c.com_nossa}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">{c.com_consumer}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${c.sem_nota > 0 ? 'text-rose-700' : 'text-slate-400'}`}>
                    {c.sem_nota}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono ${Number(c.valor_sem) > 0 ? 'text-rose-700' : 'text-slate-400'}`}>
                    {brl(Number(c.valor_sem))}
                  </td>
                </tr>
              ))}
              {cob.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Sem pedidos fechados nos últimos 14 dias.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {semNota.length > 0 && (
          <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              Pedidos sem nota nas últimas 48h ({semNota.length}) — clique pra ver
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-1">
              {semNota.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-3 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-slate-700">
                    {nomePorFilial.get(p.filial_id) ?? ''} · {p.numero ? `mesa/comanda ${p.numero}` : `pedido ${p.codigo_externo}`} · {p.fechado_em}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-slate-900">{brl(Number(p.valor))}</span>
                    <EmitirPedido
                      filialId={p.filial_id}
                      codigoExterno={Number(p.codigo_externo)}
                      rotulo={p.numero ? `mesa/comanda ${p.numero}` : `pedido ${p.codigo_externo}`}
                      valor={brl(Number(p.valor))}
                    />
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              O <b>Emitir</b> monta a nota do que o sistema já sincronizou da loja — funciona mesmo
              com a loja offline. Pedido recém-fechado pode levar alguns minutos pra aparecer aqui;
              nesse caso emita pelo caixa da loja ("🧾 NFC-e do último pedido fechado").
            </p>
          </details>
        )}

        {/* ---- XMLs do mês pro contador ---- */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">📦 XMLs do mês (contador)</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Baixa um ZIP com os XMLs autorizados (e cancelados) da filial no mês — é a guarda
            legal que vai pra escrituração.
          </p>
          <div className="mt-3 space-y-2">
            {filiais.map((f) => (
              <XmlsDownload key={f.id} filialId={f.id} nome={f.nome} />
            ))}
          </div>
        </div>

        {/* ---- filtros da lista ---- */}
        <form id="notas" method="get" action="/fiscal/nfce#notas" className="mt-6 scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">🔎 Procurar nota</h3>
            <span className="text-xs text-slate-500">
              {filtrando
                ? `${notas.length} nota${notas.length === 1 ? '' : 's'} · ${brl(somaFiltro)} autorizado${notas.length === LIMITE ? ` · mostrando as ${LIMITE} mais recentes, aperte o filtro` : ''}`
                : `as ${LIMITE} mais recentes`}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <label className="text-[11px] font-medium text-slate-600">
              De
              <input type="date" name="de" defaultValue={f.de} className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900" />
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              Até
              <input type="date" name="ate" defaultValue={f.ate} className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900" />
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              Filial
              <select name="casa" defaultValue={f.casa} className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900">
                <option value="">todas</option>
                {filiais.map((x) => (
                  <option key={x.id} value={x.id}>{x.nome}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              Status
              <select name="status" defaultValue={f.status} className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900">
                <option value="">todos</option>
                {STATUS.map((x) => (
                  <option key={x} value={x}>{x.toLowerCase()}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              Nº da nota (cupom ou NF-e)
              <input name="numero" inputMode="numeric" defaultValue={f.numero} placeholder="ex.: 734" className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900" />
            </label>
            <FiltroDocumento />
            <label className="text-[11px] font-medium text-slate-600">
              Mesa
              <input name="mesa" defaultValue={f.mesa} placeholder="ex.: 110" className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900" />
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              NF-e (nota grande)
              <select name="nfe" defaultValue={f.nfe} className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900">
                <option value="">tanto faz</option>
                <option value="sim">já tem NF-e</option>
                <option value="nao">sem NF-e</option>
              </select>
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              Ambiente
              <select name="amb" defaultValue={f.amb} className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900">
                <option value="">todos</option>
                <option value="1">produção</option>
                <option value="2">teste (homologação)</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                Filtrar
              </button>
              {filtrando && (
                <a href="/fiscal/nfce#notas" className="text-xs text-slate-500 underline">
                  limpar
                </a>
              )}
            </div>
          </div>
        </form>

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-3 py-2 font-medium text-slate-700">Quando</th>
                <th className="px-3 py-2 font-medium text-slate-700">Filial</th>
                <th className="px-3 py-2 font-medium text-slate-700">Nº/Série</th>
                <th className="px-3 py-2 font-medium text-slate-700">Mesa</th>
                <th className="px-3 py-2 font-medium text-slate-700">Status</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700">Valor</th>
                <th className="px-3 py-2 font-medium text-slate-700">CPF/CNPJ</th>
                <th className="px-3 py-2 font-medium text-slate-700">Retorno SEFAZ</th>
                <th className="px-3 py-2 font-medium text-slate-700">Ações</th>
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => (
                <tr
                  key={n.id}
                  data-doc={n.destDocumento ?? nfePorCupom.get(n.id)?.dest?.documento ?? ''}
                  className="border-t border-slate-100 align-top"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                    {dataBr(n.autorizadaEm ?? n.criadoEm)}
                    {n.ambiente === 2 && (
                      <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">
                        HOM
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{nomePorFilial.get(n.filialId) ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-slate-900">
                    {n.numero}/{n.serie}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{n.mesa ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CORES[n.status] ?? 'bg-slate-100 text-slate-700'}`}
                    >
                      {n.status}
                    </span>
                    {nfePorCupom.get(n.id) && (
                      <a
                        href={`/fiscal/nfce/${n.id}/nfe`}
                        className="ml-1 whitespace-nowrap rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                        title="Este cupom já tem NF-e (nota grande) autorizada — toque pra abrir, não precisa emitir de novo"
                      >
                        ✓ NF-e {nfePorCupom.get(n.id)!.numero}/{nfePorCupom.get(n.id)!.serie}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900">
                    {brl(Number(n.valorTotal))}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">
                    {n.destDocumento
                      ? formatarDocumento(n.destDocumento)
                      : nfePorCupom.get(n.id)?.dest?.documento
                        ? formatarDocumento(nfePorCupom.get(n.id)!.dest!.documento)
                        : '—'}
                  </td>
                  <td className="max-w-[260px] px-3 py-2 text-slate-600">
                    {n.cstat ? `${n.cstat} — ${n.xmotivo ?? ''}` : (n.erro ?? '—')}
                  </td>
                  <td className="px-3 py-2">
                    <AcoesNota
                      id={n.id}
                      status={n.status}
                      temXml={!!n.xml}
                      chave={n.chave}
                    />
                  </td>
                </tr>
              ))}
              {notas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                    {filtrando
                      ? 'Nenhuma nota com esse filtro.'
                      : 'Nenhuma nota. Ative a emissão em Config fiscal e feche uma conta no caixa.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
