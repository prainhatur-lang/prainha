// Lelis Distribuidora — formação de preço de revenda + NF-e de venda (01/11/2026).
// A Lelis é empresa própria: compra mercadoria e vende pra outras lojas.
// Só o Admin entra (a Lelis fica fora de usuario_filial).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { db, schema } from '@concilia/db';
import type { FiscalConfig } from '@concilia/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from '@/lib/lelis/sincronizar';
import { PrecosLelisManager, type ProdutoLinha, type ConfigLelis } from './manager';
import { EstoqueFinanceiroLelis } from './estoque-financeiro';

export const dynamic = 'force-dynamic';

const num = (x: string | null) => (x == null ? null : Number(x));

export default async function PrecosLelisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/');

  const filialId = await lelisFilialId();
  if (!filialId) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl p-8 text-sm text-red-700">A Lelis não está cadastrada no sistema.</p>
      </main>
    );
  }

  const [cfgRow] = await db.select().from(schema.revendaConfig).where(eq(schema.revendaConfig.filialId, filialId)).limit(1);
  const [fil] = await db
    .select({ fiscalConfig: schema.filial.fiscalConfig, cnpj: schema.filial.cnpj })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const [cert] = await db
    .select({ cn: schema.certificadoFilial.cn, validadeFim: schema.certificadoFilial.validadeFim })
    .from(schema.certificadoFilial)
    .where(and(eq(schema.certificadoFilial.filialId, filialId), eq(schema.certificadoFilial.ativo, true)))
    .limit(1);
  const produtos = await db
    .select()
    .from(schema.revendaProduto)
    .where(eq(schema.revendaProduto.filialId, filialId))
    .orderBy(asc(schema.revendaProduto.descricao));

  const fc = (fil?.fiscalConfig ?? {}) as FiscalConfig;
  const config: ConfigLelis = {
    filialId,
    cnpj: fil?.cnpj ?? '',
    pctOperacional: cfgRow ? Number(cfgRow.pctOperacional) : 10,
    pctMargem: cfgRow ? Number(cfgRow.pctMargem) : 15,
    pctImpostosVenda: cfgRow ? Number(cfgRow.pctImpostosVenda) : 0,
    fiscal: cfgRow?.fiscal ?? {},
    emitente: {
      razaoSocial: fc.razaoSocial ?? 'LELIS ATACADISTA E VAREJISTA DE ALIMENTOS E BEBIDAS LTDA',
      nomeFantasia: fc.nomeFantasia ?? 'Lelis Distribuidora',
      ie: fc.ie ?? '272093238',
      crt: fc.nfe?.crt ?? fc.crt ?? 1,
      endereco: fc.endereco ?? {
        logradouro: 'RUA TENENTE ARAGAO',
        numero: '630',
        bairro: 'FAROLANDIA',
        codigoMunicipio: '2800308',
        municipio: 'ARACAJU',
        uf: 'SE',
        cep: '',
      },
      nfeSerie: fc.nfe?.serie ?? fc.serie ?? 1,
      nfeAmbiente: fc.nfe?.ambiente ?? fc.ambiente ?? 2,
      salvo: !!fc.razaoSocial,
    },
    certificado: cert ? { cn: cert.cn ?? '', validadeFim: String(cert.validadeFim) } : null,
  };

  const linhas: ProdutoLinha[] = produtos.map((p) => ({
    id: p.id,
    ean: p.ean,
    codigoFornecedor: p.codigoFornecedor,
    fornecedorNome: p.fornecedorNome,
    descricao: p.descricao,
    ncm: p.ncm,
    cest: p.cest,
    unidade: p.unidade,
    custoUnit: Number(p.custoUnit),
    pctIpi: Number(p.pctIpi),
    aliqOrigem: num(p.aliqOrigem),
    pctCarga: num(p.pctCarga),
    cargaComIpi: p.cargaComIpi,
    freteUnit: Number(p.freteUnit),
    pctOperacional: num(p.pctOperacional),
    pctMargem: num(p.pctMargem),
    pctImpostosVenda: num(p.pctImpostosVenda),
    precoManual: num(p.precoManual),
    cstPisSaida: p.cstPisSaida,
    ultimaCompraEm: p.ultimaCompraEm,
    ativo: p.ativo,
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Lelis Distribuidora — preço de venda e nota</h1>
          <p className="mt-1 text-sm text-slate-500">
            Custo de entrada (valor da nota + IPI + carga do Decreto 40.949 + frete) e, em cima dele, os percentuais de
            custo operacional, margem e impostos da venda. O preço sai “por dentro”: preço = custo ÷ (1 − soma dos %).
            Marque os produtos e quantidades pra emitir a NF-e de venda pra outra loja.
          </p>
        </div>
        <PrecosLelisManager config={config} produtos={linhas} />
        <div className="mt-6"><EstoqueFinanceiroLelis /></div>
      </div>
    </main>
  );
}
