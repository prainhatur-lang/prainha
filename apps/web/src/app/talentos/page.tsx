// Banco de talentos — painel da equipe (quem cuida da folha contrata).
// Cadastros chegam pela página pública /trabalhe (link que a Nina manda).

import { db, schema } from '@concilia/db';
import { desc } from 'drizzle-orm';
import { exigirPermPage } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';

const CORES: Record<string, string> = {
  novo: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  avaliado: 'bg-sky-50 text-sky-700 ring-sky-200',
  chamado: 'bg-amber-50 text-amber-700 ring-amber-200',
  contratado: 'bg-violet-50 text-violet-700 ring-violet-200',
  descartado: 'bg-slate-100 text-slate-500 ring-slate-200',
};

function fmtFone(d: string): string {
  const s = d.replace(/^55/, '');
  return s.length === 11 ? `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}` : d;
}

export default async function TalentosPage() {
  await exigirPermPage('folha_equipe.read');

  const talentos = await db
    .select()
    .from(schema.talento)
    .orderBy(desc(schema.talento.criadoEm))
    .limit(300);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Banco de talentos</h1>
          <p className="text-sm text-slate-500">
            Candidatos cadastrados pelo link público /trabalhe (a Nina envia no WhatsApp).
          </p>
        </div>
        <span className="text-sm text-slate-500">{talentos.length} cadastro(s)</span>
      </div>

      {talentos.length === 0 ? (
        <p className="mt-10 text-center text-sm text-slate-500">
          Nenhum candidato ainda — quando alguém falar com a Nina sobre trabalhar aqui, o
          cadastro aparece nesta lista.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {talentos.map((t) => (
            <li key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{t.nome}</p>
                  <p className="text-xs text-slate-500">
                    CPF final {t.cpf.slice(-3)} · {t.endereco || 'endereço não informado'} ·{' '}
                    {new Date(t.criadoEm).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${CORES[t.status] ?? CORES.novo}`}
                  >
                    {t.status}
                  </span>
                  <a
                    href={`https://wa.me/${t.whatsapp.length <= 11 ? '55' + t.whatsapp : t.whatsapp}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    WhatsApp {fmtFone(t.whatsapp)}
                  </a>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(t.funcoes ?? []).map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-orange-200"
                  >
                    {f}
                  </span>
                ))}
              </div>
              {t.experiencia && <p className="mt-2 text-sm text-slate-600">{t.experiencia}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
