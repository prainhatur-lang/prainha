// Painel das NFC-e emitidas pelo Concilia: status, valores, XML, cancelamento
// e inutilização de números queimados (rejeições que não foram reaproveitadas).

import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { formatarDocumento } from '@/lib/nfce/documento';
import { AcoesNota } from './acoes';
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

export default async function NfcePage() {
  const user = await exigirPermPage('nfce.read');
  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((f) => f.id);
  const nomePorFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  const notas = ids.length
    ? await db
        .select()
        .from(schema.nfceEmitida)
        .where(inArray(schema.nfceEmitida.filialId, ids))
        .orderBy(desc(schema.nfceEmitida.criadoEm))
        .limit(200)
    : [];

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
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {semNota.map((p, i) => (
                <div key={i} className="flex justify-between rounded border border-slate-100 px-3 py-1.5 text-xs">
                  <span className="text-slate-700">
                    {nomePorFilial.get(p.filial_id) ?? ''} · {p.numero ? `mesa/comanda ${p.numero}` : `pedido ${p.codigo_externo}`} · {p.fechado_em}
                  </span>
                  <span className="font-mono text-slate-900">{brl(Number(p.valor))}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Pra emitir depois: no caixa da loja, digite o número da mesa (mesmo fechada) e use
              "🧾 NFC-e do último pedido fechado".
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

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
                <tr key={n.id} className="border-t border-slate-100 align-top">
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
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-900">
                    {brl(Number(n.valorTotal))}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">
                    {n.destDocumento ? formatarDocumento(n.destDocumento) : '—'}
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
                    Nenhuma nota. Ative a emissão em Config fiscal e feche uma conta no caixa.
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
