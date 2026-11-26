// POST /api/documento/consultar  { documento, filialId }
//
// Norma do dono (26/11/2026): cadastro nenhum aceita CPF/CNPJ errado, e todo
// documento informado é CONSULTADO — primeiro no nosso cadastro; não tendo, o
// CPF vai ao SPC e o CNPJ à Receita. As telas de cadastro (funcionário,
// fornecedor) chamam aqui ao sair do campo e preenchem o nome com o que voltou.
//
// CPF passa por identificarPorCpf (regra 7: o que o SPC responde vira cadastro
// de cliente nas casas). Nada aqui grava funcionário nem fornecedor: só devolve.
//
// Resposta: { valido:false, erro } | { valido:true, tipo, documento, nome,
//   fonte, onde, dados? }   fonte: funcionario | fornecedor | cliente |
//   cliente-outra-casa | grupo | spc | receita | nada

import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { validarDocumento } from '@/lib/nfce/documento';
import { identificarPorCpf } from '@/lib/identificar-cpf';
import { buscarCnpjReceita } from '@/lib/receita-cnpj';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PERMS = [
  'funcionario.create',
  'funcionario.update',
  'fornecedor.create',
  'fornecedor.update',
  'cliente.create',
  'cliente.update',
];

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let pode = false;
  for (const p of PERMS) {
    if (await podeUsuario(user.id, p)) { pode = true; break; }
  }
  if (!pode) return NextResponse.json({ error: 'sem permissão' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { documento?: string; filialId?: string } | null;
  const filialId = String(body?.filialId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  const v = validarDocumento(String(body?.documento ?? ''));
  if (!v) {
    return NextResponse.json({
      valido: false,
      erro: 'CPF/CNPJ não confere (dígito verificador). Confira os números com o documento.',
    });
  }
  const { doc, tipo } = v;

  // Casas da mesma organização: o cadastro é um só entre elas.
  const [filial] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
  const casas = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.organizacaoId, filial.organizacaoId));
  const casaIds = casas.map((c) => c.id);
  const nomeCasa = (id: string) => casas.find((c) => c.id === id)?.nome ?? null;

  // 1) Nosso cadastro: funcionário (CPF) e fornecedor (CPF ou CNPJ).
  if (tipo === 'CPF') {
    const [f] = await db
      .select({ nome: schema.funcionario.nome, filialId: schema.funcionario.filialId, ativo: schema.funcionario.ativo })
      .from(schema.funcionario)
      .where(and(eq(schema.funcionario.cpf, doc), inArray(schema.funcionario.filialId, casaIds)))
      .limit(1);
    if (f) {
      return NextResponse.json({
        valido: true, tipo, documento: doc, nome: f.nome, fonte: 'funcionario',
        onde: `Funcionário${f.ativo ? '' : ' (desligado)'} — ${nomeCasa(f.filialId) ?? 'outra casa'}`,
      });
    }
  }
  const forns = await db
    .select({
      nome: schema.fornecedor.nome,
      razaoSocial: schema.fornecedor.razaoSocial,
      cidade: schema.fornecedor.cidade,
      uf: schema.fornecedor.uf,
      filialId: schema.fornecedor.filialId,
    })
    .from(schema.fornecedor)
    .where(
      and(
        inArray(schema.fornecedor.filialId, casaIds),
        sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${doc}`,
      ),
    )
    .limit(10);
  const forn = forns.find((x) => x.filialId === filialId) ?? forns[0];

  if (tipo === 'CNPJ') {
    if (forn) {
      return NextResponse.json({
        valido: true, tipo, documento: doc, nome: forn.nome, fonte: 'fornecedor',
        onde: `Fornecedor — ${nomeCasa(forn.filialId) ?? 'outra casa'}`,
        dados: { razaoSocial: forn.razaoSocial, cidade: forn.cidade, uf: forn.uf },
      });
    }
    const r = await buscarCnpjReceita(doc).catch(() => null);
    if (r) {
      return NextResponse.json({
        valido: true, tipo, documento: doc, nome: r.nomeFantasia ?? r.razaoSocial, fonte: 'receita',
        onde: `Receita Federal${r.situacao ? ` — ${r.situacao}` : ''}`,
        dados: { razaoSocial: r.razaoSocial, cidade: r.cidade, uf: r.uf, situacao: r.situacao },
      });
    }
    return NextResponse.json({ valido: true, tipo, documento: doc, nome: null, fonte: 'nada', onde: 'A Receita não respondeu agora.' });
  }

  // 2) CPF fora do funcionário: cadastro de cliente das casas → cache → SPC.
  try {
    const r = await identificarPorCpf(doc, filialId, { usuarioId: user.id });
    if (r.fonte !== 'nada' && r.dados.nome) {
      const onde =
        r.fonte === 'filial' ? 'Cliente desta casa'
        : r.fonte === 'filial-irma' ? `Cliente — ${r.filialNome ?? 'outra casa'}`
        : r.fonte === 'grupo' ? 'Cadastro do grupo'
        : 'SPC';
      return NextResponse.json({
        valido: true, tipo, documento: doc, nome: r.dados.nome,
        fonte: r.fonte === 'filial' ? 'cliente' : r.fonte === 'filial-irma' ? 'cliente-outra-casa' : r.fonte === 'grupo' ? 'grupo' : 'spc',
        onde,
        dados: r.dados,
      });
    }
    if (forn) {
      return NextResponse.json({
        valido: true, tipo, documento: doc, nome: forn.nome, fonte: 'fornecedor',
        onde: `Fornecedor — ${nomeCasa(forn.filialId) ?? 'outra casa'}`,
      });
    }
    return NextResponse.json({
      valido: true, tipo, documento: doc, nome: null, fonte: 'nada',
      onde: r.erroSpc ? `SPC não respondeu: ${r.erroSpc}` : r.spcDisponivel ? 'O SPC não trouxe nome pra este CPF.' : 'SPC não configurado.',
    });
  } catch (e) {
    if (forn) {
      return NextResponse.json({
        valido: true, tipo, documento: doc, nome: forn.nome, fonte: 'fornecedor',
        onde: `Fornecedor — ${nomeCasa(forn.filialId) ?? 'outra casa'}`,
      });
    }
    return NextResponse.json({ valido: true, tipo, documento: doc, nome: null, fonte: 'nada', onde: `Consulta falhou: ${(e as Error).message}` });
  }
}
