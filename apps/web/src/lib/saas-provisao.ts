// Lado Prainha do cadastro sozinho (02/11/2026): pede à INSTÂNCIA DOS
// CLIENTES (outro deploy, outro banco) que crie a loja e o login de uma
// saas_conta. Nada do cliente é criado no banco do Prainha.
//
// Só liga com as envs SAAS_INSTANCIA_URL + SAAS_PROVISAO_SECRET. Sem elas,
// devolve null e o fluxo segue como antes (loja criada à mão pelo time).

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';

export interface AcessoSaas {
  loginUrl: string;
  email: string;
  /** Null quando o e-mail já tinha login na instância (vale a senha de antes). */
  senhaProvisoria: string | null;
  codigoEmpresa: string | null;
}

export function provisaoLigada(): boolean {
  return Boolean(process.env.SAAS_INSTANCIA_URL && (process.env.SAAS_PROVISAO_SECRET || '').length >= 24);
}

export async function provisionarContaSaas(contaId: string): Promise<AcessoSaas | null> {
  if (!provisaoLigada()) return null;
  const [c] = await db.select().from(schema.saasConta).where(eq(schema.saasConta.id, contaId)).limit(1);
  if (!c) return null;

  const base = process.env.SAAS_INSTANCIA_URL!.replace(/\/+$/, '');
  let r: Response;
  try {
    r = await fetch(`${base}/api/saas/provisionar`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SAAS_PROVISAO_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documento: c.documento,
        tipoDocumento: c.tipoDocumento,
        razaoSocial: c.razaoSocial,
        nomeFantasia: c.nomeFantasia,
        responsavel: c.responsavel,
        email: c.email,
        whatsapp: c.whatsapp,
        cidade: c.cidade,
        uf: c.uf,
        testeFim: c.testeFim,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    await anotar(contaId, `Loja automática falhou: ${e instanceof Error ? e.message : 'sem resposta'}`);
    return null;
  }
  const j = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    organizacaoId?: string;
    filialId?: string;
    email?: string;
    senhaProvisoria?: string | null;
    loginUrl?: string;
    codigoEmpresa?: string | null;
  };
  if (!r.ok || !j.ok || !j.filialId || !j.loginUrl) {
    await anotar(contaId, `Loja automática falhou: ${r.status} ${j.error ?? ''}`.trim());
    return null;
  }

  // IDs são da instância dos clientes (outro banco) — guardados como referência.
  await db
    .update(schema.saasConta)
    .set({ organizacaoId: j.organizacaoId ?? null, filialId: j.filialId, atualizadoEm: new Date() })
    .where(eq(schema.saasConta.id, contaId));

  return {
    loginUrl: j.loginUrl,
    email: j.email ?? c.email,
    senhaProvisoria: j.senhaProvisoria ?? null,
    codigoEmpresa: j.codigoEmpresa ?? null,
  };
}

async function anotar(contaId: string, msg: string) {
  await db
    .update(schema.saasConta)
    .set({
      observacao: sql`concat_ws(E'\n', ${schema.saasConta.observacao}, ${msg.slice(0, 400)}::text)`,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.saasConta.id, contaId))
    .catch(() => {});
}
