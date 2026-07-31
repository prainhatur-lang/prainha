// Resolve qual certificado A1 usar pra consultar SEFAZ em nome de uma filial.
//
// Logica:
//   1. Se a filial tem cert proprio ativo -> usa ele
//   2. Senao, busca cert ativo em outra filial da MESMA organizacao com
//      compartilhar_organizacao=true (ex: cert da matriz vale pras filiais)
//   3. Se nada bate, retorna null (chamador trata como "filial sem cert")
//
// O ultimoNsu e' lido da tabela cert_filial_nsu (per cert+filial) — necessario
// pq cada filial tem sequencia NSU propria na SEFAZ (per CNPJ destinatario).

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export interface CertificadoParaFilial {
  /** Id do registro em certificado_filial */
  certId: string;
  /** Path no Supabase Storage do PFX */
  pfxStoragePath: string;
  /** Senha cifrada (use decifrarSenha pra abrir) */
  senhaCifrada: string;
  /** CNPJ do certificado */
  cnpjCertificado: string | null;
  /** ultimoNsu pra esse par (cert, filial) — checkpoint da SEFAZ DF-e */
  ultimoNsu: string | null;
  /** CNPJ da filial que vamos usar pra consulta */
  filialCnpj: string;
  /** Id da filial (echo do input) */
  filialId: string;
  /** Indica se esse cert pertence a propria filial ou foi compartilhado de outra */
  compartilhado: boolean;
}

/** Busca/cria a linha de cert_filial_nsu pra esse par e retorna o ultimoNsu atual. */
async function getOuCriarNsu(certId: string, filialId: string): Promise<string> {
  const [existente] = await db
    .select({ ultimoNsu: schema.certFilialNsu.ultimoNsu })
    .from(schema.certFilialNsu)
    .where(
      and(
        eq(schema.certFilialNsu.certId, certId),
        eq(schema.certFilialNsu.filialId, filialId),
      ),
    )
    .limit(1);
  if (existente) return existente.ultimoNsu;

  // Primeira vez consultando essa filial com esse cert — cria checkpoint zerado
  await db
    .insert(schema.certFilialNsu)
    .values({ certId, filialId, ultimoNsu: '000000000000000' })
    .onConflictDoNothing();
  return '000000000000000';
}

export async function findActiveCertForFilial(
  filialId: string,
): Promise<CertificadoParaFilial | null> {
  // 1. Tenta cert proprio
  const [proprio] = await db
    .select({
      certId: schema.certificadoFilial.id,
      pfxStoragePath: schema.certificadoFilial.pfxStoragePath,
      senhaCifrada: schema.certificadoFilial.senhaCifrada,
      cnpjCertificado: schema.certificadoFilial.cnpjCertificado,
      filialCnpj: schema.filial.cnpj,
      filialId: schema.filial.id,
    })
    .from(schema.certificadoFilial)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.certificadoFilial.filialId))
    .where(
      and(
        eq(schema.certificadoFilial.filialId, filialId),
        eq(schema.certificadoFilial.ativo, true),
      ),
    )
    .limit(1);

  if (proprio && proprio.filialCnpj) {
    const ultimoNsu = await getOuCriarNsu(proprio.certId, filialId);
    return { ...proprio, ultimoNsu, filialCnpj: proprio.filialCnpj, compartilhado: false };
  }

  // 2. Fallback: cert compartilhado de outra filial da mesma organizacao.
  const [filialAlvo] = await db
    .select({
      id: schema.filial.id,
      cnpj: schema.filial.cnpj,
      organizacaoId: schema.filial.organizacaoId,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);

  if (!filialAlvo || !filialAlvo.organizacaoId || !filialAlvo.cnpj) return null;

  const [compartilhado] = await db
    .select({
      certId: schema.certificadoFilial.id,
      pfxStoragePath: schema.certificadoFilial.pfxStoragePath,
      senhaCifrada: schema.certificadoFilial.senhaCifrada,
      cnpjCertificado: schema.certificadoFilial.cnpjCertificado,
    })
    .from(schema.certificadoFilial)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.certificadoFilial.filialId))
    .where(
      and(
        eq(schema.certificadoFilial.ativo, true),
        eq(schema.certificadoFilial.compartilharOrganizacao, true),
        eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
      ),
    )
    .limit(1);

  if (!compartilhado) return null;

  const ultimoNsu = await getOuCriarNsu(compartilhado.certId, filialId);

  return {
    ...compartilhado,
    ultimoNsu,
    filialCnpj: filialAlvo.cnpj,
    filialId,
    compartilhado: true,
  };
}

/** Atualiza checkpoint NSU pra esse par (cert, filial). */
export async function atualizarNsu(opts: {
  certId: string;
  filialId: string;
  novoNsu: string;
}): Promise<void> {
  await db
    .insert(schema.certFilialNsu)
    .values({
      certId: opts.certId,
      filialId: opts.filialId,
      ultimoNsu: opts.novoNsu,
      ultimaConsultaEm: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.certFilialNsu.certId, schema.certFilialNsu.filialId],
      set: {
        ultimoNsu: opts.novoNsu,
        ultimaConsultaEm: new Date(),
      },
    });
}
