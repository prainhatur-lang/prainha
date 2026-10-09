// Cadastro público de EVENTO (@/lib/eventos — soea.prainhabar.com,
// jipeshow.prainhabar.com): cria o Cliente VIP Prainha Bar do participante, já na categoria do benefício até o fim do
// evento. O cartão nasce SEM adesão: quem ativa é o dono, confirmando o celular
// pelo WhatsApp em /cartao/<token> (mesma trava de sempre).
//
// O cadastro começa pelo CPF: a pessoa informa só CPF e celular, e o nome (com
// cidade/bairro) vem da cascata de @/lib/identificar-cpf — nossas bases → cache
// → SPC. Nascimento e o resto do cadastro ficam em spc_consulta, ligados pelo
// CPF; NADA disso volta pro navegador (senão a página vira consulta de CPF de
// graça). A consulta ao SPC é paga: só acontece depois do aceite, e com teto.
//
// POST { cpf, telefone, aceite, nome?, site }   (site = isca de robô, vem vazio)
//   → { ok, url }                    cartão novo (ou o mesmo aparelho voltando)
//   → { ok:false, precisaNome }      não achamos o nome pelo CPF (SPC sem
//                                    cadastro, fora do ar ou no teto): o
//                                    formulário abre o campo de nome e reenvia
//   → { ok, existente, enviado }     o número já tinha cartão: o benefício
//                                    entra nele, mas o link NÃO volta na
//                                    resposta (o token é a senha do cartão —
//                                    quem só sabe o telefone não pode abrir)

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { carregarPrograma } from '@/lib/fidelidade/config';
import { normalizarTelefone } from '@/lib/fidelidade/codigo';
import { criarCartao, tocarPass } from '@/lib/fidelidade/nucleo';
import { baseUrl } from '@/lib/fidelidade/vista';
import { enviarTextoWhatsApp } from '@/lib/whatsapp-otp';
import { hojeBr } from '@/lib/datas';
import { hashCpf, spcConfigurado } from '@/lib/spc';
import { identificarPorCpf } from '@/lib/identificar-cpf';
import { type Evento, cpfValido, ehDoEvento, eventoAberto, nasceuEmEvento, nivelDoEvento } from '@/lib/eventos';

/** tetos por hora — o wi-fi do Centro de Convenções sai por poucos IPs, então
 *  o teto por IP é folgado; o geral segura robô. */
const MAX_IP_HORA = 60;
const MAX_GERAL_HORA = 800;
/** consultas PAGAS ao SPC que a casa pode disparar em 1 hora (somando reserva e
 *  eventos). Passou disso, o cadastro segue — só pede o nome em vez de consultar. */
const TETO_SPC_HORA = 250;

/** "MARIA DA SILVA" / "maria da silva" → "Maria da Silva" */
function ajeitarNome(bruto: unknown): string {
  let nome = String(bruto ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (nome === nome.toLowerCase() || nome === nome.toUpperCase()) {
    nome = nome
      .toLowerCase()
      .split(' ')
      .map((p, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ');
  }
  return nome;
}

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status });

export async function cadastrarNoEvento(ev: Evento, req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return erro('Dados inválidos.');
  // isca: campo escondido que gente não preenche
  if (String(b.site ?? '').trim()) return NextResponse.json({ ok: true, existente: true, enviado: false });
  if (!eventoAberto(ev)) return erro(`O benefício ${ev.doEvento} já encerrou.`, 410);

  const telefone = normalizarTelefone(b.telefone);
  if (!telefone || !/^\d{2}9\d{8}$/.test(telefone)) return erro('Informe o celular com DDD (o mesmo do seu WhatsApp).');
  const cpf = cpfValido(b.cpf);
  if (!cpf) return erro('CPF inválido. Confira os números.');
  if (b.aceite !== true) return erro('Marque a autorização pra continuar.');

  const prog = await carregarPrograma(ev.filialId);
  if (!prog.ativo) return erro(`O cartão ${ev.casa.da} está pausado no momento. Fale com a casa.`, 409);
  const nivel = nivelDoEvento(prog.config, ev);

  const ipBruto = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip';
  const ip = createHash('sha256').update(`${ev.tag}:${ipBruto}`).digest('hex').slice(0, 10);
  const umaHora = new Date(Date.now() - 3600_000);
  const T = schema.fidelidadeCartao;
  const [{ geral, doIp }] = await db
    .select({
      geral: sql<number>`count(*)::int`,
      doIp: sql<number>`count(*) filter (where ${T.origemDetalhe} like ${'%ip:' + ip + '%'})::int`,
    })
    .from(T)
    .where(and(eq(T.filialId, ev.filialId), eq(T.origem, ev.slug), gte(T.criadoEm, umaHora)));
  if (Number(doIp) >= MAX_IP_HORA || Number(geral) >= MAX_GERAL_HORA) {
    return erro('Muitos cadastros agora. Tente de novo em alguns minutos.', 429);
  }

  // um benefício por pessoa: o CPF não entra em outro telefone
  const [outroCpf] = await db
    .select({ id: T.id })
    .from(T)
    .where(and(
      eq(T.filialId, ev.filialId), eq(T.cpf, cpf), ne(T.telefone, telefone),
      sql`${T.origemDetalhe} like ${'%' + ev.tag + '%'}`,
    ))
    .limit(1);
  if (outroCpf) return erro(`Este CPF já tem o benefício ${ev.doEvento} em outro número de celular.`, 409);

  const jar = await cookies();
  const guardar = (token: string) =>
    jar.set(ev.cookie, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
  const link = (token: string) => `${baseUrl()}/cartao/${token}`;

  const [ja] = await db
    .select()
    .from(T)
    .where(and(eq(T.filialId, ev.filialId), eq(T.telefone, telefone)))
    .limit(1);

  if (ja) {
    if (ja.status !== 'ativo') return erro(`Este número tem um cartão bloqueado. Fale com a gerência ${ev.casa.da}.`, 409);
    // benefício no cartão que já existe — sem derrubar garantia que ele já tenha
    const garantiaViva = !!ja.nivelMinimo && (!ja.nivelMinimoAte || ja.nivelMinimoAte >= hojeBr());
    const set: Partial<typeof T.$inferInsert> = {};
    if (!ehDoEvento(ja, ev)) set.origemDetalhe = `${ja.origemDetalhe ? ja.origemDetalhe + ' · ' : ''}${ev.tag}`.slice(0, 300);
    // mesma categoria vinda de outro evento que acaba antes (Jipe Show → SOEA): estica a data
    const mesmaMaisCurta = ja.nivelMinimo === nivel.codigo && !!ja.nivelMinimoAte && ja.nivelMinimoAte < ev.fim;
    if ((!garantiaViva || mesmaMaisCurta) && nivel.minVisitas > 0) {
      set.nivelMinimo = nivel.codigo;
      set.nivelMinimoAte = ev.fim;
    }
    if (!ja.cpf) set.cpf = cpf;
    if (Object.keys(set).length) {
      await db.update(T).set(set).where(eq(T.id, ja.id));
      await tocarPass(ja.id);
    }
    // o mesmo aparelho voltando, ou um cadastro de evento que ainda não foi ativado
    // (só tem o que a própria pessoa digitou): pode abrir
    const mesmoAparelho = jar.get(ev.cookie)?.value === ja.token;
    if (mesmoAparelho || (nasceuEmEvento(ja) && !ja.aderidoEm)) {
      guardar(ja.token);
      return NextResponse.json({ ok: true, url: link(ja.token) });
    }
    // cartão de cliente da casa: o link só vai pro WhatsApp do dono
    const enviado = await enviarTextoWhatsApp(
      `55${telefone}`,
      `${ev.casa.nome} · ${ev.nome}\n\nSeu benefício já está no seu Cliente VIP: drink de boas-vindas e categoria ${nivel.nome} até ${ev.fimCurto}.\n\nAbra o seu cartão: ${link(ja.token)}`,
    ).catch(() => false);
    return NextResponse.json({ ok: true, existente: true, enviado });
  }

  // Quem é: nossas bases e o cache saem de graça; SPC novo só dentro do teto.
  let nome = '';
  let cidade: string | null = null;
  let bairro: string | null = null;
  try {
    let permitirSpc = spcConfigurado();
    if (permitirSpc) {
      const [jaTem] = await db
        .select({ h: schema.spcConsulta.cpfHash })
        .from(schema.spcConsulta)
        .where(eq(schema.spcConsulta.cpfHash, hashCpf(cpf)))
        .limit(1);
      if (!jaTem) {
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.spcConsulta)
          .where(and(
            eq(schema.spcConsulta.filialId, ev.filialId),
            gte(schema.spcConsulta.consultadoEm, umaHora),
          ));
        if (Number(n) >= TETO_SPC_HORA) permitirSpc = false;
      }
    }
    const r = await identificarPorCpf(cpf, ev.filialId, { permitirSpc });
    nome = ajeitarNome(r.dados.nome);
    cidade = r.dados.cidade;
    bairro = r.dados.bairro;
  } catch (e) {
    console.error(`[${ev.slug}] identificar`, (e as Error)?.message);
  }
  // não achou pelo CPF: vale o nome que a pessoa digitar (o campo só aparece nesse caso)
  if (nome.length < 3) {
    nome = ajeitarNome(b.nome);
    if (nome.length < 5 || !nome.includes(' ')) {
      return NextResponse.json({ ok: false, precisaNome: true, erro: 'Não encontramos seu cadastro pelo CPF. Informe seu nome completo.' });
    }
  }

  try {
    const { cartao } = await criarCartao({
      filialId: ev.filialId,
      nome,
      telefone,
      cpf,
      cidade,
      bairro,
      nivelMinimo: nivel.minVisitas > 0 ? nivel.codigo : null,
      nivelMinimoAte: ev.fim,
      origem: ev.slug,
      origemDetalhe: `${ev.tag} ip:${ip}`,
      aderido: false,
    });
    guardar(cartao.token);
    return NextResponse.json({ ok: true, url: link(cartao.token) });
  } catch (e) {
    console.error(`[${ev.slug}] cadastro`, (e as Error)?.message);
    return erro('Não deu certo agora. Tente de novo.', 500);
  }
}
