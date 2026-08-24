import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { normalizaBusca } from '@/lib/texto';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface SP {
  filialId?: string;
  q?: string;
  page?: string;
}

const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');

// Chave de casamento entre as fontes: últimos 8 dígitos do telefone (número
// local, ignora DDI 55 / DDD). Suficiente pra unificar dentro de uma filial.
function chaveFone(digits: string): string {
  let x = digits;
  if (x.length > 11 && x.startsWith('55')) x = x.slice(2);
  return x.length >= 8 ? x.slice(-8) : x;
}

function fmtFone(s?: string | null): string {
  let d = soDigitos(s);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return s?.trim() || '—';
}

function fmtData(s?: string | null): string {
  if (!s) return '—';
  const t = String(s).slice(0, 10);
  const [y, m, d] = t.split('-');
  return d ? `${d}/${m}/${y}` : t;
}

type Fonte = 'consumer' | 'reserva' | 'tagme';

interface Unificado {
  nome: string;
  fone: string;
  email: string | null;
  cpf: string | null;
  saldo: number | null;
  reservas: number; // reservas no concilia (tabela reserva)
  ultima: string | null;
  reservasTagme: number; // histórico do Tagme
  aniversario: string | null;
  canais: string[];
  preferencias: string | null;
  fontes: Set<Fonte>;
  /** id do cadastro do PDV (tabela cliente) — porta de entrada da edição
   *  quando o cliente não tem telefone nem e-mail pra rota unificada. */
  clienteId: string | null;
}

export default async function ClientesPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'reserva.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    await escolherFilial(filiais, sp.filialId);
  const q = (sp.q ?? '').trim();
  const qDigits = soDigitos(q);
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const fid = filialSelecionada.id;

  // 1) Cadastro do PDV (Consumer) — fiado / conta corrente
  const consumer = await db
    .select({
      id: schema.cliente.id,
      nome: schema.cliente.nome,
      cpf: schema.cliente.cpfOuCnpj,
      // celular primeiro: é onde o form "Celular/WhatsApp" grava — sem ele o
      // cliente editado continuava aparecendo sem telefone na lista
      telefone: sql<string | null>`coalesce(${schema.cliente.celular}, ${schema.cliente.telefone})`,
      email: schema.cliente.email,
      saldo: schema.cliente.saldoAtualContaCorrente,
    })
    .from(schema.cliente)
    .where(and(eq(schema.cliente.filialId, fid), isNull(schema.cliente.dataDelete)));

  // 2) Reservas do concilia, agregadas por telefone
  const reservas = await db
    .select({
      telefone: schema.reserva.clienteTelefone,
      qtd: count(),
      ultima: sql<string>`max(${schema.reserva.data})`,
      nome: sql<string>`(array_agg(${schema.reserva.clienteNome} ORDER BY ${schema.reserva.data} DESC))[1]`,
      canais: sql<string>`string_agg(DISTINCT ${schema.reserva.canal}, ',')`,
      preferencias: sql<string | null>`max(${schema.reserva.preferencias})`,
    })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.filialId, fid), sql`${schema.reserva.clienteTelefone} IS NOT NULL`))
    .groupBy(schema.reserva.clienteTelefone);

  // 3) Contatos importados (ex: Tagme)
  const contatos = await db
    .select({
      nome: schema.clienteContato.nome,
      sobrenome: schema.clienteContato.sobrenome,
      telefone: schema.clienteContato.telefone,
      email: schema.clienteContato.email,
      aniversario: schema.clienteContato.dataAniversario,
      reservasH: schema.clienteContato.reservasHistorico,
    })
    .from(schema.clienteContato)
    .where(eq(schema.clienteContato.filialId, fid));

  // --- Unificação por telefone (fallback: e-mail / cpf) ---
  const map = new Map<string, Unificado>();
  let seq = 0;
  const chave = (fone?: string | null, email?: string | null, cpf?: string | null) => {
    const d = soDigitos(fone);
    if (d) return `f:${chaveFone(d)}`;
    if (email) return `e:${email.toLowerCase()}`;
    if (cpf) return `c:${soDigitos(cpf)}`;
    return `x:${++seq}`;
  };
  const novo = (): Unificado => ({
    nome: '', fone: '', email: null, cpf: null, saldo: null, reservas: 0,
    ultima: null, reservasTagme: 0, aniversario: null, canais: [], preferencias: null,
    fontes: new Set(), clienteId: null,
  });

  for (const c of consumer) {
    const k = chave(c.telefone, c.email, c.cpf);
    const u = map.get(k) ?? novo();
    u.fontes.add('consumer');
    if (!u.clienteId) u.clienteId = c.id;
    if (!u.nome) u.nome = c.nome?.trim() || '';
    if (!u.fone) u.fone = c.telefone ?? '';
    if (!u.email) u.email = c.email ?? null;
    if (!u.cpf) u.cpf = c.cpf ?? null;
    if (c.saldo != null) u.saldo = Number(c.saldo);
    map.set(k, u);
  }
  for (const r of reservas) {
    const k = chave(r.telefone);
    const u = map.get(k) ?? novo();
    u.fontes.add('reserva');
    u.reservas = Number(r.qtd);
    u.ultima = r.ultima ?? null;
    u.canais = (r.canais ?? '').split(',').filter(Boolean);
    if (!u.preferencias) u.preferencias = r.preferencias ?? null;
    if (!u.nome) u.nome = r.nome?.trim() || '';
    if (!u.fone) u.fone = r.telefone ?? '';
    map.set(k, u);
  }
  for (const ct of contatos) {
    const k = chave(ct.telefone, ct.email);
    const u = map.get(k) ?? novo();
    u.fontes.add('tagme');
    u.reservasTagme = Number(ct.reservasH ?? 0);
    if (!u.aniversario) u.aniversario = ct.aniversario ?? null;
    if (!u.email) u.email = ct.email ?? null;
    if (!u.fone) u.fone = ct.telefone ?? '';
    if (!u.nome) u.nome = [ct.nome, ct.sobrenome].filter(Boolean).join(' ').trim();
    map.set(k, u);
  }

  let lista = [...map.values()];
  for (const u of lista) if (!u.nome) u.nome = 'Sem nome';

  if (q) {
    const qlow = normalizaBusca(q);
    lista = lista.filter(
      (c) =>
        normalizaBusca(c.nome).includes(qlow) ||
        (c.email != null && normalizaBusca(c.email).includes(qlow)) ||
        (qDigits.length > 0 && soDigitos(c.fone).includes(qDigits)) ||
        (c.cpf != null && qDigits.length > 0 && soDigitos(c.cpf).includes(qDigits)),
    );
  }
  // Ordena: quem reservou no concilia primeiro (mais recente), depois mais
  // histórico no Tagme, depois nome.
  lista.sort((a, b) => {
    if (a.ultima && b.ultima && a.ultima !== b.ultima) return a.ultima < b.ultima ? 1 : -1;
    if (a.ultima && !b.ultima) return -1;
    if (b.ultima && !a.ultima) return 1;
    if (b.reservasTagme !== a.reservasTagme) return b.reservasTagme - a.reservasTagme;
    return a.nome.localeCompare(b.nome);
  });

  const total = lista.length;
  const comReserva = lista.filter((c) => c.reservas > 0).length;
  const comFiado = lista.filter((c) => (c.saldo ?? 0) > 0).length;
  const pageItems = lista.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPag = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', fid);
    if (q) qs.set('q', q);
    if (p > 0) qs.set('page', String(p));
    return `/cadastros/clientes?${qs.toString()}`;
  };

  const chip = (txt: string, cls: string) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{txt}</span>
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <Link
            href={`/cadastros/clientes/novo?filialId=${filialSelecionada.id}`}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + Novo cliente
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {int(total)} cliente(s) na {filialSelecionada.nome} · {int(comReserva)} já reservaram
          {comFiado > 0 ? ` · ${int(comFiado)} com fiado em aberto` : ''}.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/clientes?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === fid
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <form method="GET" className="mt-4 flex items-center gap-2">
          <input type="hidden" name="filialId" value={fid} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome, telefone, e-mail ou CPF..."
            className="w-96 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Buscar
          </button>
          {q && (
            <Link
              href={`/cadastros/clientes?filialId=${fid}`}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Limpar
            </Link>
          )}
        </form>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Telefone</th>
                <th className="px-4 py-2">E-mail</th>
                <th className="px-4 py-2 text-right">Reservas</th>
                <th className="px-4 py-2">Última</th>
                <th className="px-4 py-2 text-right">Fiado</th>
                <th className="px-4 py-2">Tipo de cliente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
              {pageItems.map((c, i) => {
                const dig = soDigitos(c.fone);
                // Sem telefone nem e-mail não existe rota unificada — mas se o
                // cadastro veio do PDV, dá pra ir direto na edição pelo id
                // (era exatamente o caso "não consigo alterar o cliente":
                // cadastro só com nome/CPF ficava sem link nenhum).
                const href = dig
                  ? `/cadastros/clientes/${dig}?filialId=${fid}`
                  : c.email
                    ? `/cadastros/clientes/e:${encodeURIComponent(c.email)}?filialId=${fid}`
                    : c.clienteId
                      ? `/cadastros/clientes/editar/${c.clienteId}`
                      : null;
                return (
                <tr key={`${c.fone}-${i}`} className="align-top hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    {href ? (
                      <Link href={href} className="font-medium text-sky-700 hover:underline">
                        {c.nome}
                      </Link>
                    ) : (
                      <div className="font-medium text-slate-800">{c.nome}</div>
                    )}
                    {c.preferencias && (
                      <div className="mt-0.5 text-xs text-slate-400">🍽️ {c.preferencias}</div>
                    )}
                    {(c.aniversario || c.reservasTagme > 0) && (
                      <div className="mt-0.5 text-xs text-slate-400">
                        {c.aniversario ? `🎂 ${c.aniversario}` : ''}
                        {c.aniversario && c.reservasTagme > 0 ? ' · ' : ''}
                        {c.reservasTagme > 0 ? `📋 ${int(c.reservasTagme)} no Tagme` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{fmtFone(c.fone)}</td>
                  <td className="px-4 py-2 text-slate-500">{c.email || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">
                    {c.reservas > 0 ? int(c.reservas) : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{fmtData(c.ultima)}</td>
                  <td
                    className={`px-4 py-2 text-right ${
                      (c.saldo ?? 0) > 0 ? 'font-medium text-rose-600' : 'text-slate-400'
                    }`}
                  >
                    {c.saldo != null && c.saldo !== 0 ? brl(c.saldo) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.fontes.has('reserva') && chip('Reserva', 'bg-sky-100 text-sky-700')}
                      {c.fontes.has('consumer') && chip('Cadastro (PDV)', 'bg-amber-100 text-amber-700')}
                      {c.fontes.has('tagme') && chip('Importado pelo Tagme', 'bg-emerald-100 text-emerald-700')}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPag > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              Página {page + 1} de {int(totalPag)}
            </span>
            <div className="flex gap-2">
              {page > 0 && (
                <Link
                  href={hrefPag(page - 1)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  ← Anterior
                </Link>
              )}
              {page + 1 < totalPag && (
                <Link
                  href={hrefPag(page + 1)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  Próxima →
                </Link>
              )}
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-400">
          Unifica o cadastro do PDV (Consumer), as reservas do concilia e os contatos
          importados (Tagme), casando pelo telefone.
        </p>
      </section>
    </main>
  );
}
