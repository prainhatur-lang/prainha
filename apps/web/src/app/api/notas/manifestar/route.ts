// POST /api/notas/manifestar
// Body: JSON { filialId, limite? }
//
// Dá ciência (evento 210210) em todas as notas que ainda estão como resumo
// naquela filial. Após ciência, a próxima consulta DF-e devolve o XML
// completo (procNFe) que a gente faz upgrade automaticamente.
//
// evento: 'confirmacao' (com chaves) manda Confirmação da Operação (210200) —
// é o caminho da nota que passou dos 10 dias da ciência (SEFAZ responde 596).
// Manifestação individual (com chaves) já tenta buscar o XML pela chave na hora.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { confirmarOperacao, manifestarPendentes } from '@/lib/nfe-manifestar';
import { buscarXmlPorChave } from '@/lib/nfe-distribuicao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    limite?: number;
    escopo?: 'filial' | 'todas-da-org';
    /** Ciência individual: manifesta só essas chaves (na filial informada). */
    chaves?: string[];
    /** 'ciencia' (default, 210210) ou 'confirmacao' (210200, só com chaves). */
    evento?: 'ciencia' | 'confirmacao';
  };
  const filialId = body.filialId;
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }

  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link || link.role !== 'DONO') {
    return NextResponse.json({ error: 'so DONO pode manifestar' }, { status: 403 });
  }

  // Resolve escopo (filial unica ou todas da org)
  const escopo = body.escopo ?? 'filial';
  let filiaisIds: string[] = [filialId];
  if (escopo === 'todas-da-org') {
    const [filialAlvo] = await db
      .select({ organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    if (filialAlvo?.organizacaoId) {
      // Ignora filiais pausadas
      const filiaisDaOrg = await db
        .select({ id: schema.filial.id })
        .from(schema.filial)
        .where(
          and(
            eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
            isNull(schema.filial.pausadaEm),
          ),
        );
      filiaisIds = filiaisDaOrg.map((f) => f.id);
    }
  }

  if (body.evento === 'confirmacao') {
    const chaves = (body.chaves ?? []).filter((c) => /^\d{44}$/.test(c));
    if (chaves.length === 0) {
      return NextResponse.json({ error: 'confirmacao exige as chaves' }, { status: 400 });
    }
    try {
      const r = await confirmarOperacao({ filialId, chaves });
      const xml = await tentarXml(filialId, r.chavesManifestadas);
      return NextResponse.json({
        ok: true,
        totalTentado: r.totalTentado,
        manifestadas: r.chavesManifestadas.length,
        comErro: r.chavesComErro.length,
        filiaisProcessadas: 1,
        erros: r.chavesComErro.slice(0, 10),
        ...xml,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `erro na confirmacao: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  try {
    let totalTentado = 0,
      manifestadas = 0,
      comErro = 0;
    const errosAgregados: { chave: string; motivo: string }[] = [];
    const chavesOk: string[] = [];
    for (const fId of filiaisIds) {
      const r = await manifestarPendentes({
        filialId: fId,
        limite: Math.min(body.limite ?? 50, 100),
        chaves: body.chaves && body.chaves.length ? body.chaves : undefined,
      });
      totalTentado += r.totalTentado;
      manifestadas += r.chavesManifestadas.length;
      comErro += r.chavesComErro.length;
      errosAgregados.push(...r.chavesComErro);
      chavesOk.push(...r.chavesManifestadas);
    }
    // Só na ciência individual (poucas chaves): o lote fica pro cron, que
    // respeita o limite de ~20 consultas/hora da SEFAZ.
    const xml =
      body.chaves && body.chaves.length && escopo === 'filial'
        ? await tentarXml(filialId, chavesOk)
        : {};
    return NextResponse.json({
      ok: true,
      totalTentado,
      manifestadas,
      comErro,
      filiaisProcessadas: filiaisIds.length,
      erros: errosAgregados.slice(0, 10),
      ...xml,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `erro na manifestacao: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

/** Depois de manifestar poucas notas na mão, tenta já trazer o XML pela chave.
 *  Falha aqui não desfaz a manifestação — o cron tenta de novo. */
async function tentarXml(
  filialId: string,
  chaves: string[],
): Promise<{ xmlBaixados?: number; xmlAviso?: string }> {
  if (chaves.length === 0 || chaves.length > 10) return {};
  try {
    const b = await buscarXmlPorChave({ filialId, chaves, limite: chaves.length });
    return {
      xmlBaixados: b.completas.length,
      xmlAviso: b.bloqueio ?? b.semXml[0]?.motivo,
    };
  } catch (e) {
    return { xmlBaixados: 0, xmlAviso: (e as Error).message };
  }
}
