// POST /api/conheca/cadastro — cadastro sozinho do Concilia (SaaS), 02/11/2026.
// Público. A pessoa informa CPF ou CNPJ + contatos e o teste de 15 dias com
// TODOS os módulos começa hoje (saas_conta, status 'teste'). Um documento = um
// teste só. Também entra na lista de sempre (saas_interessado, origem
// 'cadastro') e avisa o time (SAAS_AVISO_NUMEROS). CPF é validado só pelos
// dígitos — não consulta o SPC (isto não é cliente de casa nenhuma).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { avisarEquipe } from '@/lib/atendimento/avisos';
import { validarDocumento, formatarDocumento } from '@/lib/nfce/documento';
import { buscarCnpjReceita } from '@/lib/receita-cnpj';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Dias de teste, contando hoje. */
const DIAS_TESTE = 15;
const PLANOS = ['gratis', 'essencial', 'gestao', 'completo', 'consultoria', 'nao_sei'];

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  if (String(b.site ?? '').trim()) return NextResponse.json({ ok: true, testeFim: diasAtrasBr(-(DIAS_TESTE - 1)) });

  const txt = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  const doc = validarDocumento(txt('documento', 30));
  if (!doc) return NextResponse.json({ error: 'Confira o CPF ou CNPJ.' }, { status: 400 });

  const responsavel = txt('responsavel', 200);
  const nomeFantasia = txt('nomeFantasia', 200);
  const whatsapp = txt('whatsapp', 30).replace(/\D/g, '').slice(0, 20);
  const email = txt('email', 200).toLowerCase();
  if (!responsavel || !nomeFantasia) {
    return NextResponse.json({ error: 'Preencha seu nome e o nome do restaurante.' }, { status: 400 });
  }
  if (whatsapp.length < 10) return NextResponse.json({ error: 'Informe um WhatsApp com DDD.' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Confira o e-mail.' }, { status: 400 });

  const [ja] = await db
    .select({ id: schema.saasConta.id, testeFim: schema.saasConta.testeFim })
    .from(schema.saasConta)
    .where(eq(schema.saasConta.documento, doc.doc))
    .limit(1);
  if (ja) {
    return NextResponse.json(
      { error: `Esse ${doc.tipo} já tem uma conta no Concilia. Fale com a gente pelo WhatsApp que a gente reabre o acesso.` },
      { status: 409 },
    );
  }

  // CNPJ: confere na Receita (razão social, cidade). Fora do ar → segue com o digitado.
  const rf = doc.tipo === 'CNPJ' ? await buscarCnpjReceita(doc.doc) : null;
  if (rf?.situacao && !/ativa/i.test(rf.situacao)) {
    return NextResponse.json({ error: `Esse CNPJ está ${rf.situacao.toLowerCase()} na Receita.` }, { status: 400 });
  }
  const cidade = txt('cidade', 120) || rf?.cidade || null;
  const uf = (txt('uf', 2) || rf?.uf || '').toUpperCase() || null;
  const plano = PLANOS.includes(txt('plano', 30)) ? txt('plano', 30) : null;
  const origem = txt('origem', 40).replace(/[^a-z0-9_-]/gi, '') || 'site';
  const testeInicio = hojeBr();
  const testeFim = diasAtrasBr(-(DIAS_TESTE - 1));

  const [lead] = await db
    .insert(schema.saasInteressado)
    .values({
      nome: responsavel,
      estabelecimento: nomeFantasia,
      cidade: [cidade, uf].filter(Boolean).join(' - ') || null,
      whatsapp,
      email,
      plano,
      mensagem: `Cadastro sozinho · ${doc.tipo} ${formatarDocumento(doc.doc)} · teste até ${testeFim.split('-').reverse().join('/')}`,
      origem: 'cadastro',
    })
    .returning({ id: schema.saasInteressado.id });

  try {
    await db.insert(schema.saasConta).values({
      documento: doc.doc,
      tipoDocumento: doc.tipo,
      razaoSocial: rf?.razaoSocial ?? (doc.tipo === 'CPF' ? responsavel : null),
      nomeFantasia,
      responsavel,
      email,
      whatsapp,
      cidade,
      uf,
      planoDesejado: plano,
      status: 'teste',
      testeInicio,
      testeFim,
      interessadoId: lead?.id ?? null,
      origem,
    });
  } catch (e) {
    // Duas abas ao mesmo tempo: o unique do documento barra o segundo.
    if (String((e as { code?: string }).code) === '23505') {
      return NextResponse.json({ error: `Esse ${doc.tipo} já tem uma conta no Concilia.` }, { status: 409 });
    }
    throw e;
  }

  const numeros = (process.env.SAAS_AVISO_NUMEROS || '')
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length >= 12);
  if (numeros.length) {
    await avisarEquipe(numeros, {
      motivo: `Conta de teste criada no Concilia (${doc.tipo})`,
      nomeCliente: `${responsavel} · ${nomeFantasia}`,
      telefone: whatsapp,
      filial: [cidade, uf].filter(Boolean).join(' - ') || 'site /conheca',
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, testeFim });
}
