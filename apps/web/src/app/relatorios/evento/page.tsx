// /relatorios/evento — Evento com prato "de ticket": o prato é lançado a R$ 0,01
// na mesa e cada um vale um ticket que a casa recebe por fora (ex.: R$ 70). Aqui
// o dono vê quantos pratos saíram no dia, quanto isso dá em tickets e quanto as
// mesmas contas pagaram de bebida e do resto no PDV — o faturamento do evento.
// Só leitura: nada é gravado, a escolha dos pratos e o valor moram na URL.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl, int, parseValorBr } from '@/lib/format';
import { dateToBrYmd } from '@/lib/datas';
import { rotuloDia, somaDias } from '@/lib/relatorio-diario';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dia?: string;
  valor?: string;
  /** códigos dos pratos escolhidos (um ou vários) */
  p?: string | string[];
  /** veio do formulário: sem isso, vale a escolha automática */
  sel?: string;
}

/** Prato "de ticket" é o lançado por até um centavo. */
const TETO_TICKET = 0.011;

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

function KPI({ label, valor, sub, cor = 'text-slate-900' }: { label: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${cor}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default async function RelatorioEventoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'relatorio.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) redirect('/');
  const filial = escolhida;

  // dia operacional em andamento (vira às 05:00)
  const emAndamento = dateToBrYmd(new Date(Date.now() - 5 * 3600 * 1000));
  const pedido = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : emAndamento;
  const dia = pedido > emAndamento ? emAndamento : pedido;
  const ini = `${dia}T05:00:00-03:00`;
  const fim = `${somaDias(dia, 1)}T05:00:00-03:00`;
  const valorLido = parseValorBr(sp.valor ?? '');
  const valorTicket = valorLido != null && valorLido > 0 ? valorLido : 70;

  const doDia = sql`pi.filial_id = ${filial.id} AND pi.data_delete IS NULL
    AND pi.data_hora_cadastro >= ${ini}::timestamptz AND pi.data_hora_cadastro < ${fim}::timestamptz`;

  const [vendidos, cadastro] = await Promise.all([
    // Pratos lançados a 1 centavo no dia.
    q<{ cod: number | null; nome: string; qtd: number; contas: number; primeiro: string | null; ultimo: string | null }>(sql`
      SELECT pi.codigo_produto_externo AS cod,
             coalesce(max(pi.nome_produto), 'sem nome') AS nome,
             coalesce(sum(pi.quantidade), 0)::float8 AS qtd,
             count(DISTINCT pi.pedido_id)::int AS contas,
             to_char(min(pi.data_hora_cadastro) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS primeiro,
             to_char(max(pi.data_hora_cadastro) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS ultimo
        FROM pedido_item pi
       WHERE ${doDia}
         AND pi.valor_unitario > 0 AND pi.valor_unitario <= ${TETO_TICKET}
         AND pi.codigo_produto_externo IS NOT NULL
       GROUP BY 1
       ORDER BY 3 DESC
    `),
    // Pratos cadastrados a 1 centavo na casa (aparecem antes de sair o primeiro).
    q<{ cod: number; nome: string }>(sql`
      SELECT codigo_externo AS cod, nome
        FROM produto
       WHERE filial_id = ${filial.id} AND preco_venda > 0 AND preco_venda <= ${TETO_TICKET}
       ORDER BY nome
    `),
  ]);

  const veioDoForm = sp.sel === '1';
  const pedidos = (Array.isArray(sp.p) ? sp.p : sp.p ? [sp.p] : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  // Sem escolha feita: valem todos os pratos de 1 centavo que saíram no dia.
  const marcados = new Set<number>(
    veioDoForm || pedidos.length ? pedidos : vendidos.map((v) => Number(v.cod)),
  );

  const opcoes = new Map<number, { cod: number; nome: string; qtd: number; contas: number; primeiro: string | null; ultimo: string | null }>();
  for (const v of vendidos) {
    opcoes.set(Number(v.cod), { cod: Number(v.cod), nome: v.nome, qtd: v.qtd, contas: v.contas, primeiro: v.primeiro, ultimo: v.ultimo });
  }
  for (const c of cadastro) {
    if (!opcoes.has(Number(c.cod))) opcoes.set(Number(c.cod), { cod: Number(c.cod), nome: c.nome, qtd: 0, contas: 0, primeiro: null, ultimo: null });
  }
  const lista = [...opcoes.values()].sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));
  const doEvento = lista.filter((o) => marcados.has(o.cod));
  const codigos = doEvento.map((o) => o.cod);

  const [contas, porHora] = codigos.length
    ? await Promise.all([
        // Cada conta que teve prato do evento: quantos pratos e quanto ela soma no PDV.
        q<{ numero: number | null; cliente: string | null; aberta: boolean; pratos: number; total: number; hora: string | null }>(sql`
          SELECT p.numero,
                 p.nome_cliente AS cliente,
                 (p.data_fechamento IS NULL) AS aberta,
                 x.pratos::float8 AS pratos,
                 coalesce(p.valor_total, 0)::float8 AS total,
                 to_char(x.primeiro AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora
            FROM (
              SELECT pi.pedido_id, sum(pi.quantidade) AS pratos, min(pi.data_hora_cadastro) AS primeiro
                FROM pedido_item pi
               WHERE ${doDia}
                 AND pi.valor_unitario > 0 AND pi.valor_unitario <= ${TETO_TICKET}
                 AND pi.codigo_produto_externo IN ${codigos}
               GROUP BY 1
            ) x
            JOIN pedido p ON p.id = x.pedido_id
           WHERE p.data_delete IS NULL
           ORDER BY x.primeiro
        `),
        q<{ hora: number; pratos: number }>(sql`
          SELECT extract(hour FROM pi.data_hora_cadastro AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
                 coalesce(sum(pi.quantidade), 0)::float8 AS pratos
            FROM pedido_item pi
           WHERE ${doDia}
             AND pi.valor_unitario > 0 AND pi.valor_unitario <= ${TETO_TICKET}
             AND pi.codigo_produto_externo IN ${codigos}
           GROUP BY 1
           ORDER BY min(pi.data_hora_cadastro)
        `),
      ])
    : [[], []];

  const pratos = doEvento.reduce((s, o) => s + o.qtd, 0);
  const emTickets = pratos * valorTicket;
  const noPdv = contas.reduce((s, c) => s + c.total, 0);
  const abertas = contas.filter((c) => c.aberta).length;
  const maiorHora = Math.max(1, ...porHora.map((h) => h.pratos));

  const base = `/relatorios/evento?filialId=${filial.id}&valor=${valorTicket}${veioDoForm || pedidos.length ? `&sel=1${codigos.map((c) => `&p=${c}`).join('')}` : ''}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl space-y-5 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Evento: pratos de ticket</h1>
            <p className="mt-1 text-sm text-slate-500">
              {filial.nome} · {rotuloDia(dia)} — do dia às 05:00 até as 05:00 do dia seguinte
              {dia === emAndamento ? ' (em andamento)' : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={`${base}&dia=${somaDias(dia, -1)}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              ← Dia anterior
            </Link>
            {dia < emAndamento && (
              <Link
                href={`${base}&dia=${somaDias(dia, 1)}`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
              >
                Dia seguinte →
              </Link>
            )}
            <Link
              href={`${base}&dia=${dia}`}
              className="rounded-lg bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-700"
            >
              Atualizar
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI label="Pratos lançados" valor={int(pratos)} sub={`${int(contas.length)} ${contas.length === 1 ? 'conta' : 'contas'}`} />
          <KPI
            label={`Em tickets (× ${brl(valorTicket)})`}
            valor={brl(emTickets)}
            sub="a receber por fora"
            cor="text-emerald-700"
          />
          <KPI
            label="Bebidas e o resto no PDV"
            valor={brl(noPdv)}
            sub={abertas ? `${int(abertas)} ${abertas === 1 ? 'conta ainda aberta' : 'contas ainda abertas'}` : 'contas com prato do evento'}
          />
          <KPI label="Faturamento do evento" valor={brl(emTickets + noPdv)} sub="tickets + contas no PDV" />
        </div>

        <form action="/relatorios/evento" className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <input type="hidden" name="sel" value="1" />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Casa</span>
              <select
                name="filialId"
                defaultValue={filial.id}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
              >
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Dia</span>
              <input
                type="date"
                name="dia"
                defaultValue={dia}
                max={emAndamento}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Valor do ticket (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                name="valor"
                defaultValue={String(valorTicket).replace('.', ',')}
                className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
              />
            </label>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
              Ver
            </button>
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pratos de R$ 0,01 desta casa — marque os que são do evento
          </h3>
          {lista.length === 0 ? (
            <p className="mt-2 text-slate-500">Esta casa não tem prato cadastrado nem lançado a R$ 0,01 nesse dia.</p>
          ) : (
            <table className="mt-2 w-full text-left">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Prato</th>
                  <th className="py-1 pr-3 text-right font-medium">Saíram</th>
                  <th className="py-1 pr-3 text-right font-medium">Contas</th>
                  <th className="py-1 pr-3 font-medium">Primeiro / último</th>
                  <th className="py-1 text-right font-medium">Em tickets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((o) => {
                  const marcado = marcados.has(o.cod);
                  return (
                    <tr key={o.cod} className={marcado ? '' : 'text-slate-400'}>
                      <td className="py-1.5 pr-3">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="p" value={o.cod} defaultChecked={marcado} />
                          <span className={marcado ? 'font-medium text-slate-900' : ''}>{o.nome}</span>
                        </label>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{int(o.qtd)}</td>
                      <td className="py-1.5 pr-3 text-right">{o.contas ? int(o.contas) : '—'}</td>
                      <td className="py-1.5 pr-3">{o.primeiro ? `${o.primeiro} – ${o.ultimo}` : '—'}</td>
                      <td className="py-1.5 text-right">{marcado ? brl(o.qtd * valorTicket) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Sem marcar nada, contam todos os pratos de R$ 0,01 que saíram no dia. Prato cancelado não conta. O número vem
            do que a loja já mandou pra nuvem — pode levar alguns minutos depois do lançamento.
          </p>
        </form>

        {porHora.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pratos por hora</h3>
            <div className="mt-2 space-y-1">
              {porHora.map((h) => (
                <div key={h.hora} className="flex items-center gap-2">
                  <span className="w-10 text-slate-500">{String(h.hora).padStart(2, '0')}h</span>
                  <div className="h-3 rounded bg-emerald-500" style={{ width: `${Math.max(2, (h.pratos / maiorHora) * 70)}%` }} />
                  <span className="text-slate-700">{int(h.pratos)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {contas.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contas com prato do evento</h3>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Conta</th>
                    <th className="py-1 pr-3 font-medium">Primeiro prato</th>
                    <th className="py-1 pr-3 text-right font-medium">Pratos</th>
                    <th className="py-1 pr-3 text-right font-medium">Em tickets</th>
                    <th className="py-1 text-right font-medium">Conta no PDV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contas.map((c, i) => (
                    <tr key={`${c.numero}-${i}`}>
                      <td className="py-1.5 pr-3 font-medium text-slate-900">
                        {c.numero != null ? `nº ${c.numero}` : '—'}
                        {c.cliente ? <span className="font-normal text-slate-500"> · {c.cliente}</span> : null}
                        {c.aberta ? <span className="ml-2 text-xs font-normal text-amber-700">aberta</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-500">{c.hora ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right">{int(c.pratos)}</td>
                      <td className="py-1.5 pr-3 text-right">{brl(c.pratos * valorTicket)}</td>
                      <td className="py-1.5 text-right">{brl(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Conta no PDV é o total da conta (bebidas, outros itens e serviço), que o convidado paga na casa. O centavo
              de cada prato está dentro dele.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
