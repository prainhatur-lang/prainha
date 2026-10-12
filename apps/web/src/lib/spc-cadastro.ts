// NORMA DO DONO (12/10/2026): toda vez que um CPF é consultado e o SPC devolve
// o cadastro, esses dados viram CADASTRO DE CLIENTE em todas as casas — não
// ficam só na tabela de consultas (`spc_consulta`).
//
// Até aqui a reserva do site consultava, pagava, guardava a consulta e só
// ligava a reserva a um cliente quando ele JÁ existia no PDV: gente nova
// ficava sem cadastro nenhum.
//
// O CODIGO do cliente nasce na loja (ver /api/clientes), então aqui não se
// cria linha em `cliente`: enfileira `criar_cliente` pra cada casa que ainda
// não tem esse CPF, e o cadastro chega na nuvem pelo sync. Idempotente — casa
// que já tem o CPF, ou já tem o pedido de criação na fila, é pulada.

import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ErroCadastro, normalizarCliente, type CamposCliente } from '@/lib/cliente-cadastro';
import { ehStatusNaoNome } from '@/lib/spc';

export interface DadosDoSpc {
  nome: string | null;
  email?: string | null;
  /** Celular (DDD + número). */
  telefone?: string | null;
  nascimento?: string | null;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
}

/** "MARIA DA SILVA" → "Maria da Silva". */
export function nomeProprio(nome: string): string {
  return nome
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\s(Da|De|Do|Das|Dos|E)(?=\s)/g, (m) => m.toLowerCase());
}

/**
 * Garante o cadastro do cliente em todas as casas do grupo a partir do que o
 * SPC devolveu. Nunca estoura: é efeito colateral de uma consulta, e a
 * reserva/pedido que disparou a consulta não pode cair por causa dele.
 * Devolve em quantas casas o cadastro foi pedido.
 */
export async function gravarCadastroDoSpc(
  cpf: string,
  d: DadosDoSpc,
  filialId: string,
  opts: { pularOrigem?: boolean } = {},
): Promise<number> {
  try {
    const doc = cpf.replace(/\D/g, '');
    const nomeBruto = (d.nome ?? '').trim();
    if (doc.length !== 11 || nomeBruto.length < 2 || ehStatusNaoNome(nomeBruto)) return 0;

    const [origem] = await db
      .select({ organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    if (!origem?.organizacaoId) return 0;

    // Só casa com loja viva: fila de loja que não responde há uma semana
    // (ambiente de teste, casa desligada) só acumularia comando.
    const casas = await db
      .select({ id: schema.filial.id })
      .from(schema.filial)
      .where(and(
        eq(schema.filial.organizacaoId, origem.organizacaoId),
        gte(schema.filial.ultimoPing, sql`now() - interval '7 days'`),
      ));
    if (casas.length === 0) return 0;
    // No painel, quem consulta está com o formulário de cliente aberto NESTA
    // casa e vai salvar por ele (com limite de fiado etc.): criar aqui também
    // duplicaria o contato na loja. As outras casas recebem normalmente.
    const ids = casas.map((c) => c.id).filter((id) => !(opts.pularOrigem && id === filialId));
    if (ids.length === 0) return 0;

    const jaTem = await db
      .select({ filialId: schema.cliente.filialId })
      .from(schema.cliente)
      .where(and(
        inArray(schema.cliente.filialId, ids),
        isNull(schema.cliente.dataDelete),
        sql`regexp_replace(coalesce(${schema.cliente.cpfOuCnpj}, ''), '[^0-9]', '', 'g') = ${doc}`,
      ));
    const naFila = await db
      .select({ filialId: schema.agenteComando.filialId })
      .from(schema.agenteComando)
      .where(and(
        inArray(schema.agenteComando.filialId, ids),
        eq(schema.agenteComando.tipo, 'criar_cliente'),
        ne(schema.agenteComando.status, 'erro'),
        sql`${schema.agenteComando.payload}->'campos'->>'cnpjOuCpf' = ${doc}`,
      ));
    const pular = new Set([...jaTem, ...naFila].map((x) => x.filialId));
    const faltam = ids.filter((id) => !pular.has(id));
    if (faltam.length === 0) return 0;

    const fone = (d.telefone ?? '').replace(/\D/g, '');
    const cep = (d.cep ?? '').replace(/\D/g, '');
    const email = (d.email ?? '').trim();
    const nasc = (d.nascimento ?? '').trim();
    const uf = (d.uf ?? '').trim().toUpperCase();
    const completo: CamposCliente = {
      nome: nomeProprio(nomeBruto),
      cpfOuCnpj: doc,
      // Só entra o que passa na validação do cadastro: dado torto do SPC não
      // pode derrubar o cadastro inteiro.
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email: email.toLowerCase() } : {}),
      ...(fone.length >= 10 ? { celular: fone } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(nasc) && nasc >= '1900-01-01' ? { dataNascimento: nasc } : {}),
      ...(d.endereco ? { endereco: d.endereco } : {}),
      ...(d.numero ? { numero: d.numero } : {}),
      ...(d.bairro ? { bairro: d.bairro } : {}),
      ...(d.cidade ? { cidade: d.cidade } : {}),
      ...(/^[A-Z]{2}$/.test(uf) ? { uf } : {}),
      ...(cep.length === 8 ? { cep } : {}),
      observacao: 'Cadastro criado pela consulta do CPF (SPC)',
    };

    let campos;
    try {
      campos = normalizarCliente(completo, { exigirNome: true });
    } catch (e) {
      if (!(e instanceof ErroCadastro)) throw e;
      campos = normalizarCliente({ nome: completo.nome, cpfOuCnpj: doc }, { exigirNome: true });
    }

    await db.insert(schema.agenteComando).values(
      faltam.map((id) => ({
        filialId: id,
        tipo: 'criar_cliente',
        payload: { campos: campos.loja, origem: 'spc' },
      })),
    );
    return faltam.length;
  } catch (e) {
    console.error('Erro gravando o cadastro vindo do SPC:', (e as Error).message);
    return 0;
  }
}
