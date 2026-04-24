// Dá ciência da operação (evento 210200) em notas que chegaram como resumo.
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
import { and, eq, inArray } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { decifrarSenha } from '@/lib/certificado';
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

/** Dá ciência (210200) em todas as notas que ainda estão como resumo na filial. */
export async function manifestarPendentes(opts: {
  filialId: string;
  /** Limite por chamada (default 50 pra não estourar timeout do Vercel). */
  limite?: number;
  tpAmb?: 1 | 2;
}): Promise<ResultadoManifestacao> {
  const limite = opts.limite ?? 50;

  // Busca notas resumo na filial
  const resumos = await db
    .select({ chave: schema.notaCompra.chave })
    .from(schema.notaCompra)
    .where(
      and(
        eq(schema.notaCompra.filialId, opts.filialId),
        eq(schema.notaCompra.origemImportacao, 'SEFAZ_DFE_RESUMO'),
      ),
    )
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

  // Busca cert ativo
  const [row] = await db
    .select({
      pfxStoragePath: schema.certificadoFilial.pfxStoragePath,
      senhaCifrada: schema.certificadoFilial.senhaCifrada,
      cnpjCertificado: schema.certificadoFilial.cnpjCertificado,
      filialCnpj: schema.filial.cnpj,
    })
    .from(schema.certificadoFilial)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.certificadoFilial.filialId))
    .where(
      and(
        eq(schema.certificadoFilial.filialId, opts.filialId),
        eq(schema.certificadoFilial.ativo, true),
      ),
    )
    .limit(1);

  if (!row) throw new Error('filial sem certificado A1 ativo');
  const cnpj = row.filialCnpj;
  if (!cnpj) throw new Error('filial sem CNPJ');

  const pfxBytes = await baixarPfx(row.pfxStoragePath);
  const senhaPfx = decifrarSenha(row.senhaCifrada);

  const eventos: EventoManifestacao[] = resumos.map((r) => ({
    chave: r.chave,
    tpEvento: '210200',
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
