// Faturas de mão de obra da E.B. Serviços pra cada casa (19/10/2026).
// Valor = folha da E.B. na casa (folha do contador) + percentual de lucro;
// ISS retido pela casa. Conta em lib/eb/faturas.ts. NFS-e Nacional emitida
// daqui (lib/nfse/emitir-eb.ts) com o A1 da E.B. (/api/eb/certificado).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { db, schema } from '@concilia/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { EB_CNPJ, MUNICIPIO_ISS, configEb, preverFaturas } from '@/lib/eb/faturas';
import { FaturasEbManager, type LinhaFatura } from './manager';

export const dynamic = 'force-dynamic';

export default async function FaturasEbPage(props: { searchParams: Promise<{ comp?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.fechar');

  const cfg = await configEb();
  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;

  const competencias = (
    await db
      .selectDistinct({ competencia: schema.folhaContadorResumo.competencia })
      .from(schema.folhaContadorResumo)
      .where(eq(schema.folhaContadorResumo.cnpj, EB_CNPJ))
      .orderBy(desc(schema.folhaContadorResumo.competencia))
  ).map((c) => c.competencia);
  const comp = sp.comp && competencias.includes(sp.comp) ? sp.comp : competencias[0] ?? null;

  let linhas: LinhaFatura[] = [];
  if (cfg && comp) {
    const prev = await preverFaturas(comp, filiais.map((f) => f.id), cfg);
    const faturas = await db
      .select()
      .from(schema.faturaServico)
      .where(
        and(
          eq(schema.faturaServico.filialId, cfg.filialId),
          eq(schema.faturaServico.competencia, comp),
          ne(schema.faturaServico.status, 'CANCELADA'),
        ),
      );
    const porCasa = new Map(faturas.map((f) => [f.tomadorFilialId, f]));
    linhas = filiais
      .map((f) => {
        const p = prev.find((x) => x.tomadorFilialId === f.id) ?? null;
        const fat = porCasa.get(f.id) ?? null;
        if (!p && !fat) return null;
        return {
          casaId: f.id,
          casa: f.nome,
          municipio: MUNICIPIO_ISS[f.id] ?? 'Aracaju',
          previsao: p,
          fatura: fat && {
            id: fat.id,
            status: fat.status,
            empregados: fat.empregados,
            horas: Number(fat.horas),
            valorBase: Number(fat.valorBase),
            percentualLucro: Number(fat.percentualLucro),
            valorLucro: Number(fat.valorLucro),
            valorServico: Number(fat.valorServico),
            aliquotaIss: Number(fat.aliquotaIss),
            valorIss: Number(fat.valorIss),
            valorLiquido: Number(fat.valorLiquido),
            vencimento: fat.vencimento,
            discriminacao: fat.discriminacao,
            lancada: !!fat.contaPagarId,
            nfseChave: fat.nfseChave,
            nfseNumero: fat.nfseNumero,
            nfseErro: fat.nfseErro,
            recebidoEm: fat.recebidoEm,
            valorRecebido: fat.valorRecebido === null ? null : Number(fat.valorRecebido),
          },
        };
      })
      .filter((l): l is LinhaFatura => l !== null);
  }

  const [cert] = cfg
    ? await db
        .select({ cn: schema.certificadoFilial.cn, validadeFim: schema.certificadoFilial.validadeFim })
        .from(schema.certificadoFilial)
        .where(and(eq(schema.certificadoFilial.filialId, cfg.filialId), eq(schema.certificadoFilial.ativo, true)))
        .limit(1)
    : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        <div>
          <a href="/rh/folha-contador" className="text-xs text-slate-500 hover:underline">← Folha do contador</a>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Faturas da E.B. Serviços</h1>
          <p className="mt-1 text-sm text-slate-500">
            Uma fatura de mão de obra por casa por mês: custo da folha da E.B. naquela casa (folha do contador) mais o
            percentual de lucro. A casa retém o ISS e paga à E.B. o resto. A NFS-e sai daqui pelo emissor nacional, com
            o certificado A1 da E.B.
          </p>
        </div>

        {!cfg ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            A E.B. ainda não está cadastrada no sistema.
          </p>
        ) : (
          <FaturasEbManager
            config={cfg}
            competencias={competencias}
            comp={comp}
            linhas={linhas}
            hoje={hojeBr()}
            certificado={cert ? { cn: cert.cn, validadeFim: cert.validadeFim } : null}
          />
        )}
      </div>
    </main>
  );
}
