import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';

export const dynamic = 'force-dynamic';

const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');
function last8(digits: string): string {
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
const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', confirmada: 'Confirmada', sentada: 'Sentada',
  cancelada: 'Cancelada', no_show: 'Não compareceu', concluida: 'Concluída',
};

interface SP {
  filialId?: string;
}

export default async function ClienteDetalhe(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'reserva.read');

  const { id } = await props.params;
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Filial não encontrada.</p>
      </main>
    );
  }

  const decoded = decodeURIComponent(id);
  const isEmail = decoded.startsWith('e:');
  const emailKey = isEmail ? decoded.slice(2).toLowerCase() : null;
  const foneKey = isEmail ? null : last8(soDigitos(decoded));

  const fid = filial.id;
  const voltarHref = `/cadastros/clientes?filialId=${fid}`;

  // Casamento por ultimos 8 digitos do telefone (ou e-mail).
  const matchContato = isEmail
    ? sql`lower(${schema.clienteContato.email}) = ${emailKey}`
    : sql`right(regexp_replace(coalesce(${schema.clienteContato.telefone}, ''), '[^0-9]', '', 'g'), 8) = ${foneKey}`;
  const matchCliente = isEmail
    ? sql`lower(${schema.cliente.email}) = ${emailKey}`
    : sql`right(regexp_replace(coalesce(${schema.cliente.telefone}, ''), '[^0-9]', '', 'g'), 8) = ${foneKey}`;
  const matchReserva = isEmail
    ? sql`false`
    : sql`right(regexp_replace(coalesce(${schema.reserva.clienteTelefone}, ''), '[^0-9]', '', 'g'), 8) = ${foneKey}`;

  const [contato] = await db
    .select()
    .from(schema.clienteContato)
    .where(and(eq(schema.clienteContato.filialId, fid), matchContato))
    .limit(1);

  let [cadastro] = await db
    .select()
    .from(schema.cliente)
    .where(and(eq(schema.cliente.filialId, fid), matchCliente))
    .limit(1);

  // ⚠️ CASAR SÓ PELO TELEFONE ESCONDE DÍVIDA. O cadastro do Consumer muitas
  // vezes não tem telefone (o Marco Pinheiro devia R$ 15.364,59 e a tela dizia
  // "Sem saldo", porque o telefone dele lá está vazio). Sem achar, tenta pelo
  // NOME exato — e, quando é assim, a tela avisa que foi por nome, porque
  // nome bate errado mais fácil que telefone.
  let casadoPorNome = false;
  if (!cadastro) {
    const nomeBusca = (contato?.nome || '').trim();
    if (nomeBusca.length >= 6) {
      const [porNome] = await db
        .select()
        .from(schema.cliente)
        .where(and(
          eq(schema.cliente.filialId, fid),
          sql`lower(unaccent(coalesce(${schema.cliente.nome}, ''))) = lower(unaccent(${nomeBusca}))`,
        ))
        .limit(1);
      if (porNome) { cadastro = porNome; casadoPorNome = true; }
    }
  }

  const reservas = await db
    .select({
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      area: schema.reserva.area,
      mesa: schema.reserva.mesa,
      pessoas: schema.reserva.pessoas,
      status: schema.reserva.status,
      canal: schema.reserva.canal,
      observacao: schema.reserva.observacao,
      nome: schema.reserva.clienteNome,
      telefone: schema.reserva.clienteTelefone,
      preferencias: schema.reserva.preferencias,
    })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.filialId, fid), matchReserva))
    .orderBy(desc(schema.reserva.data))
    .limit(200);

  if (!contato && !cadastro && reservas.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-6 py-10">
          <Link href={voltarHref} className="text-sm text-slate-500 hover:text-slate-700">
            ← Voltar para Clientes
          </Link>
          <p className="mt-6 text-sm text-slate-500">Cliente não encontrado.</p>
        </section>
      </main>
    );
  }

  const nome =
    [contato?.nome, contato?.sobrenome].filter(Boolean).join(' ').trim() ||
    cadastro?.nome ||
    reservas[0]?.nome ||
    'Sem nome';
  const telefone = contato?.telefone || cadastro?.telefone || reservas[0]?.telefone || '';
  const email = contato?.email || cadastro?.email || null;
  const cpf = cadastro?.cpfOuCnpj || null;
  const saldo = cadastro?.saldoAtualContaCorrente != null ? Number(cadastro.saldoAtualContaCorrente) : null;
  const preferencias = reservas.find((r) => r.preferencias)?.preferencias || null;
  const foneDig = soDigitos(telefone);

  const fontes: string[] = [];
  if (reservas.length > 0) fontes.push('Reserva');
  if (cadastro) fontes.push('Cadastro (PDV)');
  if (contato) fontes.push('Importado pelo Tagme');

  const Info = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{value || '—'}</div>
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-3xl px-6 py-8">
        <Link href={voltarHref} className="text-sm text-slate-500 hover:text-slate-700">
          ← Voltar para Clientes
        </Link>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-medium text-white">
                {nome.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{nome}</h1>
                <div className="mt-1 flex flex-wrap gap-1">
                  {fontes.map((f) => (
                    <span key={f} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {cadastro ? (
                <Link
                  href={`/cadastros/clientes/editar/${cadastro.id}`}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Editar cadastro
                </Link>
              ) : (
                // Sem cadastro no PDV não havia saída nenhuma nesta tela: nem
                // editar, nem criar. Quem quisesse dar limite de fiado a este
                // cliente não tinha por onde começar.
                <Link
                  href={`/cadastros/clientes/novo?filialId=${fid}`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  title="este contato ainda não tem cadastro no PDV (é onde mora o limite de fiado)"
                >
                  + Criar cadastro no PDV
                </Link>
              )}
              {foneDig && (
                <a
                  href={`https://wa.me/${foneDig.length <= 11 ? '55' + foneDig : foneDig}`}
                  target="_blank"
                  rel="noopener"
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100"
                >
                  WhatsApp
                </a>
              )}
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  E-mail
                </a>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-5 border-t border-slate-100 pt-5 sm:grid-cols-3">
            <Info label="Telefone" value={fmtFone(telefone)} />
            <Info label="E-mail" value={email} />
            <Info label="CPF/CNPJ" value={cpf} />
            <Info label="Aniversário" value={contato?.dataAniversario} />
            <Info label="Gênero" value={contato?.genero} />
            <Info label="Pontos de fidelidade" value={contato?.pontosFidelidade ?? null} />
            <Info
              label="Fiado (conta corrente)"
              value={
                !cadastro ? (
                  // NUNCA dizer "sem saldo" sem ter achado a conta: é a mesma
                  // frase de quem não deve nada, e já escondeu R$ 15 mil.
                  <span className="text-slate-500">não identificado no PDV</span>
                ) : saldo != null && saldo !== 0 ? (
                  <Link
                    href={`/financeiro/receber/${cadastro.id}`}
                    className={saldo > 0 ? 'font-medium text-rose-600 hover:underline' : 'hover:underline'}
                  >
                    {brl(saldo)} ▸
                  </Link>
                ) : (
                  'Sem saldo'
                )
              }
            />
            {casadoPorNome && (
              <div className="col-span-full -mt-2 text-[11px] text-amber-700">
                ⚠ conta do PDV encontrada pelo <b>nome</b> (o cadastro de lá está sem telefone) —
                confira se é a mesma pessoa antes de usar o saldo
              </div>
            )}
            <Info
              label="Reservas (concilia)"
              value={reservas.length > 0 ? String(reservas.length) : '—'}
            />
            <Info
              label="Histórico Tagme"
              value={
                contato
                  ? `${contato.reservasHistorico ?? 0} reservas · ${contato.filasEsperaHistorico ?? 0} filas`
                  : null
              }
            />
          </div>

          {preferencias && (
            <div className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">Preferências:</span> {preferencias}
            </div>
          )}
          {contato?.detalhes && (
            <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-medium">Detalhes (Tagme):</span> {contato.detalhes}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">
            Reservas no concilia {reservas.length > 0 ? `(${reservas.length})` : ''}
          </h2>
          {reservas.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              Nenhuma reserva registrada no concilia ainda
              {contato ? ' (as reservas anteriores ficaram no Tagme).' : '.'}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-2 pr-4">Data</th>
                    <th className="py-2 pr-4">Hora</th>
                    <th className="py-2 pr-4">Área / Mesa</th>
                    <th className="py-2 pr-4 text-right">Pessoas</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Canal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reservas.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 text-slate-700">{fmtData(r.data)}</td>
                      <td className="py-2 pr-4 text-slate-600">{r.hora}</td>
                      <td className="py-2 pr-4 text-slate-600">
                        {[r.area, r.mesa].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-600">{r.pessoas}</td>
                      <td className="py-2 pr-4 text-slate-600">{STATUS_LABEL[r.status] ?? r.status}</td>
                      <td className="py-2 text-slate-500">{r.canal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
