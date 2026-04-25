// Diagnóstico do sistema: saúde por filial + alertas ativos + roteiro
// de teste E2E. Útil pra validar antes de virar pra produção real e
// monitorar dia a dia.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, count, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SaudeFilial {
  filialId: string;
  nome: string;
  agente: {
    ultimoPing: Date | null;
    horasOffline: number | null;
    semaforo: 'verde' | 'amarelo' | 'vermelho' | 'cinza';
  };
  produtos: {
    total: number;
    comEstoque: number;
    abaixoMinimo: number;
    zerados: number;
    valorEmEstoque: number;
    divergentes: number; // produto.estoqueAtual ≠ SUM(movimentos)
  };
  producao: {
    rascunhos: number;
    aguardandoRevisao: number;
    concluidasHoje: number;
    concluidas7d: number;
    perdaMedia7d: number;
  };
  nfes: {
    pendentesLancar: number;
    resumosCiencia: number;
    lancadas30d: number;
  };
  certificado: {
    presente: boolean;
    validadeFim: string | null;
    diasRestantes: number | null;
    semaforo: 'verde' | 'amarelo' | 'vermelho' | 'cinza';
  };
  fluxoCompleto: {
    temFotosEntrada7d: boolean;
    temFotosSaida7d: boolean;
    cozinheirosAtivos7d: number;
  };
}

function semaforoAgente(ultimoPing: Date | null): {
  semaforo: 'verde' | 'amarelo' | 'vermelho' | 'cinza';
  horas: number | null;
} {
  if (!ultimoPing) return { semaforo: 'cinza', horas: null };
  const horas = (Date.now() - ultimoPing.getTime()) / 3_600_000;
  if (horas < 1) return { semaforo: 'verde', horas };
  if (horas < 24) return { semaforo: 'amarelo', horas };
  return { semaforo: 'vermelho', horas };
}

function semaforoCert(diasRestantes: number | null): 'verde' | 'amarelo' | 'vermelho' | 'cinza' {
  if (diasRestantes == null) return 'cinza';
  if (diasRestantes < 0) return 'vermelho';
  if (diasRestantes < 30) return 'amarelo';
  return 'verde';
}

function bgSem(s: string): string {
  return s === 'verde'
    ? 'bg-emerald-500'
    : s === 'amarelo'
      ? 'bg-amber-500'
      : s === 'vermelho'
        ? 'bg-rose-500'
        : 'bg-slate-300';
}

export default async function DiagnosticoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const agora = Date.now();
  const dtHoje = new Date(agora);
  dtHoje.setHours(0, 0, 0, 0);
  const dt7d = new Date(agora - 7 * 86_400_000);
  const dt30d = new Date(agora - 30 * 86_400_000);

  const saude: SaudeFilial[] = await Promise.all(
    filiais.map(async (f) => {
      // Agente: usa filial.ultimoPing
      const [filRow] = await db
        .select({ ultimoPing: schema.filial.ultimoPing })
        .from(schema.filial)
        .where(eq(schema.filial.id, f.id))
        .limit(1);
      const ag = semaforoAgente(filRow?.ultimoPing ?? null);

      // Produtos
      const [prods] = await db.execute<{
        total: number;
        com_estoque: number;
        abaixo_minimo: number;
        zerados: number;
        valor_estoque: string;
      }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE controla_estoque = true)::int AS total,
          COUNT(*) FILTER (WHERE controla_estoque = true AND COALESCE(estoque_atual, 0) > 0)::int AS com_estoque,
          COUNT(*) FILTER (
            WHERE controla_estoque = true
              AND COALESCE(estoque_minimo, 0) > 0
              AND COALESCE(estoque_atual, 0) < COALESCE(estoque_minimo, 0)
              AND (descontinuado IS NULL OR descontinuado = false)
          )::int AS abaixo_minimo,
          COUNT(*) FILTER (
            WHERE controla_estoque = true
              AND COALESCE(estoque_atual, 0) <= 0
              AND (descontinuado IS NULL OR descontinuado = false)
          )::int AS zerados,
          COALESCE(SUM(CASE WHEN controla_estoque = true THEN COALESCE(estoque_atual, 0) * COALESCE(preco_custo, 0) ELSE 0 END), 0)::text AS valor_estoque
        FROM ${schema.produto}
        WHERE filial_id = ${f.id}
      `);

      // Detecção de divergências (produto.estoqueAtual ≠ SUM movimentos)
      // Tolerância de 0.001 pra arredondamento numérico
      const [diverg] = await db.execute<{ qtd: number }>(sql`
        WITH soma_mov AS (
          SELECT produto_id, SUM(quantidade) AS saldo_mov
          FROM ${schema.movimentoEstoque}
          WHERE filial_id = ${f.id}
          GROUP BY produto_id
        )
        SELECT COUNT(*)::int AS qtd
        FROM ${schema.produto} p
        LEFT JOIN soma_mov s ON s.produto_id = p.id
        WHERE p.filial_id = ${f.id}
          AND p.controla_estoque = true
          AND ABS(COALESCE(p.estoque_atual, 0) - COALESCE(s.saldo_mov, 0)) > 0.001
      `);

      // Produção
      const [prod] = await db.execute<{
        rascunhos: number;
        aguardando: number;
        hoje: number;
        sete_d: number;
      }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'RASCUNHO' AND marcada_pronta_em IS NULL)::int AS rascunhos,
          COUNT(*) FILTER (WHERE status = 'RASCUNHO' AND marcada_pronta_em IS NOT NULL)::int AS aguardando,
          COUNT(*) FILTER (WHERE status = 'CONCLUIDA' AND concluida_em >= ${dtHoje.toISOString()})::int AS hoje,
          COUNT(*) FILTER (WHERE status = 'CONCLUIDA' AND concluida_em >= ${dt7d.toISOString()})::int AS sete_d
        FROM ${schema.ordemProducao}
        WHERE filial_id = ${f.id}
      `);

      // Perda média 7d (% por unidade de entrada nas concluídas)
      const [perdaRow] = await db.execute<{ perda_perc: string }>(sql`
        WITH ops AS (
          SELECT
            op.id,
            COALESCE((SELECT SUM(quantidade) FROM ${schema.ordemProducaoEntrada} WHERE ordem_producao_id = op.id), 0) AS qtd_ent,
            COALESCE((SELECT SUM(quantidade) FROM ${schema.ordemProducaoSaida} WHERE ordem_producao_id = op.id AND tipo = 'PERDA'), 0) AS qtd_perda
          FROM ${schema.ordemProducao} op
          WHERE op.filial_id = ${f.id}
            AND op.status = 'CONCLUIDA'
            AND op.concluida_em >= ${dt7d.toISOString()}
        )
        SELECT CASE WHEN SUM(qtd_ent) > 0 THEN (SUM(qtd_perda) / SUM(qtd_ent) * 100)::text ELSE '0' END AS perda_perc
        FROM ops
      `);

      // NFes
      const [nfeStats] = await db.execute<{
        pendentes: number;
        resumos: number;
        lancadas30: number;
      }>(sql`
        SELECT
          (
            SELECT COUNT(DISTINCT nc.id)::int
            FROM ${schema.notaCompra} nc
            JOIN ${schema.notaCompraItem} nci ON nci.nota_compra_id = nc.id
            WHERE nc.filial_id = ${f.id}
              AND nci.produto_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM ${schema.movimentoEstoque} me
                WHERE me.nota_compra_item_id = nci.id
              )
          ) AS pendentes,
          (
            SELECT COUNT(*)::int FROM ${schema.notaCompra}
            WHERE filial_id = ${f.id}
              AND origem_importacao = 'SEFAZ_DFE_RESUMO'
          ) AS resumos,
          (
            SELECT COUNT(DISTINCT nc.id)::int FROM ${schema.notaCompra} nc
            JOIN ${schema.movimentoEstoque} me ON me.filial_id = ${f.id}
            JOIN ${schema.notaCompraItem} nci ON nci.id = me.nota_compra_item_id
            WHERE nci.nota_compra_id = nc.id
              AND me.criado_em >= ${dt30d.toISOString()}
          ) AS lancadas30
      `);

      // Certificado A1
      const [cert] = await db
        .select({
          validadeFim: schema.certificadoFilial.validadeFim,
          ativo: schema.certificadoFilial.ativo,
        })
        .from(schema.certificadoFilial)
        .where(
          and(
            eq(schema.certificadoFilial.filialId, f.id),
            eq(schema.certificadoFilial.ativo, true),
          ),
        )
        .limit(1);
      let diasRestantes: number | null = null;
      let validadeFim: string | null = null;
      if (cert?.validadeFim) {
        validadeFim = cert.validadeFim;
        const fim = new Date(cert.validadeFim + 'T00:00:00');
        diasRestantes = Math.floor((fim.getTime() - Date.now()) / 86_400_000);
      }

      // Fluxo completo (cozinheiro mandou foto?)
      const [fotosRow] = await db.execute<{
        ent: number;
        sai: number;
      }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE tipo = 'ENTRADA')::int AS ent,
          COUNT(*) FILTER (WHERE tipo = 'SAIDA')::int AS sai
        FROM ${schema.ordemProducaoFoto} f
        JOIN ${schema.ordemProducao} op ON op.id = f.ordem_producao_id
        WHERE op.filial_id = ${f.id}
          AND f.enviada_em >= ${dt7d.toISOString()}
      `);

      const [colabRow] = await db
        .select({ qtd: count() })
        .from(schema.colaborador)
        .where(
          and(
            eq(schema.colaborador.filialId, f.id),
            eq(schema.colaborador.ativo, true),
            isNotNull(schema.colaborador.tokenAcesso),
            gte(schema.colaborador.ultimaAtividadeEm, dt7d),
          ),
        );

      return {
        filialId: f.id,
        nome: f.nome,
        agente: {
          ultimoPing: filRow?.ultimoPing ?? null,
          horasOffline: ag.horas,
          semaforo: ag.semaforo,
        },
        produtos: {
          total: Number(prods?.total ?? 0),
          comEstoque: Number(prods?.com_estoque ?? 0),
          abaixoMinimo: Number(prods?.abaixo_minimo ?? 0),
          zerados: Number(prods?.zerados ?? 0),
          valorEmEstoque: Number(prods?.valor_estoque ?? 0),
          divergentes: Number(diverg?.qtd ?? 0),
        },
        producao: {
          rascunhos: Number(prod?.rascunhos ?? 0),
          aguardandoRevisao: Number(prod?.aguardando ?? 0),
          concluidasHoje: Number(prod?.hoje ?? 0),
          concluidas7d: Number(prod?.sete_d ?? 0),
          perdaMedia7d: Number(perdaRow?.perda_perc ?? 0),
        },
        nfes: {
          pendentesLancar: Number(nfeStats?.pendentes ?? 0),
          resumosCiencia: Number(nfeStats?.resumos ?? 0),
          lancadas30d: Number(nfeStats?.lancadas30 ?? 0),
        },
        certificado: {
          presente: !!cert,
          validadeFim,
          diasRestantes,
          semaforo: semaforoCert(diasRestantes),
        },
        fluxoCompleto: {
          temFotosEntrada7d: Number(fotosRow?.ent ?? 0) > 0,
          temFotosSaida7d: Number(fotosRow?.sai ?? 0) > 0,
          cozinheirosAtivos7d: Number(colabRow?.qtd ?? 0),
        },
      };
    }),
  );

  // Coleta alertas
  type Alerta = { tipo: 'erro' | 'aviso' | 'info'; texto: string; href?: string };
  const alertas: Alerta[] = [];
  for (const s of saude) {
    if (s.agente.semaforo === 'vermelho') {
      alertas.push({
        tipo: 'erro',
        texto: `${s.nome}: agente offline há ${Math.round(s.agente.horasOffline ?? 0)}h`,
        href: '/sync',
      });
    }
    if (s.agente.semaforo === 'cinza') {
      alertas.push({
        tipo: 'aviso',
        texto: `${s.nome}: agente nunca sincronizou — verifique instalação`,
        href: '/sync',
      });
    }
    if (s.certificado.semaforo === 'vermelho') {
      alertas.push({
        tipo: 'erro',
        texto: `${s.nome}: certificado A1 expirado há ${Math.abs(s.certificado.diasRestantes ?? 0)} dias`,
        href: '/configuracoes/certificados',
      });
    } else if (s.certificado.semaforo === 'amarelo') {
      alertas.push({
        tipo: 'aviso',
        texto: `${s.nome}: certificado A1 expira em ${s.certificado.diasRestantes} dias`,
        href: '/configuracoes/certificados',
      });
    }
    if (s.producao.aguardandoRevisao > 0) {
      alertas.push({
        tipo: 'info',
        texto: `${s.nome}: ${s.producao.aguardandoRevisao} OP(s) aguardando revisão do gestor`,
        href: `/movimento/producao?filialId=${s.filialId}&status=PRA_REVISAR`,
      });
    }
    if (s.produtos.divergentes > 0) {
      alertas.push({
        tipo: 'aviso',
        texto: `${s.nome}: ${s.produtos.divergentes} produto(s) com saldo divergente vs movimentos`,
        href: `/relatorios/movimentos?filialId=${s.filialId}`,
      });
    }
    if (s.nfes.pendentesLancar > 0) {
      alertas.push({
        tipo: 'info',
        texto: `${s.nome}: ${s.nfes.pendentesLancar} NFe(s) com itens vinculados pendentes lançar no estoque`,
        href: `/movimento/entrada-notas?filialId=${s.filialId}`,
      });
    }
    if (s.nfes.resumosCiencia > 0) {
      alertas.push({
        tipo: 'info',
        texto: `${s.nome}: ${s.nfes.resumosCiencia} NFe(s) resumo aguardando ciência (XML completo)`,
        href: `/configuracoes/certificados`,
      });
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Diagnóstico do sistema</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saúde dos subsistemas por filial e roteiro de validação end-to-end.
          Use antes de virar pra produção real e dia-a-dia pra monitorar.
        </p>

        {/* Alertas ativos */}
        {alertas.length > 0 && (
          <section className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              ⚠ Alertas ativos ({alertas.length})
            </h2>
            <div className="mt-2 space-y-1">
              {alertas.map((a, i) => (
                <Link
                  key={i}
                  href={a.href ?? '#'}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    a.tipo === 'erro'
                      ? 'border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100'
                      : a.tipo === 'aviso'
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100'
                  }`}
                >
                  <span>
                    {a.tipo === 'erro' ? '🔴' : a.tipo === 'aviso' ? '🟡' : '🔵'}
                  </span>
                  <span className="flex-1">{a.texto}</span>
                  {a.href && <span>→</span>}
                </Link>
              ))}
            </div>
          </section>
        )}

        {alertas.length === 0 && (
          <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-900">
              ✓ Sem alertas — sistema operando normalmente
            </p>
          </div>
        )}

        {/* Cards por filial */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
            Saúde por filial
          </h2>
          <div className="mt-3 space-y-4">
            {saude.map((s) => (
              <CardFilial key={s.filialId} saude={s} />
            ))}
          </div>
        </section>

        {/* Roteiro E2E */}
        <RoteiroE2E />
      </section>
    </main>
  );
}

function CardFilial({ saude: s }: { saude: SaudeFilial }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <h3 className="text-base font-bold text-slate-900">{s.nome}</h3>
      </div>
      <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-3">
        {/* Agente */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${bgSem(s.agente.semaforo)}`} />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Agente
            </p>
          </div>
          {s.agente.ultimoPing ? (
            <>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {s.agente.horasOffline! < 1
                  ? `Online (${Math.round(s.agente.horasOffline! * 60)}min atrás)`
                  : `${Math.round(s.agente.horasOffline ?? 0)}h offline`}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                {s.agente.ultimoPing.toLocaleString('pt-BR')}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm font-medium text-slate-500">Nunca sincronizou</p>
          )}
          <Link
            href="/sync"
            className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
          >
            ver sync →
          </Link>
        </div>

        {/* Estoque */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                s.produtos.divergentes > 0
                  ? 'bg-amber-500'
                  : s.produtos.zerados > s.produtos.comEstoque
                    ? 'bg-rose-500'
                    : 'bg-emerald-500'
              }`}
            />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Estoque
            </p>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {brl(s.produtos.valorEmEstoque)}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
            <span>{int(s.produtos.total)} produtos</span>
            {s.produtos.abaixoMinimo > 0 && (
              <span className="text-amber-700">⚠ {s.produtos.abaixoMinimo} abaixo</span>
            )}
            {s.produtos.zerados > 0 && (
              <span className="text-rose-700">{s.produtos.zerados} zerados</span>
            )}
            {s.produtos.divergentes > 0 && (
              <span className="text-amber-700">⚠ {s.produtos.divergentes} divergentes</span>
            )}
          </div>
          <Link
            href={`/relatorios/estoque?filialId=${s.filialId}`}
            className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
          >
            ver relatório →
          </Link>
        </div>

        {/* Produção */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                s.producao.aguardandoRevisao > 0 ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Produção
            </p>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {s.producao.concluidas7d} concluída{s.producao.concluidas7d === 1 ? '' : 's'} (7d)
            {s.producao.concluidasHoje > 0 && (
              <span className="ml-1 text-[10px] text-slate-500">
                · {s.producao.concluidasHoje} hoje
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
            {s.producao.rascunhos > 0 && (
              <span className="text-amber-700">{s.producao.rascunhos} rascunhos</span>
            )}
            {s.producao.aguardandoRevisao > 0 && (
              <span className="font-medium text-emerald-700">
                ⏳ {s.producao.aguardandoRevisao} pra revisar
              </span>
            )}
            {s.producao.concluidas7d > 0 && (
              <span>perda: {s.producao.perdaMedia7d.toFixed(1)}%</span>
            )}
          </div>
          <Link
            href={`/movimento/producao?filialId=${s.filialId}`}
            className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
          >
            ver OPs →
          </Link>
        </div>

        {/* NFes */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                s.nfes.pendentesLancar > 0 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              NFes (compra)
            </p>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {s.nfes.lancadas30d} lançada{s.nfes.lancadas30d === 1 ? '' : 's'} (30d)
          </p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
            {s.nfes.pendentesLancar > 0 && (
              <span className="text-amber-700">
                ⚠ {s.nfes.pendentesLancar} pendentes lançar
              </span>
            )}
            {s.nfes.resumosCiencia > 0 && (
              <span>{s.nfes.resumosCiencia} resumo (ciência)</span>
            )}
          </div>
          <Link
            href={`/movimento/entrada-notas?filialId=${s.filialId}`}
            className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
          >
            ver NFes →
          </Link>
        </div>

        {/* Certificado */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${bgSem(s.certificado.semaforo)}`} />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Certificado A1
            </p>
          </div>
          {s.certificado.presente ? (
            <>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {s.certificado.diasRestantes != null && s.certificado.diasRestantes < 0
                  ? `Expirado há ${Math.abs(s.certificado.diasRestantes)} dias`
                  : `${s.certificado.diasRestantes} dias`}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Validade: {s.certificado.validadeFim?.split('-').reverse().join('/')}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Não instalado</p>
          )}
          <Link
            href="/configuracoes/certificados"
            className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
          >
            gerenciar →
          </Link>
        </div>

        {/* Fluxo completo (cozinheiros + fotos) */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                s.fluxoCompleto.cozinheirosAtivos7d > 0 ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Cozinheiros (7d)
            </p>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {s.fluxoCompleto.cozinheirosAtivos7d} ativo{s.fluxoCompleto.cozinheirosAtivos7d === 1 ? '' : 's'}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
            <span className={s.fluxoCompleto.temFotosEntrada7d ? 'text-emerald-700' : ''}>
              {s.fluxoCompleto.temFotosEntrada7d ? '✓' : '·'} fotos entrada
            </span>
            <span className={s.fluxoCompleto.temFotosSaida7d ? 'text-emerald-700' : ''}>
              {s.fluxoCompleto.temFotosSaida7d ? '✓' : '·'} fotos saída
            </span>
          </div>
          <Link
            href="/cadastros/colaboradores"
            className="mt-2 inline-block text-[11px] text-sky-700 hover:underline"
          >
            gerenciar →
          </Link>
        </div>
      </div>
    </div>
  );
}

function RoteiroE2E() {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
        📋 Roteiro de validação end-to-end
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Faça uma vez antes de virar pra produção real. Cada passo verifica um
        elo da cadeia.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Bloco
          numero={1}
          titulo="Sincronização"
          itens={[
            'Agente v0.5.1+ instalado nas 3 máquinas',
            'Cards "Agente" todos verdes (online < 1h)',
            'Produtos populados em /cadastros/produtos',
            'Fornecedores em /cadastros/fornecedores',
          ]}
          link="/sync"
          linkLabel="abrir Sync"
        />
        <Bloco
          numero={2}
          titulo="Compra (NFe)"
          itens={[
            'Sobe XML de uma NFe real ou testa com SEFAZ DF-e',
            'Vincula itens a produtos (ou cria insumos novos)',
            '"Lançar no estoque" — verifica saldo subindo',
            'Confirma rateio do frete na seção azul',
          ]}
          link="/movimento/entrada-notas"
          linkLabel="abrir NFes"
        />
        <Bloco
          numero={3}
          titulo="Produção"
          itens={[
            'Cria template "Desossa filé" se for recorrente',
            'Nova OP a partir do template, fator escala',
            'Atribui responsável (cozinheiro)',
            'Gera link do painel do cozinheiro',
          ]}
          link="/cadastros/templates-producao"
          linkLabel="abrir Templates"
        />
        <Bloco
          numero={4}
          titulo="Cozinheiro (mobile)"
          itens={[
            'Abre /cozinheiro/[token] no celular',
            'Tira foto do material recebido',
            'Ajusta qtds das saídas',
            'Tira foto do produto pronto',
            'Marca como pronta',
          ]}
        />
        <Bloco
          numero={5}
          titulo="Revisão & conclusão"
          itens={[
            'Badge ⏳ aparece no nav (até 60s)',
            'Clica → filtro "Pra revisar"',
            'Confere fotos e qtds',
            'Concluí OP → estoque atualizado',
            'Verifica saldo do insumo bruto baixou',
            'Verifica que cortes (lâmina, etc) entraram',
          ]}
          link="/movimento/producao?status=PRA_REVISAR"
          linkLabel="abrir pendentes"
        />
        <Bloco
          numero={6}
          titulo="Auditoria"
          itens={[
            'Aba "Saldo & Custo" do produto: histórico bate',
            '/relatorios/movimentos: cada movimento com origem',
            '/relatorios/producao: % perda do cozinheiro',
            'Diagnóstico (esta página): 0 alertas críticos',
          ]}
          link="/relatorios/movimentos"
          linkLabel="abrir movimentos"
        />
      </div>
    </section>
  );
}

function Bloco({
  numero,
  titulo,
  itens,
  link,
  linkLabel,
}: {
  numero: number;
  titulo: string;
  itens: string[];
  link?: string;
  linkLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          {numero}
        </span>
        <h3 className="text-sm font-bold text-slate-900">{titulo}</h3>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
        {itens.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 text-slate-400">☐</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
      {link && linkLabel && (
        <Link
          href={link}
          className="mt-3 inline-block text-[11px] text-sky-700 hover:underline"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
