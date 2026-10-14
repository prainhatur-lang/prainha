// Dá ciência da operação (evento 210210) em notas que chegaram como resumo.
// Isso destrava a SEFAZ pra devolver o XML completo (procNFe) na próxima
// consulta DF-e.
//
// Uso:
//  - Chamado manualmente pelo user num botão "dar ciência"
//  - Chamado pelo cron depois de cada consulta DF-e (se houver resumos novos)
//
// Ciência NÃO compromete a empresa — é só reconhecer que a nota existe.
// Pra rejeitar/recusar, existe o evento 210220 (desconhecimento) separado.

import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { decifrarSenha } from '@/lib/certificado';
import { findActiveCertForFilial } from '@/lib/certificado-resolver';
import {
  enviarEventosManifestacao,
  CSTAT_EVENTO_OK,
  type EventoManifestacao,
  type RetornoEvento,
} from '@/lib/sefaz-evento';

async function baixarPfx(path: string): Promise<Buffer> {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from('certificados').download(path);
  if (error) throw new Error(`erro baixando pfx: ${error.message}`);
  if (!data) throw new Error('pfx nao encontrado no storage');
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

export interface ResultadoManifestacao {
  filialId: string;
  chavesManifestadas: string[];
  chavesComErro: { chave: string; motivo: string }[];
  totalTentado: number;
  retornos: RetornoEvento[];
}

/** Dá ciência (210210) em todas as notas que ainda estão como resumo na filial. */
export async function manifestarPendentes(opts: {
  filialId: string;
  /** Limite por chamada (default 50 pra não estourar timeout do Vercel). */
  limite?: number;
  tpAmb?: 1 | 2;
  /** Se informado, manifesta SÓ essas chaves (ciência individual). Mesmo assim
   *  valida que ainda são resumo da filial — não dá pra manifestar nota alheia. */
  chaves?: string[];
}): Promise<ResultadoManifestacao> {
  const limite = opts.limite ?? 50;
  const individual = !!(opts.chaves && opts.chaves.length);

  // Busca notas resumo na filial (ou só as chaves pedidas, se ciência individual).
  // Sem chaves (cron / botão em lote): só as que AINDA cabem no prazo da ciência
  // (10 dias da autorização — depois disso a SEFAZ devolve 596), mais novas
  // primeiro e sem as canceladas. Sem esse filtro o lote de 50 pegava sempre as
  // mesmas notas velhas, que voltavam 596 e entupiam a fila: as novas passavam
  // do prazo sem ciência (Tabuará, out/2026).
  const resumos = await db
    .select({ chave: schema.notaCompra.chave })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, opts.filialId),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
        individual
          ? inArray(schema.notaCompra.chave, opts.chaves!)
          : and(
              sql`coalesce(${schema.notaCompra.dataAutorizacao}, ${schema.notaCompra.dataEmissao}) >= now() - interval '10 days'`,
              sql`coalesce(${schema.notaCompra.situacao}, '') <> 'CANCELADA'`,
            ),
      ),
    )
    .orderBy(desc(schema.notaCompra.dataEmissao))
    .limit(limite);

  if (resumos.length === 0) {
    return {
      filialId: opts.filialId,
      chavesManifestadas: [],
      chavesComErro: [],
      totalTentado: 0,
      retornos: [],
    };
  }

  // Busca cert ativo (proprio ou compartilhado da mesma org)
  const row = await findActiveCertForFilial(opts.filialId);
  if (!row) throw new Error('filial sem certificado A1 disponivel (nem proprio nem compartilhado)');
  const cnpj = row.filialCnpj;

  const pfxBytes = await baixarPfx(row.pfxStoragePath);
  const senhaPfx = decifrarSenha(row.senhaCifrada);

  const eventos: EventoManifestacao[] = resumos.map((r) => ({
    chave: r.chave,
    // Ciência da Operação = 210210 (NÃO 210200, que é Confirmação). A SEFAZ valida
    // o detEvento contra o schema do tpEvento: 210210 exige descEvento="Ciencia da
    // Operacao". Usar 210200 dava cStat 493 (schema específico). Ciência é a
    // manifestação leve que destrava o XML completo sem comprometer a empresa.
    tpEvento: '210210',
    descEvento: 'Ciencia da Operacao',
    nSeqEvento: 1,
  }));

  const { retornos } = await enviarEventosManifestacao({
    pfxBytes,
    senhaPfx,
    cnpj,
    eventos,
    tpAmb: opts.tpAmb ?? 1,
  });

  const chavesManifestadas: string[] = [];
  const chavesComErro: { chave: string; motivo: string }[] = [];

  for (const r of retornos) {
    if (CSTAT_EVENTO_OK.has(r.cStat)) {
      chavesManifestadas.push(r.chave);
    } else {
      chavesComErro.push({ chave: r.chave, motivo: `${r.cStat} ${r.xMotivo}` });
    }
  }

  // Marca as notas manifestadas — usa origem SEFAZ_DFE_RESUMO_CIENTE pra
  // diferenciar dos que ainda não foram manifestados (evita re-envio).
  // Na próxima consulta DF-e, o procNFe completo vai chegar e dar UPDATE.
  if (chavesManifestadas.length > 0) {
    await db
      .update(schema.notaCompra)
      .set({ origemImportacao: 'SEFAZ_DFE_RESUMO_CIENTE' })
      .where(
        and(
          eq(schema.notaCompra.filialId, opts.filialId),
          inArray(schema.notaCompra.chave, chavesManifestadas),
        ),
      );
  }

  return {
    filialId: opts.filialId,
    chavesManifestadas,
    chavesComErro,
    totalTentado: resumos.length,
    retornos,
  };
}

/** Confirmação da Operação (210200) nas notas resumo informadas.
 *  É o caminho pra nota que passou dos 10 dias da ciência (a SEFAZ aceita
 *  confirmação até 180 dias) e também libera o XML completo. DIFERENTE da
 *  ciência, é declaração conclusiva de que a mercadoria/serviço foi recebido —
 *  por isso só roda com chaves escolhidas por quem clicou, nunca no cron. */
export async function confirmarOperacao(opts: {
  filialId: string;
  chaves: string[];
  tpAmb?: 1 | 2;
}): Promise<ResultadoManifestacao> {
  const vazio: ResultadoManifestacao = {
    filialId: opts.filialId,
    chavesManifestadas: [],
    chavesComErro: [],
    totalTentado: 0,
    retornos: [],
  };
  if (opts.chaves.length === 0) return vazio;

  const resumos = await db
    .select({ chave: schema.notaCompra.chave })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, opts.filialId),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
        inArray(schema.notaCompra.chave, opts.chaves.slice(0, 50)),
        sql`coalesce(${schema.notaCompra.situacao}, '') <> 'CANCELADA'`,
      ),
    );
  if (resumos.length === 0) return vazio;

  const row = await findActiveCertForFilial(opts.filialId);
  if (!row) throw new Error('filial sem certificado A1 disponivel (nem proprio nem compartilhado)');
  const pfxBytes = await baixarPfx(row.pfxStoragePath);
  const senhaPfx = decifrarSenha(row.senhaCifrada);

  const { retornos } = await enviarEventosManifestacao({
    pfxBytes,
    senhaPfx,
    cnpj: row.filialCnpj,
    eventos: resumos.map((r) => ({
      chave: r.chave,
      tpEvento: '210200',
      descEvento: 'Confirmacao da Operacao',
      nSeqEvento: 1,
    })),
    tpAmb: opts.tpAmb ?? 1,
  });

  const chavesManifestadas: string[] = [];
  const chavesComErro: { chave: string; motivo: string }[] = [];
  for (const r of retornos) {
    if (CSTAT_EVENTO_OK.has(r.cStat)) chavesManifestadas.push(r.chave);
    else chavesComErro.push({ chave: r.chave, motivo: `${r.cStat} ${r.xMotivo}` });
  }

  // Mesmo estado da ciência: manifestada, aguardando o XML completo.
  if (chavesManifestadas.length > 0) {
    await db
      .update(schema.notaCompra)
      .set({ origemImportacao: 'SEFAZ_DFE_RESUMO_CIENTE' })
      .where(
        and(
          eq(schema.notaCompra.filialId, opts.filialId),
          inArray(schema.notaCompra.chave, chavesManifestadas),
        ),
      );
  }

  return {
    filialId: opts.filialId,
    chavesManifestadas,
    chavesComErro,
    totalTentado: resumos.length,
    retornos,
  };
}
