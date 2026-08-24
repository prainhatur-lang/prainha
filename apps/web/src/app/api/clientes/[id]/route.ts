// PATCH /api/clientes/[id] — edita o cadastro do cliente.
//
// Escreve nos DOIS lugares: na nuvem (efeito imediato nas telas) e na fila do
// agente, que aplica em CONTATOS na loja. Sem a segunda parte, o próximo sync
// do Consumer sobrescreveria a edição — o Firebird é a fonte da verdade.
//
// CADASTRO ÚNICO NAS CASAS (pedido do dono, 23/08/2026): a edição ESPELHA pras
// outras filiais do usuário. Match por chave forte — CPF/CNPJ, senão
// celular/telefone — nunca por nome. Onde o cliente existe, atualiza os mesmos
// campos; onde não existe, enfileira criar_cliente com o cadastro completo
// (o CODIGO nasce na loja, e o CDC traz a linha de volta pra nuvem).

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, ne, sql, inArray } from 'drizzle-orm';
import { ErroCadastro, normalizarCliente, type CamposCliente } from '@/lib/cliente-cadastro';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cliente.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  let body: CamposCliente;
  try {
    body = (await req.json()) as CamposCliente;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const mexeNoFiado =
    'limiteCreditoContaCorrente' in body ||
    'bloquearVendaAposLimite' in body ||
    'arquivarFiado' in body;
  if (mexeNoFiado && !(await podeUsuario(user.id, 'conta_receber.update'))) {
    return NextResponse.json({ error: 'sem permissão pra mexer no fiado' }, { status: 403 });
  }

  const [cliente] = await db
    .select({
      id: schema.cliente.id,
      filialId: schema.cliente.filialId,
      codigoExterno: schema.cliente.codigoExterno,
    })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, id))
    .limit(1);
  if (!cliente) return NextResponse.json({ error: 'cliente não encontrado' }, { status: 404 });

  let campos;
  try {
    campos = normalizarCliente(body, { exigirNome: false });
  } catch (e) {
    if (e instanceof ErroCadastro) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (Object.keys(campos.nuvem).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db
    .update(schema.cliente)
    .set(campos.nuvem)
    .where(eq(schema.cliente.id, id));

  // codigoExterno <= 0 = cliente que ainda não existe no Consumer; não há o
  // que atualizar lá (o cadastro sobe pelo criar_cliente).
  let comandoId: string | null = null;
  if (cliente.codigoExterno > 0 && Object.keys(campos.loja).length > 0) {
    const [cmd] = await db
      .insert(schema.agenteComando)
      .values({
        filialId: cliente.filialId,
        tipo: 'atualizar_cliente',
        payload: { codigoExterno: cliente.codigoExterno, campos: campos.loja },
        criadoPor: user.id,
      })
      .returning({ id: schema.agenteComando.id });
    comandoId = cmd.id;
  }

  const espelhamento = await espelharNasOutrasCasas(user.id, id, cliente.filialId, campos.loja);

  return NextResponse.json({ ok: true, comandoId, espelhamento });
}

/**
 * Replica a edição pras outras filiais do usuário (cadastro único nas casas).
 * Retorna um resumo por filial pra tela mostrar o que aconteceu; nunca lança —
 * espelhar é best effort, a edição principal já foi salva.
 */
async function espelharNasOutrasCasas(
  userId: string,
  clienteId: string,
  filialOrigem: string,
  camposLoja: Record<string, string | number | null>,
): Promise<Array<{ filial: string; acao: 'atualizado' | 'criado' | 'ignorado'; motivo?: string }>> {
  try {
    // Linha fresca (já com a edição aplicada) — base do match e da criação.
    const [c] = await db
      .select()
      .from(schema.cliente)
      .where(eq(schema.cliente.id, clienteId))
      .limit(1);
    if (!c) return [];

    const doc = c.cpfOuCnpj ? c.cpfOuCnpj.replace(/\D/g, '') : '';
    const fone = (c.celular ?? c.telefone ?? '').replace(/\D/g, '');
    // Sem chave forte não tem espelho: match por nome cria cliente errado.
    if (!doc && !fone) return [];

    const outras = await db
      .select({ filialId: schema.usuarioFilial.filialId, nome: schema.filial.nome })
      .from(schema.usuarioFilial)
      .innerJoin(schema.filial, eq(schema.filial.id, schema.usuarioFilial.filialId))
      .where(
        and(
          eq(schema.usuarioFilial.usuarioId, userId),
          ne(schema.usuarioFilial.filialId, filialOrigem),
        ),
      );
    if (outras.length === 0) return [];

    // Payload COMPLETO da linha, pro criar_cliente das casas onde não existe.
    const completo = normalizarCliente(
      {
        nome: c.nome ?? undefined,
        cpfOuCnpj: c.cpfOuCnpj,
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
        observacao: c.observacao,
        limiteCreditoContaCorrente: c.limiteCreditoContaCorrente,
        bloquearVendaAposLimite: c.bloquearVendaAposLimite ?? false,
      },
      { exigirNome: true },
    );

    const resumo: Array<{ filial: string; acao: 'atualizado' | 'criado' | 'ignorado'; motivo?: string }> = [];
    const idsOutras = outras.map((o) => o.filialId);

    // Irmãos por chave forte em TODAS as outras filiais de uma vez.
    const irmaos = await db
      .select({
        id: schema.cliente.id,
        filialId: schema.cliente.filialId,
        codigoExterno: schema.cliente.codigoExterno,
      })
      .from(schema.cliente)
      .where(
        and(
          inArray(schema.cliente.filialId, idsOutras),
          isNull(schema.cliente.dataDelete),
          doc
            ? sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${doc}`
            : sql`regexp_replace(coalesce(${schema.cliente.celular}, ${schema.cliente.telefone}, ''), '[^0-9]', '', 'g') = ${fone}`,
        ),
      );
    const irmaoPorFilial = new Map(irmaos.map((i) => [i.filialId, i]));

    for (const outra of outras) {
      const irmao = irmaoPorFilial.get(outra.filialId);
      if (irmao) {
        // Existe lá: manda os MESMOS campos editados pra fila da loja. A nuvem
        // do irmão NÃO é atualizada direto — o CDC traz quando a loja aplicar;
        // escrever aqui ficaria à frente da loja e o sync sobrescreveria.
        if (irmao.codigoExterno > 0 && Object.keys(camposLoja).length > 0) {
          await db.insert(schema.agenteComando).values({
            filialId: outra.filialId,
            tipo: 'atualizar_cliente',
            payload: { codigoExterno: irmao.codigoExterno, campos: camposLoja },
            criadoPor: userId,
          });
          resumo.push({ filial: outra.nome, acao: 'atualizado' });
        } else {
          resumo.push({ filial: outra.nome, acao: 'ignorado', motivo: 'sem código do PDV' });
        }
      } else {
        // Não existe: cria o cadastro completo na loja (CODIGO nasce lá).
        await db.insert(schema.agenteComando).values({
          filialId: outra.filialId,
          tipo: 'criar_cliente',
          payload: { campos: completo.loja },
          criadoPor: userId,
        });
        resumo.push({ filial: outra.nome, acao: 'criado' });
      }
    }
    return resumo;
  } catch {
    // Espelho é best effort — a edição principal já está salva.
    return [];
  }
}
