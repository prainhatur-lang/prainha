// Config fiscal por filial: dados do emitente + CSC + série pra emissão de
// NFC-e. O certificado A1 é o mesmo da distribuição DF-e (tela Certificados).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { findActiveCertForFilial } from '@/lib/certificado-resolver';
import { pendenciasConfig } from '@/lib/nfce/emitir';
import { FiscalForm } from './form';

export const dynamic = 'force-dynamic';

export default async function FiscalConfigPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'configuracao.read');

  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((f) => f.id);
  const rows = ids.length
    ? await db
        .select({
          id: schema.filial.id,
          nome: schema.filial.nome,
          cnpj: schema.filial.cnpj,
          cfg: schema.filial.fiscalConfig,
        })
        .from(schema.filial)
        .where(inArray(schema.filial.id, ids))
    : [];

  const comCert = await Promise.all(
    rows.map(async (f) => ({ ...f, temCert: !!(await findActiveCertForFilial(f.id)) })),
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Fiscal — NFC-e</h1>
        <p className="mt-1 text-sm text-slate-600">
          Emissão de NFC-e (modelo 65) direto na SEFAZ pelo Concilia. Ao fechar a conta no caixa
          ou na maquininha, o sistema pergunta se o cliente quer a nota. O certificado A1 é o
          mesmo já usado na SEFAZ (tela Certificados). O <b>CSC</b> (id + token) é gerado no
          portal da SEFAZ-SE pelo contador — um de produção e um de homologação.
        </p>

        <div className="mt-8 space-y-8">
          {comCert.map((f) => {
            const pend = pendenciasConfig(f.cfg);
            return (
              <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">{f.nome}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      CNPJ {f.cnpj} ·{' '}
                      {f.temCert ? (
                        <span className="text-emerald-700">certificado A1 OK</span>
                      ) : (
                        <span className="text-rose-700">
                          sem certificado A1 — suba em Configurações → Certificados
                        </span>
                      )}
                    </p>
                  </div>
                  {pend.length === 0 ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                      pronta pra emitir ({f.cfg?.ambiente === 1 ? 'PRODUÇÃO' : 'homologação'})
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      pendências: {pend.length}
                    </span>
                  )}
                </div>
                {pend.length > 0 && (
                  <ul className="mt-3 list-inside list-disc rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                    {pend.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-5">
                  <FiscalForm filialId={f.id} inicial={f.cfg ?? null} />
                </div>
              </div>
            );
          })}
          {comCert.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma filial acessível.</p>
          )}
        </div>
      </section>
    </main>
  );
}
