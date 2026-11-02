// /saas/interessados — quem preencheu "Quero começar" no site /conheca.
// Só Admin. Um clique abre o WhatsApp da pessoa.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { desc } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { formatarDocumento } from '@/lib/nfce/documento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLANO: Record<string, string> = {
  gratis: 'Grátis',
  essencial: 'Essencial',
  gestao: 'Gestão',
  completo: 'Completo',
  consultoria: 'Consultoria',
  nao_sei: 'Não sabe ainda',
};

function quando(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function InteressadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/dashboard');

  const linhas = await db
    .select()
    .from(schema.saasInteressado)
    .orderBy(desc(schema.saasInteressado.criadoEm))
    .limit(300);

  const contas = await db
    .select()
    .from(schema.saasConta)
    .orderBy(desc(schema.saasConta.criadoEm))
    .limit(300);
  const hoje = hojeBr();
  const br = (ymd: string) => ymd.split('-').reverse().join('/');

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-xl font-bold">Interessados no sistema</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quem preencheu &quot;Quero começar&quot; em{' '}
          <a href="/conheca" target="_blank" className="text-teal-700 underline">
            /conheca
          </a>
          . {linhas.length} no total.
        </p>
        {contas.length > 0 && (
          <section className="mt-5">
            <h2 className="font-bold">Contas de teste (cadastro sozinho) · {contas.length}</h2>
            <p className="text-sm text-slate-600">
              Teste de 15 dias com todos os módulos. A loja ainda é criada por nós: chame no WhatsApp e mande o acesso.
            </p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Quando</th>
                    <th className="px-3 py-2">Restaurante</th>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Responsável</th>
                    <th className="px-3 py-2">Teste</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {contas.map((c) => {
                    const fone = c.whatsapp.replace(/\D/g, '');
                    const zap = fone.length <= 11 ? `55${fone}` : fone;
                    const vencido = c.status === 'teste' && c.testeFim < hoje;
                    return (
                      <tr key={c.id} className="border-t border-slate-100 align-top">
                        <td className="whitespace-nowrap px-3 py-2">{quando(c.criadoEm)}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">{c.nomeFantasia}</div>
                          {c.razaoSocial && c.razaoSocial !== c.nomeFantasia && (
                            <div className="text-slate-500">{c.razaoSocial}</div>
                          )}
                          {(c.cidade || c.uf) && (
                            <div className="text-slate-500">{[c.cidade, c.uf].filter(Boolean).join(' - ')}</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {c.tipoDocumento} {formatarDocumento(c.documento)}
                        </td>
                        <td className="px-3 py-2">
                          <div>{c.responsavel}</div>
                          <div className="text-slate-500">{c.whatsapp}</div>
                          <div className="text-slate-500">{c.email}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className={vencido ? 'font-semibold text-red-700' : ''}>
                            {vencido ? 'venceu ' : c.status === 'teste' ? 'até ' : `${c.status} · `}
                            {br(c.testeFim)}
                          </span>
                          <div className="text-slate-500">{PLANO[c.planoDesejado ?? ''] ?? '—'}</div>
                          <div className={c.filialId ? 'text-emerald-700' : 'text-amber-700'}>
                            {c.filialId ? '✓ loja criada' : 'loja à mão'}
                          </div>
                          {c.observacao && <div className="max-w-[220px] whitespace-normal text-xs text-red-700">{c.observacao}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={`https://wa.me/${zap}`}
                            target="_blank"
                            className="whitespace-nowrap rounded bg-green-600 px-3 py-1.5 text-white hover:bg-green-700"
                          >
                            WhatsApp
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h2 className="mt-6 font-bold">Todos os interessados</h2>
          </section>
        )}
        {linhas.length === 0 ? (
          <p className="mt-6 rounded-lg bg-slate-50 p-4 text-slate-600">Ninguém ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2">Pessoa</th>
                  <th className="px-3 py-2">Restaurante</th>
                  <th className="px-3 py-2">Plano</th>
                  <th className="px-3 py-2">Maq.</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const fone = l.whatsapp.replace(/\D/g, '');
                  const zap = fone.length <= 11 ? `55${fone}` : fone;
                  return (
                    <tr key={l.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2">{quando(l.criadoEm)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{l.nome}</div>
                        <div className="text-slate-500">{l.whatsapp}</div>
                        {l.email && <div className="text-slate-500">{l.email}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {l.estabelecimento || '—'}
                        {l.cidade && <div className="text-slate-500">{l.cidade}</div>}
                        {l.mensagem && <div className="mt-1 max-w-xs text-xs text-slate-600">{l.mensagem}</div>}
                      </td>
                      <td className="px-3 py-2">{PLANO[l.plano ?? ''] ?? l.plano ?? '—'}</td>
                      <td className="px-3 py-2">{l.maquininhas ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{l.origem ?? '—'}</td>
                      <td className="px-3 py-2">
                        <a
                          href={`https://wa.me/${zap}`}
                          target="_blank"
                          className="whitespace-nowrap rounded bg-green-600 px-3 py-1.5 text-white hover:bg-green-700"
                        >
                          WhatsApp
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
