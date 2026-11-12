// Testa a API Pix da Sicredi desta casa e guarda o resultado pra tela avisar
// o cliente que está "configurado e funcionando" (pedido do dono 12/11/2026,
// SaaS: quem cadastra a própria credencial precisa ver que deu certo).
//
//   POST { filialId } → pede token e lista as cobranças da última hora (não
//   cria nada na conta). Grava em filial_credencial ('teste', cifrado).
//
// Testa a credencial que a casa USA de fato: a da tela; sem ela, a da Vercel.

import { NextResponse } from 'next/server';
import { X509Certificate } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, segredoConfigurado } from '@/lib/segredo';
import { chamarSicredi, credencialSicredi } from '@/lib/sicredi-pix';
import { faltaPraPixBanco } from '@/lib/pix-cob';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.read');
  if (error) return error;
  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const em = new Date().toISOString();
  const c = await credencialSicredi(filialId);
  let ok = false;
  let erro: string | null = null;
  let certValidoAte: string | null = null;
  if (!c) {
    erro = 'Credencial incompleta: precisa de Client ID, Client Secret, certificado (.cer) e chave.';
  } else {
    try {
      certValidoAte = new X509Certificate(c.cert).validTo;
    } catch {
      /* certificado ilegível: o teste abaixo mostra o erro */
    }
    try {
      const fim = new Date();
      const inicio = new Date(fim.getTime() - 3600 * 1000);
      const q = new URLSearchParams({ inicio: inicio.toISOString(), fim: fim.toISOString() });
      const r = await chamarSicredi(c, 'GET', `/api/v2/cob?${q}`, process.env.SICREDI_SCOPE_COB || 'cob.write cob.read');
      if (r.status >= 200 && r.status < 300) ok = true;
      else erro = `A Sicredi respondeu ${r.status}: ${JSON.stringify(r.data ?? r.raw ?? '').slice(0, 200)}`;
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
  }

  const [f] = await db
    .select({ pixProvedor: schema.filial.pixProvedor })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const resultado = {
    ok,
    em,
    erro,
    fonte: c?.fonte ?? null,
    certValidoAte,
    falta: await faltaPraPixBanco('sicredi', filialId),
    ligado: f?.pixProvedor === 'sicredi',
  };

  if (segredoConfigurado()) {
    const valor = JSON.stringify(resultado);
    const pistaTeste = `${ok ? 'ok' : 'erro'} ${em.slice(0, 16)}`;
    await db
      .insert(schema.filialCredencial)
      .values({ filialId, provedor: 'sicredi', chave: 'teste', valor: cifrar(valor), pista: pistaTeste, atualizadoPor: user.id })
      .onConflictDoUpdate({
        target: [schema.filialCredencial.filialId, schema.filialCredencial.provedor, schema.filialCredencial.chave],
        set: { valor: cifrar(valor), pista: pistaTeste, atualizadoPor: user.id, atualizadoEm: new Date() },
      });
  }
  return NextResponse.json(resultado);
}
