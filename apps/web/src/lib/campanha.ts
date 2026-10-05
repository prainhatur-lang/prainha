// Campanha de convite pelo WhatsApp — template de MARKETING da Meta, mandado
// em lotes pra uma lista tirada do cadastro de clientes (CONTATOS do Consumer).
//
// A campanha (casa, template, bairros) fica aqui em código; os convidados e o
// andamento ficam em campanha_convite. Quem toca "Não quero receber" não
// recebe mais NENHUMA campanha (nem o convite do Cliente VIP recusado antes).

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { brDateStart, hojeBr } from '@/lib/datas';
import { enviarConviteCampanha } from '@/lib/whatsapp-otp';

export interface Campanha {
  slug: string;
  titulo: string;
  /** casa que convida */
  filialId: string;
  /** nome do template aprovado na Meta (categoria Marketing) */
  template: string;
  /** imagem do cabeçalho do template (URL pública) */
  imagemUrl: string;
  /** pra onde o botão do convite leva (depois de registrar o toque) */
  destino: string;
  /** grupos de bairro: nome do grupo → trechos que casam com cliente.bairro */
  bairros: Array<{ grupo: string; contem: string[] }>;
  /** texto do corpo, como foi cadastrado na Meta — só pra mostrar na tela */
  texto: string;
}

export const CAMPANHAS: Record<string, Campanha> = {
  'prainha-mar-abertura': {
    slug: 'prainha-mar-abertura',
    titulo: 'Abertura da Prainha Mar — bairros vizinhos',
    filialId: 'e899dae2-38bf-4f3f-9149-7effd059fab8',
    template: process.env.WHATSAPP_CAMPANHA_MAR_TEMPLATE || 'convite_prainha_mar',
    imagemUrl: process.env.WHATSAPP_CAMPANHA_MAR_IMAGEM || 'https://app.prainhabar.com/prainhamar/og.png',
    destino: '/prainhamar',
    bairros: [
      { grupo: 'Aruana', contem: ['aruan'] },
      { grupo: 'Farolândia', contem: ['farol'] },
      { grupo: 'Coroa do Meio', contem: ['coroa do meio'] },
      { grupo: 'Atalaia', contem: ['atalaia'] },
    ],
    texto:
      'Oi, {{1}}! Aqui é o pessoal do Prainha 🌊\n\n' +
      'A *Prainha Mar e Grill* abriu as portas no Shopping Praia Sul, na Aruana. ' +
      'É a culinária que você já conhece, agora mais perto de você: frutos do mar, moquecas e carnes na brasa.\n\n' +
      '🍹 Presente de inauguração: avalie a casa na sua visita e ganhe um drink.\n\n' +
      'Reserve sua mesa e vem conhecer!',
  },
};

/** Teto de convites por dia, somando todas as campanhas (o número é o mesmo
 *  que confirma reserva — mandar demais derruba a qualidade na Meta). */
export const CAMPANHA_CONVITES_DIA = Math.max(1, Number(process.env.CAMPANHA_CONVITES_DIA) || 250);

type Linhas<T> = T[];
const linhas = async <T,>(q: ReturnType<typeof sql>): Promise<Linhas<T>> =>
  (await db.execute(q)) as unknown as Linhas<T>;

const TITULOS = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'dona', 'seu', 'prof', 'profa', 'professor', 'professora',
  'delegado', 'delegada', 'doutor', 'doutora', 'pastor', 'pastora', 'padre', 'cliente',
  'coronel', 'capitão', 'capitao', 'major', 'sargento', 'tenente', 'vereador', 'vereadora', 'deputado', 'deputada',
]);

/** "MARIA DA SILVA" → "Maria"; nome que não é nome ("LP", e-mail) → "cliente" */
export function primeiroNome(nome: string | null): string {
  const partes = (nome ?? '').trim().split(/\s+/);
  // título na frente do nome ("Delegado Thyago", "Dra. Ana") não é o nome
  while (partes.length > 1 && TITULOS.has(partes[0].toLowerCase().replace(/\.$/, ''))) partes.shift();
  const p = partes[0] ?? '';
  if (!/^\p{L}{3,}$/u.test(p)) return 'cliente';
  return p[0].toUpperCase() + p.slice(1).toLowerCase();
}

/** Monta (ou completa) a lista de convidados a partir do cadastro de clientes
 *  das casas da organização: 1 linha por celular válido (DDD + 9 + 8 dígitos).
 *  Idempotente — quem já está na lista fica como está. */
export async function carregarLista(c: Campanha): Promise<number> {
  const quando = sql.join(
    c.bairros.flatMap((b) => b.contem.map((t) => sql`WHEN cl.bairro ILIKE ${'%' + t + '%'} THEN ${b.grupo}`)),
    sql` `,
  );
  const novos = await linhas<{ id: string }>(sql`
    WITH base AS (
      SELECT cl.filial_id, cl.codigo_externo, trim(cl.nome) AS nome, trim(cl.bairro) AS bairro,
             CASE ${quando} END AS grupo, cl.sincronizado_em,
             regexp_replace(
               regexp_replace(coalesce(nullif(trim(cl.celular), ''), cl.telefone, ''), '\\D', '', 'g'),
               '^55(?=\\d{11}$)', '') AS fone
      FROM cliente cl
      JOIN filial f ON f.id = cl.filial_id
      WHERE cl.data_delete IS NULL
        AND f.organizacao_id = (SELECT organizacao_id FROM filial WHERE id = ${c.filialId}::uuid)
    ),
    alvo AS (
      SELECT b.*, (
        SELECT max((p.data_abertura AT TIME ZONE 'America/Sao_Paulo')::date)
        FROM pedido p
        WHERE p.filial_id = b.filial_id AND p.codigo_cliente_contato_externo = b.codigo_externo
          AND p.data_delete IS NULL
      ) AS ultima
      FROM base b
      WHERE b.grupo IS NOT NULL AND b.fone ~ '^[1-9][1-9]9\\d{8}$'
    ),
    um AS (
      SELECT fone,
        (array_agg(nome ORDER BY ultima DESC NULLS LAST, sincronizado_em DESC))[1] AS nome,
        (array_agg(bairro ORDER BY ultima DESC NULLS LAST, sincronizado_em DESC))[1] AS bairro,
        (array_agg(grupo ORDER BY ultima DESC NULLS LAST, sincronizado_em DESC))[1] AS grupo,
        max(ultima) AS ultima
      FROM alvo GROUP BY fone
    )
    INSERT INTO campanha_convite (campanha, filial_id, telefone, nome, bairro, grupo, ultima_compra, token)
    SELECT ${c.slug}, ${c.filialId}::uuid, fone, left(nome, 200), left(bairro, 100), grupo, ultima,
           replace(gen_random_uuid()::text, '-', '')
    FROM um
    ON CONFLICT (campanha, telefone) DO NOTHING
    RETURNING id
  `);
  return novos.length;
}

export interface ResumoGrupo {
  grupo: string;
  total: number;
  enviados: number;
  pendentes: number;
  erros: number;
  clicaram: number;
  recusaram: number;
}

export async function resumoCampanha(c: Campanha): Promise<{ grupos: ResumoGrupo[]; enviadosHoje: number; tetoDia: number }> {
  const grupos = await linhas<ResumoGrupo>(sql`
    SELECT coalesce(grupo, '—') AS grupo, count(*)::int AS total,
      count(enviado_em)::int AS enviados,
      count(*) FILTER (WHERE enviado_em IS NULL AND erro IS NULL AND recusado_em IS NULL)::int AS pendentes,
      count(*) FILTER (WHERE enviado_em IS NULL AND erro IS NOT NULL)::int AS erros,
      count(clicou_em)::int AS clicaram,
      count(recusado_em)::int AS recusaram
    FROM campanha_convite WHERE campanha = ${c.slug}
    GROUP BY 1 ORDER BY 2 DESC
  `);
  return { grupos, enviadosHoje: await enviadosHoje(), tetoDia: CAMPANHA_CONVITES_DIA };
}

async function enviadosHoje(): Promise<number> {
  const [r] = await linhas<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM campanha_convite WHERE enviado_em >= ${brDateStart(hojeBr()).toISOString()}::timestamptz
  `);
  return Number(r?.n) || 0;
}

/** Erro que não adianta insistir no mesmo lote: token/template com problema
 *  ou a Meta segurando o número (limite de conversas / spam). */
const ERRO_PARA_LOTE = / 401| 403|template|#132|131048|131056|130429|rate limit/i;

export interface ResultadoLote {
  enviados: number;
  falhas: Array<{ nome: string; erro: string }>;
  parou: string | null;
  restanteHoje: number;
}

/** Manda o próximo lote: quem comprou há menos tempo vai primeiro. Cada linha
 *  é reservada antes do envio (dois cliques não mandam duas vezes). */
export async function enviarLote(c: Campanha, qtd: number, grupo?: string | null): Promise<ResultadoLote> {
  let saldo = CAMPANHA_CONVITES_DIA - (await enviadosHoje());
  if (saldo <= 0) return { enviados: 0, falhas: [], parou: `Limite de ${CAMPANHA_CONVITES_DIA} convites por dia atingido. Continue amanhã.`, restanteHoje: 0 };
  const n = Math.max(1, Math.min(qtd, saldo, 100));
  const filtroGrupo = grupo ? sql`AND cc.grupo = ${grupo}` : sql``;
  const lote = await linhas<{ id: string; telefone: string; nome: string | null; token: string }>(sql`
    UPDATE campanha_convite SET enviado_em = now()
    WHERE id IN (
      SELECT cc.id FROM campanha_convite cc
      WHERE cc.campanha = ${c.slug} AND cc.enviado_em IS NULL AND cc.erro IS NULL AND cc.recusado_em IS NULL
        ${filtroGrupo}
        AND NOT EXISTS (SELECT 1 FROM campanha_convite r WHERE r.telefone = cc.telefone AND r.recusado_em IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM fidelidade_cartao fc WHERE right(regexp_replace(fc.telefone, '\\D', '', 'g'), 11) = cc.telefone AND fc.recusado_em IS NOT NULL)
      ORDER BY cc.ultima_compra DESC NULLS LAST, cc.criado_em
      LIMIT ${n}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, telefone, nome, token
  `);
  let enviados = 0;
  const falhas: ResultadoLote['falhas'] = [];
  let parou: string | null = null;
  // Cada envio leva ~1 s e a função morre em 60 s: perto do fim devolve o que
  // sobrou pra fila (senão ficaria marcado como enviado sem ter saído).
  const prazo = Date.now() + 42_000;
  const devolver = async (ids: string[]) => {
    if (ids.length) {
      await db.execute(sql`UPDATE campanha_convite SET enviado_em = NULL WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }
  };
  for (let i = 0; i < lote.length; i++) {
    const l = lote[i];
    if (Date.now() > prazo) {
      await devolver(lote.slice(i).map((x) => x.id));
      break;
    }
    try {
      const waId = await enviarConviteCampanha(`55${l.telefone}`, {
        template: c.template, nome: primeiroNome(l.nome), token: l.token, imagemUrl: c.imagemUrl,
      });
      await db.execute(sql`UPDATE campanha_convite SET wa_message_id = ${waId}, erro = NULL WHERE id = ${l.id}::uuid`);
      enviados++;
      saldo--;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      falhas.push({ nome: l.nome ?? l.telefone, erro: msg });
      await db.execute(sql`UPDATE campanha_convite SET enviado_em = NULL, erro = ${msg} WHERE id = ${l.id}::uuid`);
      if (ERRO_PARA_LOTE.test(msg)) {
        parou = msg;
        // devolve o resto do lote pra fila sem marcar erro
        const resto = lote.slice(i + 1).map((x) => x.id);
        if (resto.length) {
          await db.execute(sql`UPDATE campanha_convite SET enviado_em = NULL WHERE id IN (${sql.join(resto.map((id) => sql`${id}::uuid`), sql`, `)})`);
        }
        break;
      }
    }
  }
  return { enviados, falhas, parou, restanteHoje: Math.max(0, saldo) };
}

/** Recoloca na fila quem falhou (depois de consertar o template/token). */
export async function recolocarFalhas(c: Campanha): Promise<number> {
  const r = await linhas<{ id: string }>(sql`
    UPDATE campanha_convite SET erro = NULL
    WHERE campanha = ${c.slug} AND enviado_em IS NULL AND erro IS NOT NULL RETURNING id
  `);
  return r.length;
}

/** Envio de teste: manda o template pra UM número (o do dono), fora da lista.
 *  O botão "Não quero receber" do teste não grava nada (token não existe). */
export async function enviarTeste(c: Campanha, telefone: string, nome: string): Promise<string | null> {
  let d = telefone.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (!/^[1-9][1-9]9\d{8}$/.test(d)) throw new Error('Informe um celular com DDD (ex.: 79 99999-9999).');
  return enviarConviteCampanha(`55${d}`, {
    template: c.template, nome: primeiroNome(nome), token: 'teste', imagemUrl: c.imagemUrl,
  });
}
