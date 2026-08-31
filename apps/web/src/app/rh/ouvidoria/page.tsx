// /rh/ouvidoria — painel de triagem. Lista SEM nome nenhum (não existe no
// schema — ver contrato de anonimato em packages/db/src/schema/escuta.ts).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { QrSvg } from '@/components/qr-svg';
import { db, schema } from '@concilia/db';
import { and, desc, eq } from 'drizzle-orm';
import { TriagemItem } from './triagem-item';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  categoria?: string;
  status?: string;
}

const CATEGORIA_LABEL: Record<string, string> = {
  assedio: '🚨 Assédio',
  seguranca: '⚠️ Segurança',
  gestao: '👔 Gestão / liderança',
  condicoes: '🏚️ Condições de trabalho',
  sugestao: '💡 Sugestão',
  outro: '📋 Outro',
};

const STATUS_COR: Record<string, string> = {
  nova: 'bg-sky-50 text-sky-700 border-sky-200',
  lida: 'bg-slate-100 text-slate-600 border-slate-200',
  em_apuracao: 'bg-amber-50 text-amber-700 border-amber-200',
  resolvida: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  descartada: 'bg-slate-50 text-slate-400 border-slate-200',
};

function fmtData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export default async function OuvidoriaPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'ouvidoria.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-4xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const condicoes = [eq(schema.ouvidoriaMensagem.filialId, filial.id)];
  if (sp.categoria) condicoes.push(eq(schema.ouvidoriaMensagem.categoria, sp.categoria));
  if (sp.status) condicoes.push(eq(schema.ouvidoriaMensagem.status, sp.status));

  const [mensagens, [filialToken]] = await Promise.all([
    db
      .select()
      .from(schema.ouvidoriaMensagem)
      .where(and(...condicoes))
      .orderBy(desc(schema.ouvidoriaMensagem.recebidaEm)),
    db.select({ ouvidoriaToken: schema.filial.ouvidoriaToken }).from(schema.filial).where(eq(schema.filial.id, filial.id)),
  ]);

  const h = await headers();
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const linkCanal = filialToken?.ouvidoriaToken ? `${base}/canal/${filialToken.ouvidoriaToken}` : null;

  const paramsBase = (overrides: Partial<SP>) => {
    const p = new URLSearchParams();
    p.set('filialId', filial.id);
    const merged = { categoria: sp.categoria, status: sp.status, ...overrides };
    if (merged.categoria) p.set('categoria', merged.categoria);
    if (merged.status) p.set('status', merged.status);
    return p.toString();
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Ouvidoria</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · mensagens anônimas — nunca sabemos quem enviou
          </p>
        </div>

        <div className="mb-5 space-y-2">
          {filiais.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Filial:</span>
              {filiais.map((f) => (
                <Link
                  key={f.id}
                  href={`/rh/ouvidoria?${paramsBase({})}&filialId=${f.id}`}
                  className={`rounded-md border px-3 py-1 text-xs ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {f.nome}
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Categoria:</span>
            <Link href={`/rh/ouvidoria?${paramsBase({ categoria: undefined })}`} className={`rounded-md border px-2.5 py-1 text-xs ${!sp.categoria ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              Todas
            </Link>
            {Object.entries(CATEGORIA_LABEL).map(([valor, label]) => (
              <Link
                key={valor}
                href={`/rh/ouvidoria?${paramsBase({ categoria: valor })}`}
                className={`rounded-md border px-2.5 py-1 text-xs ${sp.categoria === valor ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Status:</span>
            <Link href={`/rh/ouvidoria?${paramsBase({ status: undefined })}`} className={`rounded-md border px-2.5 py-1 text-xs ${!sp.status ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              Todos
            </Link>
            {Object.keys(STATUS_COR).map((s) => (
              <Link
                key={s}
                href={`/rh/ouvidoria?${paramsBase({ status: s })}`}
                className={`rounded-md border px-2.5 py-1 text-xs ${sp.status === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {linkCanal && (
          <details className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">📱 QR / link do canal</summary>
            <div className="mt-3 flex items-center gap-4">
              <QrSvg content={linkCanal} size={130} />
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-[10px] text-slate-500">{linkCanal}</p>
                <p className="mt-2 text-[11px] text-slate-400">
                  Imprima num cartaz A4 numa área só de funcionário (vestiário, corredor da
                  cozinha) — nunca por WhatsApp, isso deixaria rastro de quem recebeu.
                </p>
              </div>
            </div>
          </details>
        )}

        {mensagens.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Nenhuma mensagem {sp.categoria || sp.status ? 'com esses filtros' : 'ainda'}.
          </div>
        ) : (
          <div className="space-y-3">
            {mensagens.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">{CATEGORIA_LABEL[m.categoria] ?? m.categoria}</span>
                    <span className="text-xs text-slate-400">{fmtData(m.recebidaEm)}</span>
                  </div>
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COR[m.status] ?? ''}`}>
                    {m.status}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{m.mensagem}</p>
                <TriagemItem id={m.id} status={m.status} observacaoInicial={m.observacaoInterna} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
