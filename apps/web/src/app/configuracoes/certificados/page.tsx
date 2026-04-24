import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { CertificadoUploadForm } from './upload-form';
import { ConsultarSefazBtn } from './consultar-sefaz-btn';

export const dynamic = 'force-dynamic';

function formataData(d: string | null): string {
  if (!d) return '—';
  return d.split('-').reverse().join('/');
}

function formataDataHora(d: Date | null): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(dt);
}

function diasAteFim(validadeFim: string | null): number | null {
  if (!validadeFim) return null;
  const hoje = new Date();
  const fim = new Date(validadeFim + 'T00:00:00');
  return Math.floor((fim.getTime() - hoje.getTime()) / 86_400_000);
}

export default async function CertificadosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);

  const certificados = filialIds.length
    ? await db
        .select({
          id: schema.certificadoFilial.id,
          filialId: schema.certificadoFilial.filialId,
          cnpj: schema.certificadoFilial.cnpjCertificado,
          cn: schema.certificadoFilial.cn,
          validadeInicio: schema.certificadoFilial.validadeInicio,
          validadeFim: schema.certificadoFilial.validadeFim,
          nomeArquivo: schema.certificadoFilial.nomeArquivo,
          ativo: schema.certificadoFilial.ativo,
          uploadadoEm: schema.certificadoFilial.uploadadoEm,
          ultimaConsultaSefaz: schema.certificadoFilial.ultimaConsultaSefaz,
        })
        .from(schema.certificadoFilial)
        .where(inArray(schema.certificadoFilial.filialId, filialIds))
        .orderBy(desc(schema.certificadoFilial.uploadadoEm))
    : [];

  const filialMap = new Map(filiais.map((f) => [f.id, f]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Certificados A1</h1>
        <p className="mt-1 text-sm text-slate-600">
          Certificados digitais A1 (.pfx) usados pra consultar SEFAZ automaticamente.
          Um certificado ativo por filial. Usado pra manifestação de NF-e e distribuição DF-e.
        </p>

        <div className="mt-6">
          <CertificadoUploadForm
            filiais={filiais.map((f) => ({ id: f.id, nome: f.nome, role: f.role }))}
          />
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">Certificados cadastrados</h2>
          {certificados.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
              Nenhum certificado ainda. Faça o upload acima.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {certificados.map((c) => {
                const f = filialMap.get(c.filialId);
                const dias = diasAteFim(c.validadeFim);
                const expirado = dias != null && dias < 0;
                const expirando = dias != null && dias >= 0 && dias <= 30;
                return (
                  <div
                    key={c.id}
                    className={`rounded-xl border p-4 shadow-sm ${
                      !c.ativo
                        ? 'border-slate-200 bg-slate-50 opacity-60'
                        : expirado
                          ? 'border-rose-300 bg-rose-50'
                          : expirando
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-emerald-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {f?.nome ?? 'Filial'}
                          </h3>
                          {c.ativo ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                              ATIVO
                            </span>
                          ) : (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                              INATIVO
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-700">{c.cn ?? '—'}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-600">
                          CNPJ: {c.cnpj ?? '—'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Arquivo: {c.nomeArquivo ?? '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
                          Validade
                        </p>
                        <p className="text-sm font-semibold text-slate-900">
                          {formataData(c.validadeFim)}
                        </p>
                        {dias != null && (
                          <p
                            className={`text-[11px] font-medium ${
                              expirado
                                ? 'text-rose-700'
                                : expirando
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {expirado
                              ? `⚠ Expirado há ${Math.abs(dias)} dia(s)`
                              : dias === 0
                                ? 'Expira hoje'
                                : `${dias} dia(s) restante(s)`}
                          </p>
                        )}
                      </div>
                    </div>
                    {c.ativo && !expirado && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                        <div className="text-[11px] text-slate-600">
                          <p>
                            <span className="font-medium text-slate-700">
                              Última consulta SEFAZ:
                            </span>{' '}
                            {formataDataHora(c.ultimaConsultaSefaz)}
                          </p>
                        </div>
                        <ConsultarSefazBtn filialId={c.filialId} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!process.env.CERTIFICATE_SECRET && (
          <div className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
            <p className="font-semibold">⚠ Variável de ambiente pendente</p>
            <p className="mt-1">
              Pra criptografar senhas de certificado, adicione no Vercel a env var{' '}
              <code className="rounded bg-amber-100 px-1">CERTIFICATE_SECRET</code> com uma string
              aleatória forte (32+ chars). Sem isso, o upload vai falhar no momento de cifrar.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
