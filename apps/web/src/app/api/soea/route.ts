// Cadastro público da 81ª SOEA (soea.prainhabar.com): cria o Cliente VIP
// Prainha Bar do participante, já na categoria do benefício até o fim do
// evento. O cartão nasce SEM adesão: quem ativa é o dono, confirmando o celular
// pelo WhatsApp em /cartao/<token> (mesma trava de sempre).
//
// POST { nome, telefone, cpf, aceite, site }   (site = isca de robô, vem vazio)
//   → { ok, url }                    cartão novo (ou o mesmo aparelho voltando)
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
import { SOEA, cpfValido, ehSoea, nivelSoea, soeaAberta } from '@/lib/soea';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** tetos por hora — o wi-fi do Centro de Convenções sai por poucos IPs, então
 *  o teto por IP é folgado; o geral segura robô. */
const MAX_IP_HORA = 60;
const MAX_GERAL_HORA = 800;

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status });

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return erro('Dados inválidos.');
  // isca: campo escondido que gente não preenche
  if (String(b.site ?? '').trim()) return NextResponse.json({ ok: true, existente: true, enviado: false });
  if (!soeaAberta()) return erro('O benefício da 81ª SOEA já encerrou.', 410);

  let nome = String(b.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  // digitado todo em minúsculas ou maiúsculas: ajeita pro cartão ("ana da silva" → "Ana da Silva")
  if (nome === nome.toLowerCase() || nome === nome.toUpperCase()) {
    nome = nome
      .toLowerCase()
      .split(' ')
      .map((p, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ');
  }
  if (nome.length < 5 || !nome.includes(' ')) return erro('Informe nome e sobrenome.');
  const telefone = normalizarTelefone(b.telefone);
  if (!telefone || !/^\d{2}9\d{8}$/.test(telefone)) return erro('Informe o celular com DDD (o mesmo do seu WhatsApp).');
  const cpf = cpfValido(b.cpf);
  if (!cpf) return erro('CPF inválido. Confira os números.');
  if (b.aceite !== true) return erro('Marque a autorização de uso dos dados pra continuar.');

  const prog = await carregarPrograma(SOEA.filialId);
  if (!prog.ativo) return erro('O cartão do Prainha Bar está pausado no momento. Fale com a casa.', 409);
  const nivel = nivelSoea(prog.config);

  const ipBruto = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip';
  const ip = createHash('sha256').update(`${SOEA.tag}:${ipBruto}`).digest('hex').slice(0, 10);
  const umaHora = new Date(Date.now() - 3600_000);
  const T = schema.fidelidadeCartao;
  const [{ geral, doIp }] = await db
    .select({
      geral: sql<number>`count(*)::int`,
      doIp: sql<number>`count(*) filter (where ${T.origemDetalhe} like ${'%ip:' + ip + '%'})::int`,
    })
    .from(T)
    .where(and(eq(T.filialId, SOEA.filialId), eq(T.origem, 'soea'), gte(T.criadoEm, umaHora)));
  if (Number(doIp) >= MAX_IP_HORA || Number(geral) >= MAX_GERAL_HORA) {
    return erro('Muitos cadastros agora. Tente de novo em alguns minutos.', 429);
  }

  // um benefício por pessoa: o CPF não entra em outro telefone
  const [outroCpf] = await db
    .select({ id: T.id })
    .from(T)
    .where(and(
      eq(T.filialId, SOEA.filialId), eq(T.cpf, cpf), ne(T.telefone, telefone),
      sql`${T.origemDetalhe} like ${'%' + SOEA.tag + '%'}`,
    ))
    .limit(1);
  if (outroCpf) return erro('Este CPF já tem o benefício da SOEA em outro número de celular.', 409);

  const jar = await cookies();
  const guardar = (token: string) =>
    jar.set(SOEA.cookie, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
  const link = (token: string) => `${baseUrl()}/cartao/${token}`;

  const [ja] = await db
    .select()
    .from(T)
    .where(and(eq(T.filialId, SOEA.filialId), eq(T.telefone, telefone)))
    .limit(1);

  if (ja) {
    if (ja.status !== 'ativo') return erro('Este número tem um cartão bloqueado. Fale com a gerência do Prainha.', 409);
    // benefício no cartão que já existe — sem derrubar garantia que ele já tenha
    const garantiaViva = !!ja.nivelMinimo && (!ja.nivelMinimoAte || ja.nivelMinimoAte >= hojeBr());
    const set: Partial<typeof T.$inferInsert> = {};
    if (!ehSoea(ja)) set.origemDetalhe = `${ja.origemDetalhe ? ja.origemDetalhe + ' · ' : ''}${SOEA.tag}`.slice(0, 300);
    if (!garantiaViva && nivel.minVisitas > 0) {
      set.nivelMinimo = nivel.codigo;
      set.nivelMinimoAte = SOEA.fim;
    }
    if (!ja.cpf) set.cpf = cpf;
    if (Object.keys(set).length) {
      await db.update(T).set(set).where(eq(T.id, ja.id));
      await tocarPass(ja.id);
    }
    // o mesmo aparelho voltando, ou um cadastro SOEA que ainda não foi ativado
    // (só tem o que a própria pessoa digitou): pode abrir
    const mesmoAparelho = jar.get(SOEA.cookie)?.value === ja.token;
    if (mesmoAparelho || (ja.origem === 'soea' && !ja.aderidoEm)) {
      guardar(ja.token);
      return NextResponse.json({ ok: true, url: link(ja.token) });
    }
    // cartão de cliente da casa: o link só vai pro WhatsApp do dono
    const enviado = await enviarTextoWhatsApp(
      `55${telefone}`,
      `Prainha Bar · 81ª SOEA\n\nSeu benefício já está no seu Cliente VIP: drink de boas-vindas e categoria ${nivel.nome} até 18/10.\n\nAbra o seu cartão: ${link(ja.token)}`,
    ).catch(() => false);
    return NextResponse.json({ ok: true, existente: true, enviado });
  }

  try {
    const { cartao } = await criarCartao({
      filialId: SOEA.filialId,
      nome,
      telefone,
      cpf,
      nivelMinimo: nivel.minVisitas > 0 ? nivel.codigo : null,
      nivelMinimoAte: SOEA.fim,
      origem: 'soea',
      origemDetalhe: `${SOEA.tag} ip:${ip}`,
      aderido: false,
    });
    guardar(cartao.token);
    return NextResponse.json({ ok: true, url: link(cartao.token) });
  } catch (e) {
    console.error('[soea] cadastro', (e as Error)?.message);
    return erro('Não deu certo agora. Tente de novo.', 500);
  }
}
