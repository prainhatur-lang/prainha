// GET /api/nfe/consulta-destinatario?cnpj=… | ?cep=… — preenche o cadastro do
// cliente da NF-e: CNPJ na BrasilAPI (base da Receita), CEP no ViaCEP. Só
// ajuda a digitar; quem confere é quem emite.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { validarCnpj, validarCpf } from '@/lib/nfce/documento';
import { db, schema } from '@concilia/db';
import type { NfeDestinatarioSnapshot } from '@concilia/db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const str = (s: unknown) => String(s ?? '').trim();

export async function GET(req: Request) {
  const { error } = await exigirPermApi('nfce.read');
  if (error) return error;
  const url = new URL(req.url);
  const cnpj = so(url.searchParams.get('cnpj'));
  const cep = so(url.searchParams.get('cep'));

  try {
    if (cnpj) {
      if (!validarCnpj(cnpj)) return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 });
      // A BrasilAPI recusa chamada da Vercel sem User-Agent; a Minha Receita
      // devolve os mesmos campos e entra de reserva.
      let j: Record<string, unknown> | null = null;
      for (const base of ['https://brasilapi.com.br/api/cnpj/v1/', 'https://minhareceita.org/']) {
        try {
          const r = await fetch(`${base}${cnpj}`, {
            headers: { 'User-Agent': 'concilia-prainha/1.0 (app.prainhabar.com)', Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) continue;
          const c = (await r.json()) as Record<string, unknown>;
          if (str(c.razao_social)) {
            j = c;
            break;
          }
        } catch {
          /* tenta a próxima */
        }
      }
      if (!j) return NextResponse.json({ error: 'CNPJ não encontrado na Receita — preencha na mão' }, { status: 404 });
      const tipo = str(j.descricao_tipo_de_logradouro);
      return NextResponse.json({
        ok: true,
        situacao: str(j.descricao_situacao_cadastral),
        dados: {
          nome: str(j.razao_social),
          logradouro: [tipo, str(j.logradouro)].filter(Boolean).join(' '),
          numero: str(j.numero),
          complemento: str(j.complemento),
          bairro: str(j.bairro),
          codigoMunicipio: so(j.codigo_municipio_ibge),
          municipio: str(j.municipio),
          uf: str(j.uf),
          cep: so(j.cep),
          fone: so(j.ddd_telefone_1),
          email: str(j.email).toLowerCase(),
        },
      });
    }
    if (cep) {
      if (cep.length !== 8) return NextResponse.json({ error: 'CEP inválido' }, { status: 400 });
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(12000) });
      const j = r.ok ? ((await r.json()) as Record<string, unknown>) : null;
      if (!j || j.erro) return NextResponse.json({ error: 'CEP não encontrado — preencha na mão' }, { status: 404 });
      return NextResponse.json({
        ok: true,
        dados: {
          logradouro: str(j.logradouro),
          bairro: str(j.bairro),
          codigoMunicipio: so(j.ibge),
          municipio: str(j.localidade),
          uf: str(j.uf),
          cep,
        },
      });
    }
  } catch {
    return NextResponse.json({ error: 'consulta fora do ar — preencha na mão' }, { status: 503 });
  }
  return NextResponse.json({ error: 'informe cnpj ou cep' }, { status: 400 });
}

// POST { cpf } — CPF não tem consulta pública na Receita: procura no que a
// casa já tem (nota já emitida pra esse CPF, depois o cadastro de clientes das
// casas que o usuário acessa). Vai no corpo, não na URL, pra não deixar CPF em log.
export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('nfce.read');
  if (error) return error;
  const body = (await req.json().catch(() => null)) as { cpf?: unknown } | null;
  const cpf = so(body?.cpf);
  if (!validarCpf(cpf)) return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });

  const filiais = (
    await db
      .select({ id: schema.usuarioFilial.filialId })
      .from(schema.usuarioFilial)
      .where(eq(schema.usuarioFilial.usuarioId, user.id))
  ).map((f) => f.id);
  if (!filiais.length) return NextResponse.json({ error: 'sem casa liberada' }, { status: 403 });

  // 1) nota já emitida pra esse CPF — cadastro completo, já conferido por alguém
  const [nota] = await db
    .select({ dest: schema.nfeEmitida.dest })
    .from(schema.nfeEmitida)
    .where(and(inArray(schema.nfeEmitida.filialId, filiais), sql`${schema.nfeEmitida.dest}->>'documento' = ${cpf}`))
    .orderBy(desc(schema.nfeEmitida.criadoEm))
    .limit(1);
  const d = nota?.dest as NfeDestinatarioSnapshot | null | undefined;
  if (d?.nome) {
    return NextResponse.json({
      ok: true,
      origem: 'nota anterior',
      dados: {
        nome: d.nome, ie: d.ie ?? '', email: d.email ?? '', fone: d.fone ?? '', cep: d.cep,
        logradouro: d.logradouro, numero: d.numero, complemento: d.complemento ?? '', bairro: d.bairro,
        municipio: d.municipio, uf: d.uf, codigoMunicipio: d.codigoMunicipio,
      },
    });
  }

  // 2) cadastro de clientes (PDV): o mais completo primeiro
  const clientes = await db
    .select()
    .from(schema.cliente)
    .where(and(inArray(schema.cliente.filialId, filiais), eq(schema.cliente.cpfOuCnpj, cpf), isNull(schema.cliente.dataDelete)))
    .limit(30);
  const peso = (c: (typeof clientes)[number]) =>
    (str(c.endereco) ? 4 : 0) + (so(c.cep).length === 8 ? 2 : 0) + (str(c.cidade) ? 1 : 0) + (str(c.nome).includes(' ') ? 1 : 0);
  const c = clientes.filter((x) => str(x.nome) && !str(x.nome).startsWith('*')).sort((a, b) => peso(b) - peso(a))[0];
  if (!c) {
    return NextResponse.json(
      { error: 'CPF não tem consulta na Receita e não achei esse cliente no cadastro — preencha na mão (o CEP puxa o endereço)' },
      { status: 404 },
    );
  }
  const cep = so(c.cep);
  let ibge = '';
  let via: Record<string, unknown> | null = null;
  if (cep.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(8000) });
      via = r.ok ? ((await r.json()) as Record<string, unknown>) : null;
      if (via && !via.erro) ibge = so(via.ibge);
    } catch {
      /* sem o código da cidade — quem emite completa */
    }
  }
  return NextResponse.json({
    ok: true,
    origem: 'cadastro de clientes',
    dados: {
      nome: str(c.nome),
      email: str(c.email).toLowerCase(),
      fone: so(c.celular) || so(c.telefone),
      cep: cep.length === 8 ? cep : '',
      logradouro: str(c.endereco) || str(via?.logradouro),
      numero: str(c.numero),
      complemento: str(c.complemento),
      bairro: str(c.bairro) || str(via?.bairro),
      municipio: str(c.cidade) || str(via?.localidade),
      uf: str(c.uf).toUpperCase() || str(via?.uf),
      codigoMunicipio: ibge,
    },
  });
}
