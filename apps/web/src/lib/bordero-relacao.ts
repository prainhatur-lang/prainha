// Relação do borderô: quem a lotérica (intermediário) tem que pagar, com CPF,
// banco/agência/conta e valor de cada pessoa.
//
// Pedido do dono (13/11/2026): "o pagamento, quando for borderô para a
// lotérica, já envia o comprovante e o borderô automaticamente". O Pix do
// borderô vai inteiro pro intermediário (Sobral); sem a relação ele não sabe
// pra quem depositar. Serve pros três tipos: folha semanal, vale-transporte e
// avulso (sem folha e sem quinzena).
//
// O valor de cada conta é o que ENTROU no borderô: valor − descontos − o que
// já estava pago ANTES de o borderô nascer. Baixa lançada depois (a lotérica
// pagou, o avulso baixou sozinho) não diminui a relação. Se a soma não bater
// com o valor do borderô, `confere` vem false — a relação não pode mentir, e
// quem envia pelo WhatsApp manda só o comprovante nesse caso.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { contasPorCpf, temConta } from '@/lib/rh/conta-da-pessoa';

export type TipoBordero = 'folha' | 'vt' | 'avulso';

export type PessoaBordero = {
  fornecedorId: string | null;
  nome: string;
  /** CPF/CNPJ formatado; null quando o cadastro não tem um documento válido. */
  documento: string | null;
  bancoNome: string | null;
  bancoAgencia: string | null;
  bancoConta: string | null;
  chavePix: string | null;
  /** Nome da casa de onde veio a conta, quando o cadastro desta casa não tem. */
  contaDeOutraCasa: string | null;
  itens: Array<{ rotulo: string; valor: number }>;
  total: number;
};

export type RelacaoBordero = {
  borderoId: string;
  filialId: string;
  casa: string;
  tipo: TipoBordero;
  /** "folha semanal de 02/11 a 08/11/2026" · "vale-transporte de …" · "pagamento avulso de 11/11/2026" */
  titulo: string;
  status: string;
  intermediario: {
    id: string | null;
    nome: string;
    /** Nome da pessoa de contato (fornecedor.contato_nome), ex.: Júnior. */
    contatoNome: string | null;
    foneWhatsapp: string | null;
  };
  contaPagarId: string | null;
  /** Valor gravado no borderô (= o que vai no Pix pro intermediário). */
  valor: number;
  vencimento: string | null; // aaaa-mm-dd
  pagoEm: string | null; // aaaa-mm-dd (conta do borderô quitada)
  criadoEm: string; // dd/mm/aaaa (BRT)
  pessoas: PessoaBordero[];
  soma: number;
  /** A soma das pessoas bate com o valor do borderô. */
  confere: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** aaaa-mm-dd → dd/mm/aaaa (sem passar por Date: não escorrega de fuso). */
export function dataBrBordero(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function periodoBr(ini: string | null, fim: string | null): string {
  const a = dataBrBordero(ini);
  const b = dataBrBordero(fim);
  if (!a || !b) return a || b;
  return a.slice(6) === b.slice(6) ? `${a.slice(0, 5)} a ${b}` : `${a} a ${b}`;
}

function documentoFormatado(doc: string | null): string | null {
  const s = (doc ?? '').replace(/\D/g, '');
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  return null;
}

/** Mesmo rótulo da tela do borderô da folha: o que vem antes do " — ". */
function rotulo(descricao: string | null): string {
  return (descricao ?? '').split(' — ')[0].replace(/ semana$/i, '').trim() || 'Pagamento';
}

const limpo = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

type LinhaBordero = {
  id: string;
  filial_id: string;
  casa: string | null;
  folha_semana_id: string | null;
  vt_quinzena_id: string | null;
  intermediario_id: string | null;
  conta_pagar_id: string | null;
  valor: string;
  vencimento: string | null;
  status: string;
  criado_br: string;
  criado_ymd: string;
  f_ini: string | null;
  f_fim: string | null;
  v_ini: string | null;
  v_fim: string | null;
  inter_nome: string | null;
  inter_razao: string | null;
  inter_fone: string | null;
  inter_contato: string | null;
  pago_em: string | null;
};

type LinhaConta = {
  id: string;
  fornecedor_id: string | null;
  descricao: string | null;
  valor: string;
  descontos: string;
  pago_antes: string;
  nome: string | null;
  doc: string | null;
  banco_nome: string | null;
  banco_agencia: string | null;
  banco_conta: string | null;
  chave_pix: string | null;
};

/** Monta a relação de um borderô. null se o borderô não existe. */
export async function relacaoDoBordero(borderoId: string): Promise<RelacaoBordero | null> {
  if (!/^[0-9a-f-]{36}$/i.test(borderoId)) return null;
  const [b] = (await db.execute(sql`
    SELECT b.id, b.filial_id, f.nome AS casa, b.folha_semana_id, b.vt_quinzena_id, b.intermediario_id,
           b.conta_pagar_id, b.valor::text AS valor, b.data_vencimento::text AS vencimento, b.status,
           to_char(b.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS criado_br,
           to_char(b.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS criado_ymd,
           fs.data_inicio::text AS f_ini, fs.data_fim::text AS f_fim,
           vq.data_inicio::text AS v_ini, vq.data_fim::text AS v_fim,
           i.nome AS inter_nome, i.razao_social AS inter_razao, i.fone_whatsapp AS inter_fone,
           coalesce(
             nullif(btrim(i.contato_nome), ''),
             (SELECT nullif(btrim(o.contato_nome), '')
                FROM fornecedor o
               WHERE o.id <> i.id AND o.data_delete IS NULL
                 AND nullif(btrim(o.contato_nome), '') IS NOT NULL
                 AND ((i.grupo_economico_id IS NOT NULL AND o.grupo_economico_id = i.grupo_economico_id)
                   OR (length(regexp_replace(coalesce(i.cnpj_ou_cpf, ''), '\\D', '', 'g')) IN (11, 14)
                       AND regexp_replace(coalesce(o.cnpj_ou_cpf, ''), '\\D', '', 'g') = regexp_replace(i.cnpj_ou_cpf, '\\D', '', 'g')))
               LIMIT 1)
           ) AS inter_contato,
           cp.data_pagamento::text AS pago_em
      FROM bordero b
      JOIN filial f ON f.id = b.filial_id
      LEFT JOIN folha_semana fs ON fs.id = b.folha_semana_id
      LEFT JOIN vt_quinzena vq ON vq.id = b.vt_quinzena_id
      LEFT JOIN fornecedor i ON i.id = b.intermediario_id
      LEFT JOIN conta_pagar cp ON cp.id = b.conta_pagar_id AND cp.data_delete IS NULL
     WHERE b.id = ${borderoId}::uuid
     LIMIT 1
  `)) as unknown as LinhaBordero[];
  if (!b) return null;

  const contas = (await db.execute(sql`
    SELECT c.id, c.fornecedor_id, c.descricao, c.valor::text AS valor,
           coalesce(c.descontos, 0)::text AS descontos,
           coalesce((SELECT sum(x.valor) FROM conta_pagar_baixa x
                      WHERE x.conta_pagar_id = c.id AND x.criado_em < bo.criado_em), 0)::text AS pago_antes,
           fo.nome, fo.cnpj_ou_cpf AS doc, fo.banco_nome, fo.banco_agencia, fo.banco_conta, fo.chave_pix
      FROM conta_pagar c
      JOIN bordero bo ON bo.id = c.bordero_id
      LEFT JOIN fornecedor fo ON fo.id = c.fornecedor_id
     WHERE c.bordero_id = ${borderoId}::uuid
       AND c.filial_id = bo.filial_id
       AND c.data_delete IS NULL
     ORDER BY fo.nome NULLS LAST, c.descricao, c.id
  `)) as unknown as LinhaConta[];

  const porPessoa = new Map<string, PessoaBordero>();
  for (const c of contas) {
    const valor = r2(Number(c.valor) - Number(c.descontos) - Number(c.pago_antes));
    if (!(valor > 0)) continue;
    // Conta sem fornecedor ligado: o nome é o que vem depois do " — ".
    const nomeDaDescricao = (c.descricao ?? '').split(' — ').slice(1).join(' — ').trim();
    const chave = c.fornecedor_id ?? `sem:${nomeDaDescricao || c.id}`;
    let p = porPessoa.get(chave);
    if (!p) {
      p = {
        fornecedorId: c.fornecedor_id,
        nome: limpo(c.nome) ?? (nomeDaDescricao || limpo(c.descricao) || '(sem nome)'),
        documento: documentoFormatado(c.doc),
        bancoNome: limpo(c.banco_nome),
        bancoAgencia: limpo(c.banco_agencia),
        bancoConta: limpo(c.banco_conta),
        chavePix: limpo(c.chave_pix),
        contaDeOutraCasa: null,
        itens: [],
        total: 0,
      };
      porPessoa.set(chave, p);
    }
    const rot = rotulo(c.descricao);
    const igual = p.itens.find((i) => i.rotulo === rot);
    if (igual) igual.valor = r2(igual.valor + valor);
    else p.itens.push({ rotulo: rot, valor });
    p.total = r2(p.total + valor);
  }
  const pessoas = [...porPessoa.values()].sort((a, b2) => a.nome.localeCompare(b2.nome, 'pt-BR'));

  // Quem não tem conta no cadastro desta casa: usa a do cadastro em outra casa
  // (mesma regra da folha — a pessoa é a mesma, o banco dela também).
  const semConta = pessoas.filter((p) => !temConta(p) && p.documento && p.documento.replace(/\D/g, '').length === 11);
  if (semConta.length > 0) {
    const outras = await contasPorCpf(semConta.map((p) => p.documento as string), b.filial_id).catch(() => null);
    if (outras) {
      for (const p of semConta) {
        const c = outras.get((p.documento as string).replace(/\D/g, ''));
        if (!c) continue;
        p.chavePix = limpo(c.chavePix);
        p.bancoNome = limpo(c.bancoNome);
        p.bancoAgencia = limpo(c.bancoAgencia);
        p.bancoConta = limpo(c.bancoConta);
        p.contaDeOutraCasa = c.filialNome;
      }
    }
  }

  const tipo: TipoBordero = b.folha_semana_id ? 'folha' : b.vt_quinzena_id ? 'vt' : 'avulso';
  const titulo =
    tipo === 'folha'
      ? `folha semanal de ${periodoBr(b.f_ini, b.f_fim) || b.criado_br}`
      : tipo === 'vt'
        ? `vale-transporte de ${periodoBr(b.v_ini, b.v_fim) || b.criado_br}`
        : `pagamento avulso de ${b.criado_br}`;
  const valor = r2(Number(b.valor));
  const soma = r2(pessoas.reduce((s, p) => s + p.total, 0));

  return {
    borderoId: b.id,
    filialId: b.filial_id,
    casa: b.casa ?? 'Prainha',
    tipo,
    titulo,
    status: b.status,
    intermediario: {
      id: b.intermediario_id,
      nome: limpo(b.inter_nome) ?? limpo(b.inter_razao) ?? 'intermediário',
      contatoNome: limpo(b.inter_contato),
      foneWhatsapp: limpo(b.inter_fone),
    },
    contaPagarId: b.conta_pagar_id,
    valor,
    vencimento: b.vencimento ? b.vencimento.slice(0, 10) : null,
    pagoEm: b.pago_em ? b.pago_em.slice(0, 10) : null,
    criadoEm: b.criado_br,
    pessoas,
    soma,
    confere: pessoas.length > 0 && Math.abs(soma - valor) < 0.005,
  };
}

/** Borderôs ATIVOS quitados por este Pix (a conta do borderô está nas contas do Pix). */
export async function borderosDoPix(pixId: string): Promise<string[]> {
  if (!/^[0-9a-f-]{36}$/i.test(pixId)) return [];
  const linhas = (await db.execute(sql`
    SELECT b.id
      FROM pix_pagamento p
      JOIN bordero b ON b.filial_id = p.filial_id AND b.status = 'ATIVO'
     WHERE p.id = ${pixId}::uuid
       AND b.conta_pagar_id::text IN (
             SELECT e->>'id' FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.conta_ids) = 'array' THEN p.conta_ids ELSE '[]'::jsonb END) e)
     ORDER BY b.criado_em, b.id
  `)) as unknown as Array<{ id: string }>;
  return linhas.map((l) => l.id);
}

/** Relações de todos os borderôs que o Pix pagou (vazio se o Pix não é de borderô). */
export async function relacoesDoPix(pixId: string): Promise<RelacaoBordero[]> {
  const out: RelacaoBordero[] = [];
  for (const id of await borderosDoPix(pixId)) {
    const r = await relacaoDoBordero(id);
    if (r) out.push(r);
  }
  return out;
}

/** Borderô ATIVO de uma conta a pagar de origem BORDERO (a conta do intermediário). */
export async function borderoDaConta(contaPagarId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contaPagarId)) return null;
  const [l] = (await db.execute(sql`
    SELECT id FROM bordero WHERE conta_pagar_id = ${contaPagarId}::uuid AND status = 'ATIVO' ORDER BY criado_em DESC LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return l?.id ?? null;
}

/** Pix PAGO pelo sistema que quitou a conta do borderô (o mais recente). */
export async function pixPagoDaConta(contaPagarId: string, filialId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contaPagarId)) return null;
  const [l] = (await db.execute(sql`
    SELECT p.id
      FROM pix_pagamento p
     WHERE p.filial_id = ${filialId}::uuid AND p.status = 'PAGO'
       AND ${contaPagarId} IN (
             SELECT e->>'id' FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.conta_ids) = 'array' THEN p.conta_ids ELSE '[]'::jsonb END) e)
     ORDER BY p.criado_em DESC
     LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return l?.id ?? null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pessoasTxt = (n: number) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;

/** Frase curta pra mensagem: "borderô da folha semanal de 02/11 a 08/11/2026 — 44 pessoas". */
export function resumoBorderos(relacoes: RelacaoBordero[]): string {
  if (relacoes.length === 0) return '';
  const um = (r: RelacaoBordero) => `borderô ${r.tipo === 'avulso' ? 'do' : r.tipo === 'vt' ? 'do' : 'da'} ${r.titulo} — ${pessoasTxt(r.pessoas.length)}`;
  if (relacoes.length === 1) return um(relacoes[0]);
  const total = relacoes.reduce((s, r) => s + r.pessoas.length, 0);
  return `${relacoes.length} borderôs (${relacoes.map((r) => r.titulo).join('; ')}) — ${pessoasTxt(total)}`;
}

/** Texto do WhatsApp (conversa aberta / wa.me) quando o borderô vai junto. */
export function textoBordero(relacoes: RelacaoBordero[], opts: { comComprovante: boolean; casa?: string }): string {
  const r0 = relacoes[0];
  const contato = r0?.intermediario.contatoNome;
  const total = r2(relacoes.reduce((s, r) => s + r.valor, 0));
  const abre = `Olá${contato ? `, ${contato}` : ''}! `;
  const corpo = opts.comComprovante
    ? `Segue o comprovante do Pix da ${opts.casa ?? r0?.casa ?? 'Prainha'} com o ${resumoBorderos(relacoes)}, ${brl(total)} no total, no mesmo PDF.`
    : `Segue o ${resumoBorderos(relacoes)}, ${brl(total)} no total, da ${opts.casa ?? r0?.casa ?? 'Prainha'}.`;
  return `${abre}${corpo} Favor depositar o valor de cada pessoa na conta indicada e devolver os comprovantes dos depósitos.`;
}
