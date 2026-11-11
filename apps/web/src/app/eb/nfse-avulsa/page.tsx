// /eb/nfse-avulsa — nota de serviço (NFS-e Nacional) pra empresa de FORA do
// sistema (pedido do dono 11/11/2026). As notas pras casas continuam em
// /eb/faturas. Emissão em lib/nfse/emitir-avulsa.ts, com o A1 do emitente.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { AppHeader } from '@/components/app-header';
import { db, schema } from '@concilia/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import { configEb } from '@/lib/eb/faturas';
import { NfseAvulsaManager, type NotaAvulsa } from './manager';

export const dynamic = 'force-dynamic';

export default async function NfseAvulsaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.fechar');

  const cfg = await configEb();
  const [emit] = cfg
    ? await db.select().from(schema.nfseConfig).where(eq(schema.nfseConfig.filialId, cfg.filialId)).limit(1)
    : [];
  const [cert] = cfg
    ? await db
        .select({ cn: schema.certificadoFilial.cn, validadeFim: schema.certificadoFilial.validadeFim })
        .from(schema.certificadoFilial)
        .where(and(eq(schema.certificadoFilial.filialId, cfg.filialId), eq(schema.certificadoFilial.ativo, true)))
        .limit(1)
    : [];
  const linhas = cfg
    ? await db
        .select()
        .from(schema.nfseAvulsa)
        .where(and(eq(schema.nfseAvulsa.filialId, cfg.filialId), ne(schema.nfseAvulsa.status, 'CANCELADA')))
        .orderBy(desc(schema.nfseAvulsa.criadoEm))
        .limit(200)
    : [];
  const notas: NotaAvulsa[] = linhas.map((n) => ({
    id: n.id,
    status: n.status,
    tomadorCnpj: n.tomadorCnpj,
    tomadorNome: n.tomadorNome,
    tomadorEmail: n.tomadorEmail,
    tomadorCodigoMunicipio: n.tomadorCodigoMunicipio,
    tomadorCidade: n.tomadorCidade,
    tomadorCep: n.tomadorCep,
    tomadorLogradouro: n.tomadorLogradouro,
    tomadorNumero: n.tomadorNumero,
    tomadorBairro: n.tomadorBairro,
    codigoTributacao: n.codigoTributacao,
    descricao: n.descricao,
    municipioPrestacao: n.municipioPrestacao,
    dataCompetencia: n.dataCompetencia,
    valorServico: Number(n.valorServico),
    aliquotaIss: n.aliquotaIss === null ? null : Number(n.aliquotaIss),
    issRetido: n.issRetido,
    valorIss: Number(n.valorIss),
    valorLiquido: Number(n.valorLiquido),
    nfseNumero: n.nfseNumero,
    nfseChave: n.nfseChave,
    nfseErro: n.nfseErro,
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        <div>
          <a href="/eb/faturas" className="text-xs text-slate-500 hover:underline">← Faturas da E.B. (notas pras casas)</a>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Nota de serviço avulsa (NFS-e)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nota de serviço pra uma empresa de fora. Sai pelo emissor nacional, com o certificado A1 de quem emite. O código do
            serviço, a alíquota do ISS e a retenção são os que o contador passar — o sistema não escolhe.
          </p>
        </div>

        {!cfg || !emit ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Nenhuma empresa com a NFS-e configurada.
          </p>
        ) : (
          <NfseAvulsaManager
            emitente={{
              razaoSocial: emit.razaoSocial,
              cnpj: emit.cnpj,
              codigoMunicipio: emit.codigoMunicipio,
              ambiente: emit.ambiente,
              certificado: cert ? { cn: cert.cn, validadeFim: cert.validadeFim } : null,
            }}
            notas={notas}
            hoje={hojeBr()}
          />
        )}
      </div>
    </main>
  );
}
