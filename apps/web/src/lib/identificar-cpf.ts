// Quem é a pessoa por trás de um CPF — em cascata, do mais barato pro mais caro.
//
// A consulta ao SPC É COBRADA, então ela é o ÚLTIMO recurso, nunca o primeiro:
//
//   1. cliente da filial            → já é nosso cliente aqui (evita duplicar)
//   2. cliente de filial irmã       → cadastro pronto, é o mesmo grupo
//   3. base do grupo (cliente_documento) → só o nome, mas já diz que conhecemos
//   4. cache do SPC (spc_consulta)  → consulta já paga antes, de graça
//   5. SPC                          → cobra
//
// Achando cadastro nosso (1 ou 2), NÃO vai pro SPC.
//
// Este módulo devolve o cadastro COMPLETO e é para uso SERVIDOR. Rota pública
// (reserva do cliente) não pode repassar isso pro navegador — vira consulta de
// CPF de graça pra qualquer um. Ver `apenasIdentificacao()` no fim do arquivo.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { consultarCpf, spcConfigurado } from '@/lib/spc';

export interface DadosCliente {
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

export type FonteCliente = 'filial' | 'filial-irma' | 'grupo' | 'spc-cache' | 'spc' | 'nada';

export interface ResultadoIdentificacao {
  fonte: FonteCliente;
  /** Só quando o cadastro é DESTA filial — dá pra ligar a reserva nele. */
  clienteId?: string;
  codigoExterno?: number;
  /** Nome da filial irmã onde o cadastro foi achado. */
  filialNome?: string;
  dados: DadosCliente;
  spcDisponivel: boolean;
  erroSpc?: string;
}

export const vazio = (): DadosCliente => ({
  nome: null, email: null, telefone: null, celular: null, dataNascimento: null,
  endereco: null, numero: null, complemento: null, bairro: null, cidade: null,
  uf: null, cep: null,
});

const doCliente = (c: typeof schema.cliente.$inferSelect): DadosCliente => ({
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

/**
 * Roda a cascata. `cpf` já deve vir validado (só dígitos).
 *
 * `forcarSpc` pula as nossas bases e vai direto na consulta paga — decisão
 * explícita de gastar, só do painel interno.
 * `permitirSpc: false` corta a consulta paga: usa nossas bases e o cache, e
 * para por aí. É o modo de quem chama de rota pública sem gente logada.
 */
export async function identificarPorCpf(
  cpf: string,
  filialId: string,
  opts: { forcarSpc?: boolean; permitirSpc?: boolean; usuarioId?: string } = {},
): Promise<ResultadoIdentificacao> {
  const permitirSpc = opts.permitirSpc !== false;
  /** O CPF bateu em mais de um cadastro nosso, com nomes diferentes. Nenhum
   *  deles pode ser tratado como "a pessoa" — quem desempata é o SPC. */
  let ambiguo = false;

  const [filial] = await db
    .select({ id: schema.filial.id, organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!filial) throw new Error('filial não encontrada');

  if (!opts.forcarSpc) {
    // 1. Já é cliente NESTA filial — o cadastro existe, não pode duplicar.
    //
    // limit(2) de propósito: o mesmo CPF aparece em VÁRIOS cadastros do PDV
    // (digitação no balcão põe o CPF de um cliente na ficha de outro — um CPF
    // real chegou a ter 6 fichas na Prainha Bar, com nomes de gente
    // diferente). Pegar "o primeiro" devolve um nome ao acaso, e dizer "olá,
    // Fulano" pra quem não é Fulano é pior do que não reconhecer ninguém.
    // Empate aqui não decide nada: cai pro SPC, que é quem sabe de quem é o
    // CPF de verdade.
    const aqui = await db
      .select()
      .from(schema.cliente)
      .where(and(
        eq(schema.cliente.filialId, filialId),
        eq(schema.cliente.cpfOuCnpj, cpf),
        isNull(schema.cliente.dataDelete),
      ))
      .limit(2);
    if (aqui.length === 1) {
      const c = aqui[0]!;
      return {
        fonte: 'filial',
        clienteId: c.id,
        codigoExterno: c.codigoExterno,
        dados: doCliente(c),
        spcDisponivel: spcConfigurado(),
      };
    }
    ambiguo = aqui.length > 1;

    // 2. Cadastro de filial irmã — mesma organização, mesmo cliente.
    //    Mesma regra do passo 1: empate não decide.
    if (!ambiguo && filial.organizacaoId) {
      const irma = await db
        .select({ cliente: schema.cliente, filialNome: schema.filial.nome })
        .from(schema.cliente)
        .innerJoin(schema.filial, eq(schema.filial.id, schema.cliente.filialId))
        .where(and(
          eq(schema.filial.organizacaoId, filial.organizacaoId),
          ne(schema.cliente.filialId, filialId),
          eq(schema.cliente.cpfOuCnpj, cpf),
          isNull(schema.cliente.dataDelete),
        ))
        .limit(2);
      // Nomes iguais em filiais diferentes é a MESMA pessoa (cadastro
      // espelhado), não empate — só trava quando os nomes divergem.
      const nomesDistintos = new Set(
        irma.map((x) => (x.cliente.nome ?? '').trim().toLowerCase()).filter(Boolean),
      );
      if (irma.length >= 1 && nomesDistintos.size <= 1) {
        const i = irma[0]!;
        return {
          fonte: 'filial-irma',
          filialNome: i.filialNome,
          dados: doCliente(i.cliente),
          spcDisponivel: spcConfigurado(),
        };
      }
      ambiguo = irma.length > 1;
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
      .where(and(
        eq(schema.clienteDocumento.organizacaoId, filial.organizacaoId),
        inArray(schema.clienteDocumento.cpfHash, hashes),
      ))
      .limit(1);
    nomeDoGrupo = doc?.nome ?? null;
  }

  const semSpc = (erroSpc?: string): ResultadoIdentificacao => ({
    fonte: nomeDoGrupo ? 'grupo' : 'nada',
    dados: { ...vazio(), nome: nomeDoGrupo },
    spcDisponivel: spcConfigurado(),
    ...(erroSpc ? { erroSpc } : {}),
  });

  // 4 e 5. Cache do SPC e, só se não tiver, a consulta paga.
  if (!permitirSpc || !spcConfigurado()) return semSpc();

  try {
    const spc = await consultarCpf(cpf, { usuarioId: opts.usuarioId, filialId });
    if (!spc) return semSpc();
    return {
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
    };
  } catch (e) {
    // SPC fora do ar não pode travar o cadastro.
    return semSpc((e as Error).message);
  }
}

/** Primeiro nome, pro "Olá, Fulano". */
export function primeiroNome(nome: string | null): string | null {
  const n = (nome ?? '').trim().split(/\s+/)[0];
  if (!n || n.length < 2) return null;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** Telefone formatado pro campo de WhatsApp. Ex: 79996007289 → "(79) 99600-7289".
 *  Vai INTEIRO pro cliente: decisão do dono, pra pessoa não redigitar o que a
 *  casa já tem. Quem segura o abuso é o teto de consulta por hora na rota. */
export function telefoneFormatado(tel: string | null): string | null {
  const d = (tel ?? '').replace(/\D/g, '');
  const local = d.length > 11 ? d.slice(-11) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return null;
}
