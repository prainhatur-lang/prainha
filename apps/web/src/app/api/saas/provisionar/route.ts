// POST /api/saas/provisionar — cria a loja e o login de quem se cadastrou no
// /conheca (02/11/2026). Só existe na INSTÂNCIA DOS CLIENTES
// (CONCILIA_INSTANCIA=clientes), que tem banco próprio e nenhum dado do
// Prainha; no app do Prainha responde 404. Quem chama é o /api/conheca/cadastro
// do Prainha, com o segredo SAAS_PROVISAO_SECRET no Authorization.
//
// Cria (idempotente pelo documento): organizacao + filial (cnpj = CPF/CNPJ) +
// usuário no Supabase Auth com senha provisória (troca no 1º acesso, flag
// trocar_senha) + usuario + usuario_filial DONO + grupo "Dono" DA ORGANIZAÇÃO
// com todas as permissões. Nunca usa o grupo global 'Admin' (ehAdmin é global).
// E-mail que já tem login aqui: a senha NÃO muda (senão um cadastro público
// tomaria a conta de outro); a loja nova só entra no acesso dele.

import { NextResponse } from 'next/server';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { ehInstanciaClientes } from '@/lib/instancia';
import { invalidarCachePermissoes } from '@/lib/permissoes-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function autorizado(req: Request): boolean {
  const segredo = process.env.SAAS_PROVISAO_SECRET || '';
  if (segredo.length < 24) return false;
  const veio = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(veio);
  const b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

function senhaProvisoria(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += letras[randomInt(letras.length)];
  return s;
}

function slug(txt: string): string {
  return (
    txt
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'loja'
  );
}

async function codigoLivre(base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const c = i === 0 ? base : `${base}-${i + 1}`;
    const [ja] = await db
      .select({ id: schema.organizacao.id })
      .from(schema.organizacao)
      .where(eq(schema.organizacao.codigo, c))
      .limit(1);
    if (!ja) return c;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

async function criarAuth(email: string, senha: string, nome: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { trocar_senha: true, nome },
    }),
  });
  if (!r.ok) throw new Error(`auth ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return ((await r.json()) as { id: string }).id;
}

export async function POST(req: Request) {
  if (!ehInstanciaClientes()) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!autorizado(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const txt = (k: string, max: number) => String(b?.[k] ?? '').trim().slice(0, max);
  const documento = txt('documento', 20).replace(/\D/g, '');
  const email = txt('email', 200).toLowerCase();
  const responsavel = txt('responsavel', 200);
  const nomeFantasia = txt('nomeFantasia', 200);
  const razaoSocial = txt('razaoSocial', 200);
  if (![11, 14].includes(documento.length) || !email.includes('@') || !responsavel || !nomeFantasia) {
    return NextResponse.json({ error: 'dados incompletos' }, { status: 400 });
  }

  // Loja: uma por documento.
  let [fil] = await db
    .select({ id: schema.filial.id, organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.cnpj, documento))
    .limit(1);
  let codigo: string | null = null;
  if (!fil) {
    codigo = await codigoLivre(slug(nomeFantasia));
    const [org] = await db
      .insert(schema.organizacao)
      .values({
        nome: razaoSocial || nomeFantasia,
        cnpjRaiz: documento.length === 14 ? documento.slice(0, 8) : null,
        codigo,
      })
      .returning({ id: schema.organizacao.id });
    const [nova] = await db
      .insert(schema.filial)
      .values({
        organizacaoId: org!.id,
        nome: nomeFantasia,
        cnpj: documento,
        agenteToken: 'agt_' + randomBytes(32).toString('base64url'),
      })
      .returning({ id: schema.filial.id, organizacaoId: schema.filial.organizacaoId });
    fil = nova!;
  } else {
    const [org] = await db
      .select({ codigo: schema.organizacao.codigo })
      .from(schema.organizacao)
      .where(eq(schema.organizacao.id, fil.organizacaoId))
      .limit(1);
    codigo = org?.codigo ?? null;
  }

  // Login: e-mail que já existe aqui mantém a senha dele.
  let senha: string | null = null;
  let [usu] = await db
    .select({ id: schema.usuario.id })
    .from(schema.usuario)
    .where(eq(schema.usuario.email, email))
    .limit(1);
  if (!usu) {
    senha = senhaProvisoria();
    let id: string;
    try {
      id = await criarAuth(email, senha, responsavel);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'falha ao criar o login', organizacaoId: fil.organizacaoId, filialId: fil.id },
        { status: 502 },
      );
    }
    await db.insert(schema.usuario).values({ id, email, nome: responsavel }).onConflictDoNothing();
    usu = { id };
  }

  await db
    .insert(schema.usuarioFilial)
    .values({ usuarioId: usu.id, filialId: fil.id, role: 'DONO' })
    .onConflictDoNothing();

  // Grupo "Dono" da própria organização, com o catálogo inteiro.
  await db
    .insert(schema.grupoUsuario)
    .values({
      organizacaoId: fil.organizacaoId,
      nome: 'Dono',
      descricao: 'Dono da empresa: todos os módulos (criado no cadastro do site).',
      sistema: false,
    })
    .onConflictDoNothing();
  const [grupo] = await db
    .select({ id: schema.grupoUsuario.id })
    .from(schema.grupoUsuario)
    .where(and(eq(schema.grupoUsuario.organizacaoId, fil.organizacaoId), eq(schema.grupoUsuario.nome, 'Dono')))
    .limit(1);
  if (grupo) {
    const perms = await db.select({ id: schema.permissao.id }).from(schema.permissao);
    if (perms.length) {
      await db
        .insert(schema.grupoPermissao)
        .values(perms.map((p) => ({ grupoId: grupo.id, permissaoId: p.id })))
        .onConflictDoNothing();
    }
    await db
      .insert(schema.usuarioGrupo)
      .values({ usuarioId: usu.id, grupoId: grupo.id, filialId: fil.id })
      .onConflictDoNothing();
  }
  invalidarCachePermissoes(usu.id);

  const base = (process.env.SAAS_LOGIN_URL || new URL(req.url).origin).replace(/\/+$/, '');
  return NextResponse.json({
    ok: true,
    organizacaoId: fil.organizacaoId,
    filialId: fil.id,
    usuarioId: usu.id,
    codigoEmpresa: codigo,
    email,
    senhaProvisoria: senha,
    loginUrl: `${base}/login`,
  });
}
