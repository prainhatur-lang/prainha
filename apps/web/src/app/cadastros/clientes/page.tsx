import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
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

// Chave de casamento entre Consumer e reservas: últimos 8 dígitos (número local,
// ignora DDI 55 / DDD). Suficiente pra unificar dentro de uma filial.
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

interface Unificado {
  nome: string;
  fone: string;
  cpf: string | null;
  saldo: number | null;
  reservas: number;
  ultima: string | null;
  canais: string[];
  preferencias: string | null;
  origem: 'ambos' | 'consumer' | 'reserva';
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
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
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

  // 1) Clientes cadastrados no Consumer (fiado / conta corrente)
  const consumer = await db
    .select({
      nome: schema.cliente.nome,
      cpf: schema.cliente.cpfOuCnpj,
      telefone: schema.cliente.telefone,
      saldo: schema.cliente.saldoAtualContaCorrente,
    })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, filialSelecionada.id),
        isNull(schema.cliente.dataDelete),
      ),
    );

  // 2) Clientes das reservas, agregados por telefone
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
    .where(
      and(
        eq(schema.reserva.filialId, filialSelecionada.id),
        sql`${schema.reserva.clienteTelefone} IS NOT NULL`,
      ),
    )
    .groupBy(schema.reserva.clienteTelefone);

  // 3) Unifica por telefone (últimos 8 dígitos). Consumer sem telefone fica como
  //    cadastro avulso (chave por CPF).
  const map = new Map<string, Unificado>();
  for (const c of consumer) {
    const d = soDigitos(c.telefone);
    const key = d ? chaveFone(d) : `cpf:${c.cpf ?? c.nome ?? Math.random()}`;
    map.set(key, {
      nome: c.nome?.trim() || 'Sem nome',
      fone: c.telefone ?? '',
      cpf: c.cpf ?? null,
      saldo: c.saldo != null ? Number(c.saldo) : null,
      reservas: 0,
      ultima: null,
      canais: [],
      preferencias: null,
      origem: 'consumer',
    });
  }
  for (const r of reservas) {
    const key = chaveFone(soDigitos(r.telefone));
    const canais = (r.canais ?? '').split(',').filter(Boolean);
    const ex = map.get(key);
    if (ex) {
      ex.reservas = Number(r.qtd);
      ex.ultima = r.ultima ?? null;
      ex.canais = canais;
      ex.preferencias = r.preferencias ?? null;
      ex.origem = 'ambos';
      if (!ex.nome || ex.nome === 'Sem nome') ex.nome = r.nome?.trim() || ex.nome;
      if (!ex.fone) ex.fone = r.telefone ?? '';
    } else {
      map.set(key, {
        nome: r.nome?.trim() || 'Sem nome',
        fone: r.telefone ?? '',
        cpf: null,
        saldo: null,
        reservas: Number(r.qtd),
        ultima: r.ultima ?? null,
        canais,
        preferencias: r.preferencias ?? null,
        origem: 'reserva',
      });
    }
  }

  let lista = [...map.values()];
  if (q) {
    const qlow = q.toLowerCase();
    lista = lista.filter(
      (c) =>
        c.nome.toLowerCase().includes(qlow) ||
        (qDigits.length > 0 && soDigitos(c.fone).includes(qDigits)) ||
        (c.cpf != null && qDigits.length > 0 && soDigitos(c.cpf).includes(qDigits)),
    );
  }
  // Ordena: quem reservou mais recentemente primeiro; depois por nome.
  lista.sort((a, b) => {
    if (a.ultima && b.ultima)
      return a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : a.nome.localeCompare(b.nome);
    if (a.ultima) return -1;
    if (b.ultima) return 1;
    return a.nome.localeCompare(b.nome);
  });

  const total = lista.length;
  const comReserva = lista.filter((c) => c.reservas > 0).length;
  const comFiado = lista.filter((c) => (c.saldo ?? 0) > 0).length;
  const pageItems = lista.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPag = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (q) qs.set('q', q);
    if (p > 0) qs.set('page', String(p));
    return `/cadastros/clientes?${qs.toString()}`;
  };

  const badge = (origem: Unificado['origem']) => {
    if (origem === 'ambos')
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Reserva + Cadastro</span>;
    if (origem === 'consumer')
      return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Cadastro (PDV)</span>;
    return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">Reserva</span>;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
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
                  f.id === filialSelecionada.id
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
          <input type="hidden" name="filialId" value={filialSelecionada.id} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome, telefone ou CPF..."
            className="w-80 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Buscar
          </button>
          {q && (
            <Link
              href={`/cadastros/clientes?filialId=${filialSelecionada.id}`}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Limpar
            </Link>
          )}
        </form>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Telefone</th>
                <th className="px-4 py-2">CPF/CNPJ</th>
                <th className="px-4 py-2 text-right">Reservas</th>
                <th className="px-4 py-2">Última</th>
                <th className="px-4 py-2 text-right">Fiado</th>
                <th className="px-4 py-2">Origem</th>
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
              {pageItems.map((c, i) => (
                <tr key={`${c.fone}-${i}`} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{c.nome}</div>
                    {c.preferencias && (
                      <div className="mt-0.5 text-xs text-slate-400">🍽️ {c.preferencias}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{fmtFone(c.fone)}</td>
                  <td className="px-4 py-2 text-slate-500">{c.cpf || '—'}</td>
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
                  <td className="px-4 py-2">{badge(c.origem)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPag > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              Página {page + 1} de {totalPag}
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
          Unifica o cadastro do PDV (Consumer) com quem já reservou, casando pelo telefone.
        </p>
      </section>
    </main>
  );
}
