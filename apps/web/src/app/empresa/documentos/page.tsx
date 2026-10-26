import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, inArray, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { situacaoDoc } from '@/lib/empresa-documento';
import { DocumentosEmpresa, type CasaDocs, type DocLinha } from './documentos';

export const dynamic = 'force-dynamic';

/**
 * Documentos da empresa por casa (26/10/2026): alvarás, certidões, inscrições,
 * Cadastur… com a validade e o aviso de 30/15/7 dias e vencido.
 * Renovação guarda o anterior no histórico.
 */
export default async function DocumentosEmpresaPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'configuracao.read');
  const podeEditar = await podeUsuario(user.id, 'configuracao.editar');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const ativa = await escolherFilial(filiais, sp.filialId);
  if (!ativa) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const t = schema.empresaDocumento;
  const linhas = await db
    .select({
      id: t.id,
      filialId: t.filialId,
      tipo: t.tipo,
      titulo: t.titulo,
      numero: t.numero,
      orgao: t.orgao,
      emissao: t.emissao,
      validade: t.validade,
      semVencimento: t.semVencimento,
      observacao: t.observacao,
      arquivoNome: t.arquivoNome,
      criadoEm: t.criadoEm,
      substituidoPor: t.substituidoPor,
    })
    .from(t)
    .where(and(inArray(t.filialId, filiais.map((f) => f.id)), isNull(t.canceladoEm)))
    .orderBy(desc(t.criadoEm));

  const hoje = hojeBr();
  const paraLinha = (l: (typeof linhas)[number]): DocLinha => {
    const s = situacaoDoc({ validade: l.validade, semVencimento: l.semVencimento }, hoje);
    return {
      id: l.id,
      tipo: l.tipo,
      titulo: l.titulo,
      numero: l.numero,
      orgao: l.orgao,
      emissao: l.emissao,
      validade: l.validade,
      semVencimento: l.semVencimento,
      observacao: l.observacao,
      arquivoNome: l.arquivoNome,
      situacao: s.situacao,
      dias: s.dias,
      historico: [],
    };
  };

  // Histórico: segue a corrente substituido_por de trás pra frente.
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const anteriorDe = new Map<string, string>();
  for (const l of linhas) if (l.substituidoPor) anteriorDe.set(l.substituidoPor, l.id);

  const ordem: Record<string, number> = { vencido: 0, vence7: 1, vence15: 2, vence30: 3, sem_data: 4, valido: 5, sem_vencimento: 6 };
  const casas: CasaDocs[] = [...filiais]
    .sort((a, b) => (a.id === ativa.id ? -1 : b.id === ativa.id ? 1 : a.cnpj.localeCompare(b.cnpj)))
    .map((f) => {
      const vigentes = linhas
        .filter((l) => l.filialId === f.id && !l.substituidoPor)
        .map((l) => {
          const linha = paraLinha(l);
          let ant = anteriorDe.get(l.id);
          while (ant) {
            const a = porId.get(ant);
            if (!a) break;
            linha.historico.push(paraLinha(a));
            ant = anteriorDe.get(ant);
          }
          return linha;
        })
        .sort((a, b) => ordem[a.situacao]! - ordem[b.situacao]! || (a.validade ?? '').localeCompare(b.validade ?? ''));
      return { filialId: f.id, nome: f.nome, cnpj: f.cnpj, documentos: vigentes };
    });

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-slate-900">Documentos da empresa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alvarás, certidões, inscrições e licenças de cada casa. A IA lê a validade; o aviso aparece aqui e no
          resumo diário quando faltam 30, 15 e 7 dias, e quando vence.
        </p>
        <DocumentosEmpresa casas={casas} filialPadrao={ativa.id} podeEditar={podeEditar} hoje={hoje} />
      </div>
    </main>
  );
}
