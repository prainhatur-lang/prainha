// Credencial Cielo por filial.
//
//   GET  → estado de cada filial (o que tem cadastrado, em PISTA — nunca o
//          segredo). Serve pra tela mostrar "usando a conta própria" ou
//          "caindo na global".
//   PUT  → grava/atualiza as chaves de UMA filial (cifradas).
//   DELETE → apaga as chaves da filial; ela volta pra env global.
//
// O segredo NUNCA volta pro navegador, nem pra quem tem permissão: a tela
// mostra "1001…7289" e a pessoa redigita se precisar trocar. Assim nem um
// print de tela nem o histórico do navegador carregam chave de cartão.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { cifrar, decifrar, pista, segredoConfigurado } from '@/lib/segredo';
import { certBateComChave, certValido } from '@/lib/sicredi-csr';
import { CHAVES_CIELO, CHAVES_CIELO_SECRETAS } from '@/lib/cielo-credenciais';
import { CHAVES_REDE, CHAVES_REDE_SECRETAS } from '@/lib/rede-credenciais';
import { CHAVES_SICREDI, CHAVES_SICREDI_SECRETAS } from '@/lib/sicredi-pix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Provedores na mesma tabela: 'cielo' (padrão), 'rede' (e.Rede) e 'sicredi'
// (API Pix direto na conta: Client ID/Secret + .cer/.key em base64).
type Provedor = 'cielo' | 'rede' | 'sicredi';
const provedorDe = (v: unknown): Provedor => (v === 'rede' ? 'rede' : v === 'sicredi' ? 'sicredi' : 'cielo');
const chavesDe = (p: Provedor): readonly string[] =>
  p === 'rede' ? CHAVES_REDE : p === 'sicredi' ? CHAVES_SICREDI : CHAVES_CIELO;
const secretasDe = (p: Provedor): readonly string[] =>
  p === 'rede' ? CHAVES_REDE_SECRETAS : p === 'sicredi' ? CHAVES_SICREDI_SECRETAS : CHAVES_CIELO_SECRETAS;

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.read');
  if (error) return error;
  const PROVEDOR = provedorDe(new URL(request.url).searchParams.get('provedor'));

  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) return NextResponse.json({ filiais: [], segredoConfigurado: segredoConfigurado() });

  const linhas = await db
    .select({
      filialId: schema.filialCredencial.filialId,
      chave: schema.filialCredencial.chave,
      pista: schema.filialCredencial.pista,
      atualizadoEm: schema.filialCredencial.atualizadoEm,
    })
    .from(schema.filialCredencial)
    .where(and(
      inArray(schema.filialCredencial.filialId, filiais.map((f) => f.id)),
      eq(schema.filialCredencial.provedor, PROVEDOR),
    ));

  const porFilial = new Map<string, Record<string, { pista: string | null; atualizadoEm: string }>>();
  for (const l of linhas) {
    const m = porFilial.get(l.filialId) ?? {};
    m[l.chave] = { pista: l.pista, atualizadoEm: l.atualizadoEm.toISOString() };
    porFilial.set(l.filialId, m);
  }

  return NextResponse.json({
    segredoConfigurado: segredoConfigurado(),
    provedor: PROVEDOR,
    chaves: chavesDe(PROVEDOR),
    secretas: secretasDe(PROVEDOR),
    filiais: filiais.map((f) => ({
      id: f.id,
      nome: f.nome,
      // Sem cadastro = a filial cobra pela credencial global do .env.
      propria: porFilial.has(f.id),
      valores: porFilial.get(f.id) ?? {},
    })),
  });
}

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;

  if (!segredoConfigurado()) {
    return NextResponse.json(
      { error: 'CREDENCIAL_SECRET não está configurada no servidor — sem ela não dá pra guardar credencial em segurança.' },
      { status: 503 },
    );
  }

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });
  const PROVEDOR = provedorDe(b?.provedor);

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const valores = { ...((b?.valores ?? {}) as Record<string, unknown>) };

  // Sicredi: o .cer tem que ser da chave privada — senão a casa fica com a
  // credencial "salva" e o Pix não sai. Confere com o .key enviado agora, senão
  // com a chave do pedido gerado aqui (keyPendente), senão com a já salva.
  let promoverPendente = false;
  if (PROVEDOR === 'sicredi') {
    const cert = typeof valores.cert === 'string' ? valores.cert.trim() : '';
    const keyNova = typeof valores.key === 'string' ? valores.key.trim() : '';
    if (cert || keyNova) {
      const salvas = await db
        .select({ chave: schema.filialCredencial.chave, valor: schema.filialCredencial.valor })
        .from(schema.filialCredencial)
        .where(and(
          eq(schema.filialCredencial.filialId, filialId),
          eq(schema.filialCredencial.provedor, 'sicredi'),
          inArray(schema.filialCredencial.chave, ['cert', 'key', 'keyPendente']),
        ));
      const salva = (k: string) => {
        const l = salvas.find((x) => x.chave === k);
        try { return l ? decifrar(l.valor) : ''; } catch { return ''; }
      };
      if (cert && !certValido(cert).ok) {
        return NextResponse.json({ error: 'O arquivo do certificado não é um .cer válido.' }, { status: 400 });
      }
      const certFinal = cert || salva('cert');
      if (certFinal) {
        if (keyNova) {
          if (!certBateComChave(certFinal, keyNova)) {
            return NextResponse.json(
              { error: 'O certificado (.cer) não é desta chave privada (.key). Confira se os dois são do mesmo pedido.' },
              { status: 400 },
            );
          }
        } else if (cert) {
          const pend = salva('keyPendente');
          const atual = salva('key');
          if (pend && certBateComChave(cert, pend)) {
            valores.key = pend;
            promoverPendente = true;
          } else if (!(atual && certBateComChave(cert, atual))) {
            return NextResponse.json(
              {
                error: pend || atual
                  ? 'Este certificado não é do pedido gerado aqui nem da chave salva. Envie o .cer que a Sicredi devolveu para o último pedido (ou envie o .key junto).'
                  : 'Falta a chave privada: gere o pedido de certificado aqui (botão "Gerar pedido") ou envie o .key junto com o .cer.',
              },
              { status: 400 },
            );
          }
        }
      }
    }
  }

  let gravadas = 0;
  for (const chave of chavesDe(PROVEDOR)) {
    const bruto = valores[chave];
    // Campo em branco = "não mexi nesse" (a tela nunca devolve o segredo, só
    // a pista). Pra apagar tudo existe o DELETE.
    if (typeof bruto !== 'string' || !bruto.trim()) continue;
    const valor = bruto.trim();
    await db
      .insert(schema.filialCredencial)
      .values({
        filialId,
        provedor: PROVEDOR,
        chave,
        valor: cifrar(valor),
        pista: pista(valor),
        atualizadoPor: user.id,
      })
      .onConflictDoUpdate({
        target: [schema.filialCredencial.filialId, schema.filialCredencial.provedor, schema.filialCredencial.chave],
        set: {
          valor: cifrar(valor),
          pista: pista(valor),
          atualizadoPor: user.id,
          atualizadoEm: new Date(),
        },
      });
    gravadas += 1;
  }

  if (promoverPendente) {
    // A chave do pedido virou a chave em uso; o pedido está atendido.
    await db
      .delete(schema.filialCredencial)
      .where(and(
        eq(schema.filialCredencial.filialId, filialId),
        eq(schema.filialCredencial.provedor, 'sicredi'),
        inArray(schema.filialCredencial.chave, ['keyPendente', 'csr']),
      ));
  }

  return NextResponse.json({ ok: true, gravadas, chaveDoPedido: promoverPendente });
}

export async function DELETE(request: Request) {
  const { user, error } = await exigirPermApi('configuracao.editar');
  if (error) return error;

  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filialId') ?? '';
  const PROVEDOR = provedorDe(sp.get('provedor'));
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  await db
    .delete(schema.filialCredencial)
    .where(and(
      eq(schema.filialCredencial.filialId, filialId),
      eq(schema.filialCredencial.provedor, PROVEDOR),
    ));

  return NextResponse.json({ ok: true });
}
