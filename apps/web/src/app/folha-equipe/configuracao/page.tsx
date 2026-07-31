// Configuracao da folha de pagamento por filial:
//  - Divisao dos 10pp do 10% (empresa/gerente/funcionarios, soma=10)
//  - Taxa diarista (R$/hora)
//  - Auxilio transporte (on/off + valor + dias)
//  - Categorias do plano de contas (Comissao, Diaria, Gratificacao, Transporte)
//  - Dia da semana de pagamento

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, ilike, isNotNull, or } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ConfiguracaoForm } from './form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function FolhaConfiguracaoPage(props: {
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  // Carrega config existente (ou usa defaults)
  const [configRow] = await db
    .select()
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, filialSelecionada.id))
    .limit(1);

  const config = configRow ?? {
    filialId: filialSelecionada.id,
    ppEmpresa: '1',
    ppGerente: '1',
    ppFuncionarios: '8',
    taxaDiaristaHora: '8.00',
    auxTransporteAtivo: false,
    auxTransporteValorHora: null,
    auxTransporteDias: null,
    categoriaComissaoId: null,
    categoriaDiariaId: null,
    categoriaGratificacaoId: null,
    categoriaTransporteId: null,
    diaPagamento: 1,
    atualizadoEm: new Date(),
  };

  // Categorias relevantes pra folha (filtra por nome contendo termos comuns)
  const categorias = await db
    .select({
      id: schema.categoriaConta.id,
      codigoExterno: schema.categoriaConta.codigoExterno,
      descricao: schema.categoriaConta.descricao,
    })
    .from(schema.categoriaConta)
    .where(
      and(
        eq(schema.categoriaConta.filialId, filialSelecionada.id),
        isNotNull(schema.categoriaConta.descricao),
        or(
          ilike(schema.categoriaConta.descricao, '%comiss%'),
          ilike(schema.categoriaConta.descricao, '%diaria%'),
          ilike(schema.categoriaConta.descricao, '%diári%'),
          ilike(schema.categoriaConta.descricao, '%salar%'),
          ilike(schema.categoriaConta.descricao, '%gratif%'),
          ilike(schema.categoriaConta.descricao, '%transporte%'),
          ilike(schema.categoriaConta.descricao, '%premio%'),
          ilike(schema.categoriaConta.descricao, '%bônus%'),
          ilike(schema.categoriaConta.descricao, '%bonus%'),
        ),
      ),
    )
    .orderBy(schema.categoriaConta.descricao);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            Configuração da folha
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Parâmetros usados pra calcular a folha semanal da equipe.
          </p>
        </div>

        {/* Selector de filial */}
        {filiais.length > 1 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-500">
              Filial
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {filiais.map((f) => {
                const active = f.id === filialSelecionada.id;
                return (
                  <a
                    key={f.id}
                    href={`?filialId=${f.id}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {f.nome}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <ConfiguracaoForm
          filialId={filialSelecionada.id}
          filialNome={filialSelecionada.nome}
          initial={{
            ppEmpresa: Number(config.ppEmpresa),
            ppGerente: Number(config.ppGerente),
            ppFuncionarios: Number(config.ppFuncionarios),
            taxaDiaristaHora: Number(config.taxaDiaristaHora),
            auxTransporteAtivo: config.auxTransporteAtivo,
            auxTransporteValorHora: config.auxTransporteValorHora
              ? Number(config.auxTransporteValorHora)
              : null,
            auxTransporteDias: (config.auxTransporteDias as Record<string, boolean>) ?? null,
            categoriaComissaoId: config.categoriaComissaoId,
            categoriaDiariaId: config.categoriaDiariaId,
            categoriaGratificacaoId: config.categoriaGratificacaoId,
            categoriaTransporteId: config.categoriaTransporteId,
            diaPagamento: config.diaPagamento,
          }}
          categorias={categorias.map((c) => ({
            id: c.id,
            label: `${c.codigoExterno} — ${c.descricao}`,
          }))}
        />
      </section>
    </main>
  );
}
