// POST /api/clientes/buscar  { cpf, filialId, forcarSpc? }
//
// Busca em CASCATA, do mais barato pro mais caro — a consulta ao SPC é paga,
// então ela é o ÚLTIMO recurso, nunca o primeiro:
//
//   1. cliente da filial ativa      → já é nosso cliente aqui (evita duplicar)
//   2. cliente de filial irmã       → cadastro pronto, é o mesmo grupo
//   3. base do grupo (cliente_documento) → só o nome, mas já diz que conhecemos
//   4. cache do SPC (spc_consulta)  → consulta já paga antes, de graça
//   5. SPC                          → cobra
//
// Achando cadastro nosso (1 ou 2), NÃO vai pro SPC. Quem quiser consultar
// assim mesmo manda forcarSpc — aí é decisão explícita de gastar.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { consultarCpf, cpfValido, spcConfigurado } from '@/lib/spc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Dados {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  dataNascimento: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

const vazio = (): Dados => ({
  nome: null, email: null, telefone: null, celular: null, dataNascimento: null,
  endereco: null, numero: null, complemento: null, bairro: null, cidade: null,
  uf: null, cep: null,
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const pode =
    (await podeUsuario(user.id, 'cliente.create')) ||
    (await podeUsuario(user.id, 'cliente.update'));
  if (!pode) return NextResponse.json({ error: 'sem permissão' }, { status: 403 });

  let body: { cpf?: string; filialId?: string; forcarSpc?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const cpf = String(body.cpf ?? '').replace(/\D/g, '');
  if (!cpfValido(cpf)) return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });

  const filialId = String(body.filialId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });
  }

  const [filial] = await db
    .select({ id: schema.filial.id, organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const doCliente = (c: typeof schema.cliente.$inferSelect): Dados => ({
    nome: c.nome,
    email: c.email,
    telefone: c.telefone,
    celular: c.celular,
    dataNascimento: c.dataNascimento,
    endereco: c.endereco,
    numero: c.numero,
    complemento: c.complemento,
    bairro: c.bairro,
    cidade: c.cidade,
    uf: c.uf,
    cep: c.cep,
  });

  if (!body.forcarSpc) {
    // 1. Já é cliente NESTA filial — o cadastro existe, não pode duplicar.
    const [aqui] = await db
      .select()
      .from(schema.cliente)
      .where(
        and(
          eq(schema.cliente.filialId, filialId),
          eq(schema.cliente.cpfOuCnpj, cpf),
          isNull(schema.cliente.dataDelete),
        ),
      )
      .limit(1);
    if (aqui) {
      return NextResponse.json({
        fonte: 'filial',
        clienteId: aqui.id,
        codigoExterno: aqui.codigoExterno,
        dados: doCliente(aqui),
        spcDisponivel: spcConfigurado(),
      });
    }

    // 2. Cadastro de filial irmã — mesma organização, mesmo cliente.
    if (filial.organizacaoId) {
      const [irma] = await db
        .select({ cliente: schema.cliente, filialNome: schema.filial.nome })
        .from(schema.cliente)
        .innerJoin(schema.filial, eq(schema.filial.id, schema.cliente.filialId))
        .where(
          and(
            eq(schema.filial.organizacaoId, filial.organizacaoId),
            ne(schema.cliente.filialId, filialId),
            eq(schema.cliente.cpfOuCnpj, cpf),
            isNull(schema.cliente.dataDelete),
          ),
        )
        .limit(1);
      if (irma) {
        return NextResponse.json({
          fonte: 'filial-irma',
          filialNome: irma.filialNome,
          dados: doCliente(irma.cliente),
          spcDisponivel: spcConfigurado(),
        });
      }
    }
  }

  // 3. Base do grupo: só guarda o nome (e o CPF salgado), mas já evita tratar
  //    como desconhecido quem o caixa de outra loja já atendeu.
  let nomeDoGrupo: string | null = null;
  if (filial.organizacaoId) {
    // Duas famílias de hash convivem nessa tabela:
    //  · o que a LOJA grava: sha256('::'+cpf) — nenhuma loja define
    //    CLIENTE_HASH_SALT, então na prática o salt é vazio;
    //  · os 61 mil importados do "Melhores do Ano", com o salt DAQUELE projeto.
    // Testamos os dois: sem isso, ou os importados ou os da loja ficam mudos.
    const salts = Array.from(new Set([process.env.CLIENTE_HASH_SALT ?? '', '']));
    const hashes = salts.map((s) => createHash('sha256').update(`${s}::${cpf}`).digest('hex'));
    const [doc] = await db
      .select({ nome: schema.clienteDocumento.nome })
      .from(schema.clienteDocumento)
      .where(
        and(
          eq(schema.clienteDocumento.organizacaoId, filial.organizacaoId),
          inArray(schema.clienteDocumento.cpfHash, hashes),
        ),
      )
      .limit(1);
    nomeDoGrupo = doc?.nome ?? null;
  }

  // 4 e 5. Cache do SPC e, só se não tiver, a consulta paga.
  if (!spcConfigurado()) {
    return NextResponse.json({
      fonte: nomeDoGrupo ? 'grupo' : 'nada',
      dados: { ...vazio(), nome: nomeDoGrupo },
      spcDisponivel: false,
    });
  }

  try {
    const spc = await consultarCpf(cpf, { usuarioId: user.id, filialId });
    if (!spc) {
      return NextResponse.json({
        fonte: nomeDoGrupo ? 'grupo' : 'nada',
        dados: { ...vazio(), nome: nomeDoGrupo },
        spcDisponivel: true,
      });
    }
    return NextResponse.json({
      fonte: spc.fonte === 'cache' ? 'spc-cache' : 'spc',
      dados: {
        ...vazio(),
        nome: spc.nome ?? nomeDoGrupo,
        email: spc.email,
        celular: spc.telefone,
        dataNascimento: spc.nascimento,
        endereco: spc.endereco,
        numero: spc.numero,
        bairro: spc.bairro,
        cidade: spc.cidade,
        uf: spc.uf,
        cep: spc.cep,
      },
      spcDisponivel: true,
    });
  } catch (e) {
    // SPC fora do ar não pode travar o cadastro.
    return NextResponse.json({
      fonte: nomeDoGrupo ? 'grupo' : 'nada',
      dados: { ...vazio(), nome: nomeDoGrupo },
      spcDisponivel: true,
      erroSpc: (e as Error).message,
    });
  }
}
