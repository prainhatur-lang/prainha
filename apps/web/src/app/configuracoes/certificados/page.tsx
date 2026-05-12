import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { CertificadoUploadForm } from './upload-form';
import { ConsultarSefazBtn } from './consultar-sefaz-btn';
import { ToggleCompartilharBtn } from './toggle-compartilhar';
import { ManifestarBtn } from './manifestar-btn';

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
   await exigirPerm(user.id, 'configuracao.certificado');

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
          compartilharOrganizacao: schema.certificadoFilial.compartilharOrganizacao,
        })
        .from(schema.certificadoFilial)
        .where(inArray(schema.certificadoFilial.filialId, filialIds))
        .orderBy(desc(schema.certificadoFilial.uploadadoEm))
    : [];

  const filialMap = new Map(filiais.map((f) => [f.id, f]));

  // Carrega flag de pausada por filial (loja fechada temporariamente)
  const pausadasRows = filialIds.length
    ? await db
        .select({
          id: schema.filial.id,
          pausadaEm: schema.filial.pausadaEm,
          pausadaMotivo: schema.filial.pausadaMotivo,
        })
        .from(schema.filial)
        .where(inArray(schema.filial.id, filialIds))
    : [];
  const pausadaPorFilial = new Map(pausadasRows.map((p) => [p.id, p]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Certificados A1</h1>
        <p className="mt-1 text-sm text-slate-600">
          Certificados digitais A1 (.pfx) usados pra consultar SEFAZ automaticamente.
          Manifestação de NF-e + distribuição DF-e (puxa XMLs emitidos contra seu CNPJ a cada 12h).
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Cert da matriz pode ser <strong>compartilhado</strong> com todas as filiais da mesma
          organização (mesmo CNPJ raiz) — basta marcar o checkbox no upload abaixo. Não precisa
          replicar o mesmo .pfx em cada filial.
        </p>

        <div className="mt-6">
          <CertificadoUploadForm
            filiais={filiais.map((f) => ({ id: f.id, nome: f.nome, role: f.role }))}
          />
        </div>

        {/* Status de cobertura por filial */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">Cobertura por filial</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Filiais que conseguem (ou não) consultar SEFAZ atualmente.
          </p>
          <div className="mt-3 space-y-1">
            {filiais.map((f) => {
              const pausada = pausadaPorFilial.get(f.id);
              const estaPausada = !!pausada?.pausadaEm;
              const certPropro = certificados.find(
                (c) => c.filialId === f.id && c.ativo,
              );
              const certCompartilhado = certificados.find(
                (c) => c.compartilharOrganizacao && c.ativo && c.filialId !== f.id,
              );
              const cobertaPor = certPropro
                ? { tipo: 'propria' as const, cert: certPropro }
                : certCompartilhado
                  ? { tipo: 'compartilhada' as const, cert: certCompartilhado }
                  : null;
              const certFilialNome = cobertaPor
                ? filialMap.get(cobertaPor.cert.filialId)?.nome
                : null;
              return (
                <div
                  key={f.id}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    estaPausada
                      ? 'border-slate-200 bg-slate-50 opacity-70'
                      : cobertaPor
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        estaPausada
                          ? 'text-slate-500'
                          : cobertaPor
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                      }
                    >
                      {estaPausada ? '⏸' : cobertaPor ? '✓' : '⚠'}
                    </span>
                    <span className={`font-medium ${estaPausada ? 'text-slate-600 line-through' : 'text-slate-900'}`}>
                      {f.nome}
                    </span>
                    {estaPausada && (
                      <span className="text-[10px] text-slate-500">
                        pausada{pausada?.pausadaMotivo ? ` · ${pausada.pausadaMotivo}` : ''}
                      </span>
                    )}
                    {!estaPausada && cobertaPor?.tipo === 'propria' && (
                      <span className="text-[10px] text-emerald-700">
                        cert próprio
                      </span>
                    )}
                    {!estaPausada && cobertaPor?.tipo === 'compartilhada' && (
                      <span className="text-[10px] text-emerald-700">
                        usa cert compartilhado de {certFilialNome}
                      </span>
                    )}
                  </div>
                  {!estaPausada && !cobertaPor && (
                    <span className="text-[10px] text-amber-800">
                      sem certificado — faça upload acima ou marque um existente como
                      compartilhado
                    </span>
                  )}
                </div>
              );
            })}
          </div>
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
                          {c.ativo && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                              ATIVO
                            </span>
                          )}
                          {!c.ativo && (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                              INATIVO
                            </span>
                          )}
                          {c.compartilharOrganizacao && (
                            <span
                              className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800"
                              title="Cert vale pra todas as filiais da mesma organização"
                            >
                              COMPARTILHADO
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
                        <div className="flex items-center gap-2">
                          <ToggleCompartilharBtn
                            certId={c.id}
                            compartilhado={c.compartilharOrganizacao}
                          />
                          <ManifestarBtn
                            filialId={c.filialId}
                            todasFiliais={c.compartilharOrganizacao}
                          />
                          <ConsultarSefazBtn
                            filialId={c.filialId}
                            todasFiliais={c.compartilharOrganizacao}
                          />
                        </div>
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
