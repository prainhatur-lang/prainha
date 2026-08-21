// Consulta cadastral no SPC (CONFIRME PF) a partir do CPF.
//
// Portado do vendas-local, onde o formato foi validado em produção — as
// pegadinhas estão comentadas em cada ponto porque custaram consulta paga pra
// descobrir. Aqui na nuvem serve o cadastro de cliente do Concilia.
//
// ⚠️ CADA CONSULTA NOVA É COBRADA. O cache (`spc_consulta`) é a peça central,
// não um detalhe de performance: mesmo CPF nunca é consultado duas vezes, e o
// resultado NEGATIVO também fica gravado (senão um CPF sem cadastro no SPC
// seria pago de novo toda vez que alguém abrisse a tela).

import { createHash } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { dateToBrYmd } from '@/lib/datas';

const SPC_URL =
  process.env.SPC_API_URL || 'https://api.spcbrasil.com.br/spcconsulta/recurso/consulta/padrao';
const SPC_PRODUTO = process.env.SPC_CODIGO_PRODUTO || '11';

export interface DadosSpc {
  nome: string | null;
  nascimento: string | null;
  mae: string | null;
  email: string | null;
  /** Celular (DDD + número), quando o SPC tem. */
  telefone: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  fonte: 'spc' | 'cache';
}

const soDig = (s: string) => String(s ?? '').replace(/\D/g, '');

export function cpfValido(cpf: string): boolean {
  const c = soDig(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const [len, pos] of [[9, 10], [10, 11]] as const) {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(c[i]) * (pos - i);
    const d = ((soma * 10) % 11) % 10;
    if (d !== Number(c[len])) return false;
  }
  return true;
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O SPC devolve o STATUS do CPF dentro do campo `nome`. Sem este filtro,
 *  "Cpf Nao Existe Na Base..." viraria o nome do cliente no cadastro. */
export function ehStatusNaoNome(nome: string): boolean {
  const n = semAcento(nome);
  if (/\d/.test(n)) return true; // nome de gente não tem número
  if (n.split(/\s+/).length > 7) return true; // frase, não nome
  return /\bcpf\b|nao existe|nao consta|nao localizad|situacao|regulariz|cancelad|suspens|falecid|inexistent|\bnula\b|\bpendente\b/.test(n);
}

/** Formato REAL do produto 11 (CONFIRME PF), conferido contra uma resposta de
 *  produção em 21/08/2026:
 *    nome · email · nomeMae · dataNascimento (epoch ms!) · cpf.numero
 *    endereco.{logradouro,numero,bairro,cep,cidade.nome,cidade.estado.siglaUf}
 *    telefoneCelular.{numeroDdd,numero} · telefoneResidencial.{...}
 *  A varredura genérica (colhe) roda depois, só pra preencher o que ficar
 *  faltando — sozinha ela confundia `cpf.numero` com o número da casa e não
 *  achava a cidade (que vem aninhada em endereco.cidade.nome). */
function extrairPf(pf: Record<string, unknown>): Partial<DadosSpc> {
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const txt = (v: unknown): string | null => {
    const t = v == null ? '' : String(v).trim();
    return t || null;
  };

  const end = obj(pf.endereco);
  const cidade = obj(end.cidade);
  const estado = obj(cidade.estado);
  const cel = obj(pf.telefoneCelular);
  const res = obj(pf.telefoneResidencial);

  // Nasce como epoch em ms. Formata em BRT: em UTC vira o dia anterior.
  let nascimento: string | null = null;
  const dn = pf.dataNascimento;
  if (typeof dn === 'number' || (typeof dn === 'string' && /^\d{10,}$/.test(dn))) {
    const d = new Date(Number(dn));
    if (!isNaN(d.getTime())) nascimento = dateToBrYmd(d);
  } else if (typeof dn === 'string') {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(dn) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(dn);
    if (m) nascimento = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
  }

  const fone = (t: Record<string, unknown>): string | null => {
    const ddd = soDig(String(t.numeroDdd ?? ''));
    const num = soDig(String(t.numero ?? ''));
    if (!num || num.length < 8) return null;
    return (ddd + num).slice(0, 15);
  };

  return {
    nome: txt(pf.nome),
    email: txt(pf.email),
    mae: txt(pf.nomeMae),
    nascimento,
    telefone: fone(cel) ?? fone(res),
    endereco: txt(end.logradouro)?.slice(0, 120) ?? null,
    // ⚠️ endereco.numero, NUNCA cpf.numero (é o próprio CPF).
    numero: txt(end.numero)?.slice(0, 20) ?? null,
    bairro: txt(end.bairro)?.slice(0, 100) ?? null,
    cidade: txt(cidade.nome)?.slice(0, 100) ?? null,
    uf: txt(estado.siglaUf)?.toUpperCase().slice(0, 2) ?? null,
    cep: end.cep ? soDig(String(end.cep)).slice(0, 8) || null : null,
  };
}

/** Cata os campos úteis em QUALQUER lugar da resposta. Cada produto do SPC
 *  muda o formato (consumidorPessoaFisica, enderecos[], telefones[]…), então
 *  em vez de fixar caminho a gente varre a árvore procurando as chaves. */
function colhe(obj: unknown): Partial<DadosSpc> {
  const out: Record<string, string | null> = {};
  const data = (v: string): string | null => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(v) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
    if (!m) return null;
    return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
  };
  const anda = (o: unknown, prof: number) => {
    if (!o || typeof o !== 'object' || prof > 6) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const K = k.toLowerCase();
      if (v && typeof v === 'object') {
        anda(v, prof + 1);
        continue;
      }
      const t = v == null ? '' : String(v).trim();
      if (!t) continue;
      if (!out.nascimento && /nascimento|dtnasc|datanasc/.test(K)) out.nascimento = data(t);
      else if (!out.mae && /(nomemae|mae)$/.test(K)) out.mae = t;
      else if (!out.telefone && /telefone|celular|fone/.test(K) && soDig(t).length >= 10)
        out.telefone = soDig(t).slice(0, 15);
      else if (!out.endereco && /logradouro|endereco/.test(K)) out.endereco = t.slice(0, 120);
      // 'numero' solto é ambíguo (cpf.numero, numeroRg, numeroTituloEleitor):
      // o número da casa vem só pelo extrairPf, de endereco.numero.
      else if (!out.bairro && /bairro/.test(K)) out.bairro = t.slice(0, 100);
      else if (!out.cidade && /cidade|municipio/.test(K)) out.cidade = t.slice(0, 100);
      else if (!out.uf && /^uf$|estado|sigla/.test(K) && t.length === 2) out.uf = t.toUpperCase();
      else if (!out.cep && /cep/.test(K) && soDig(t).length === 8) out.cep = soDig(t);
    }
  };
  anda(obj, 0);
  return out as Partial<DadosSpc>;
}

/** Tira as chaves nulas — assim o estruturado sobrepõe o genérico só onde
 *  realmente achou valor. */
function limpo(o: Partial<DadosSpc>): Partial<DadosSpc> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') out[k] = v;
  return out as Partial<DadosSpc>;
}

export function spcConfigurado(): boolean {
  return !!(process.env.SPC_USER && process.env.SPC_PASSWORD);
}

/** Diagnóstico sem revelar segredo — aspas sobrando ou espaço no valor dão
 *  "credencial recusada" e são invisíveis de qualquer outro jeito. */
export function spcStatus() {
  const fmt = (v?: string) =>
    v ? { tamanho: v.length, comeca: v.slice(0, 2) + '…', aspas: /["']/.test(v), espaco: /^\s|\s$/.test(v) } : null;
  return {
    configurado: spcConfigurado(),
    url: SPC_URL,
    produto: SPC_PRODUTO,
    usuario: fmt(process.env.SPC_USER),
    senha: fmt(process.env.SPC_PASSWORD),
  };
}

export function hashCpf(cpf: string): string {
  return createHash('sha256').update(soDig(cpf)).digest('hex');
}

/**
 * Consulta o CPF. Cache primeiro; só bate no SPC (e só aí cobra) quando o
 * documento nunca foi consultado.
 * Retorna null quando o SPC não tem cadastro útil pra esse CPF.
 */
export async function consultarCpf(
  cpf: string,
  ctx: { usuarioId?: string; filialId?: string } = {},
): Promise<DadosSpc | null> {
  const doc = soDig(cpf);
  if (!cpfValido(doc)) throw new Error('CPF inválido');

  const hash = hashCpf(doc);
  const [cache] = await db
    .select()
    .from(schema.spcConsulta)
    .where(eq(schema.spcConsulta.cpfHash, hash))
    .limit(1);

  if (cache) {
    if (!cache.nome) return null; // negativo já pago — não consulta de novo
    return {
      nome: cache.nome,
      nascimento: cache.nascimento ?? null,
      mae: cache.mae ?? null,
      email: cache.email ?? null,
      telefone: cache.telefone ?? null,
      endereco: cache.endereco ?? null,
      numero: cache.numero ?? null,
      bairro: cache.bairro ?? null,
      cidade: cache.cidade ?? null,
      uf: cache.uf ?? null,
      cep: cache.cep ?? null,
      fonte: 'cache',
    };
  }

  const user = process.env.SPC_USER;
  const senha = process.env.SPC_PASSWORD;
  if (!user || !senha) throw new Error('SPC sem credencial (SPC_USER/SPC_PASSWORD)');

  // ⚠️ O documento vai FORMATADO (000.000.000-00). Com os dígitos crus o SPC
  // responde "Cpf Nao Existe Na Base Recfederal" pra CPF válido.
  const docFmt = doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(SPC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Basic ' + Buffer.from(`${user}:${senha}`).toString('base64'),
      },
      body: JSON.stringify({
        codigoProduto: SPC_PRODUTO,
        tipoConsumidor: 'F',
        documentoConsumidor: docFmt,
        codigoInsumoOpcional: [],
      }),
      signal: ctrl.signal,
    });

    const j = (await r.json().catch(() => null)) as {
      result?: { error?: boolean | string; message?: string; return_object?: unknown };
    } | null;

    if (r.status === 401 || r.status === 403) throw new Error('SPC recusou as credenciais');
    if (r.status === 429) throw new Error('SPC: limite de consultas atingido');
    // O erro estruturado chega no corpo mesmo com HTTP 200.
    if (j?.result?.error === true || j?.result?.error === 'true') {
      throw new Error('SPC: ' + (j?.result?.message || 'erro na consulta'));
    }
    if (!r.ok) throw new Error('SPC HTTP ' + r.status);

    const pf = (
      j?.result?.return_object as
        | { resultado?: { consumidor?: { consumidorPessoaFisica?: Record<string, unknown> } } }
        | undefined
    )?.resultado?.consumidor?.consumidorPessoaFisica;

    const cru = pf?.nome ? String(pf.nome).trim() : null;
    const nome = cru && !ehStatusNaoNome(cru) ? cru : null;
    // Estruturado primeiro; a varredura genérica só tapa buraco.
    const extra: Partial<DadosSpc> = pf ? { ...colhe(pf), ...limpo(extrairPf(pf)) } : {};

    // Só grava quando a resposta DISSE algo sobre a pessoa (pf presente).
    // Resposta sem pf = formato inesperado/instabilidade; gravar esse "nada"
    // custaria a consulta pra sempre.
    if (pf) {
      await db
        .insert(schema.spcConsulta)
        .values({
          cpfHash: hash,
          nome,
          nascimento: extra.nascimento ?? null,
          mae: extra.mae ?? null,
          email: extra.email ?? null,
          telefone: extra.telefone ?? null,
          endereco: extra.endereco ?? null,
          numero: extra.numero ?? null,
          bairro: extra.bairro ?? null,
          cidade: extra.cidade ?? null,
          uf: extra.uf ?? null,
          cep: extra.cep ?? null,
          bruto: pf,
          consultadoPor: ctx.usuarioId ?? null,
          filialId: ctx.filialId ?? null,
        })
        .onConflictDoUpdate({
          target: schema.spcConsulta.cpfHash,
          set: {
            nome,
            nascimento: extra.nascimento ?? null,
            mae: extra.mae ?? null,
            email: extra.email ?? null,
            telefone: extra.telefone ?? null,
            endereco: extra.endereco ?? null,
            numero: extra.numero ?? null,
            bairro: extra.bairro ?? null,
            cidade: extra.cidade ?? null,
            uf: extra.uf ?? null,
            cep: extra.cep ?? null,
            bruto: pf,
            consultadoEm: new Date(),
          },
        });
    }

    if (!nome) return null;
    return {
      nome,
      nascimento: extra.nascimento ?? null,
      mae: extra.mae ?? null,
      email: extra.email ?? null,
      telefone: extra.telefone ?? null,
      endereco: extra.endereco ?? null,
      numero: extra.numero ?? null,
      bairro: extra.bairro ?? null,
      cidade: extra.cidade ?? null,
      uf: extra.uf ?? null,
      cep: extra.cep ?? null,
      fonte: 'spc',
    };
  } finally {
    clearTimeout(t);
  }
}
