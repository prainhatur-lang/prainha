// Resolve qual certificado A1 usar pra consultar SEFAZ em nome de uma filial.
//
// Logica:
//   1. Se a filial tem cert proprio ativo -> usa ele
//   2. Senao, busca cert ativo em outra filial da MESMA organizacao com
//      compartilhar_organizacao=true (ex: cert da matriz vale pras filiais)
//   3. Se nada bate, retorna null (chamador trata como "filial sem cert")

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
  /** ultimoNsu — checkpoint NSU. Null = ainda nao consultou.
   *  ATENCAO: ultimoNsu e GUARDADO POR CERT (nao por filial). Quando cert
   *  compartilhado serve N filiais, todas avancam o mesmo NSU. Pra checkpoint
   *  por filial+cert seria preciso outra tabela. Aceitavel por enquanto pq
   *  SEFAZ retorna docs por CNPJ destinatario na consulta — usar mesmo NSU
   *  significa que algumas docs podem ser re-buscadas (idempotente via chave). */
  ultimoNsu: string | null;
  /** CNPJ da filial que vamos usar pra consulta */
  filialCnpj: string;
  /** Id da filial (echo do input) */
  filialId: string;
  /** Indica se esse cert pertence a propria filial ou foi compartilhado de outra */
  compartilhado: boolean;
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
      ultimoNsu: schema.certificadoFilial.ultimoNsu,
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
    return { ...proprio, filialCnpj: proprio.filialCnpj, compartilhado: false };
  }

  // 2. Fallback: cert compartilhado de outra filial da mesma organizacao.
  //    Pega organizacao_id da filial e busca cert ativo+compartilhado de qq
  //    filial nessa mesma org.
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
      ultimoNsu: schema.certificadoFilial.ultimoNsu,
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

  return {
    ...compartilhado,
    filialCnpj: filialAlvo.cnpj,
    filialId,
    compartilhado: true,
  };
}
