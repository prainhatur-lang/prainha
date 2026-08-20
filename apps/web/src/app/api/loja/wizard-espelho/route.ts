// ESPELHO DO CATÁLOGO: a LOJA empurra, a nuvem guarda.
//
// Cobre o que o CDC nunca trouxe: wizard (perguntas/opções/ligações),
// etiquetas (categorias), COZINHAS (as praças do KDS), observações prontas e
// os usuários do PDV. Com o Firebird da 0001 saindo do ar, é por aqui que
// esse cadastro vira nosso de verdade.
//
// Estas quatro tabelas (WIZARDPERGUNTAS, WIZARDOPCOES, WIZARD, ETIQUETAS)
// ficaram de fora do CDC. Até aqui só entravam por script manual rodado do
// Mac COM VPN até a loja (`sync:wizard --host <ip>`) — na prática, quando
// alguém lembrava: o espelho estava de 17/08 enquanto o PDV mudava todo dia.
//
// Agora quem manda é a loja, pelo mesmo canal HMAC do resto (partes
// [f,'espelho',e]). Sem VPN, sem lembrar.
//
// Substitui tudo da filial a cada envio: são tabelas pequenas (centenas de
// linhas) e o Consumer não avisa o que apagou — diff seria só chance de erro.
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Corpo {
  f?: string; e?: number; s?: string;
  perguntas?: Array<{ c: number; d: string | null; mn: number; mx: number }>;
  opcoes?: Array<{ c: number; p: number; n: string | null; pr: number; pd: number | null }>;
  ligacoes?: Array<{ v: number; p: number; o: number }>;
  etiquetas?: Array<{ c: number; d: string | null }>;
  cozinhas?: Array<{ c: number; d: string | null }>;
  observacoes?: Array<{ c: number; t: string | null; e: number | null; cat: string | null }>;
  usuarios?: Array<{ c: number; l: string | null; n: string | null; t: string | null; adm: boolean; perms: number[] }>;
}

function autoriza(f: string, e: number, s: string) {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  if (!/^[0-9a-f-]{36}$/i.test(f) || !(e * 1000 >= Date.now())) return false;
  const esperada = createHmac('sha256', seg).update([f, 'espelho', String(e)].join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Corpo | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const filialId = String(body.f);
  const { db, schema } = await import('@concilia/db');
  const { eq, sql } = await import('drizzle-orm');

  const perguntas = (body.perguntas || []).filter((p) => Number.isFinite(p?.c) && p.c > 0);
  const opcoes = (body.opcoes || []).filter((o) => Number.isFinite(o?.c) && o.c > 0 && o.p > 0);
  const ligacoes = (body.ligacoes || []).filter((l) => l?.v > 0 && l?.p > 0);
  const etiquetas = (body.etiquetas || []).filter((e) => Number.isFinite(e?.c) && e.c > 0 && e.d);
  const cozinhas = (body.cozinhas || []).filter((c) => Number.isFinite(c?.c) && c.c > 0 && c.d);
  const observacoes = (body.observacoes || []).filter((o) => Number.isFinite(o?.c) && o.c > 0 && o.t);
  const usuarios = (body.usuarios || []).filter((u) => Number.isFinite(u?.c) && u.c > 0 && u.l);
  // Envio vazio quase sempre é falha de leitura na loja, não catálogo vazio —
  // apagar o espelho por causa disso deixaria a tela sem nada.
  if (perguntas.length === 0 && opcoes.length === 0 && etiquetas.length === 0
      && cozinhas.length === 0 && observacoes.length === 0 && usuarios.length === 0) {
    return NextResponse.json({ ok: false, erro: 'payload vazio — nada foi substituído' }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    if (perguntas.length > 0) {
      await tx.delete(schema.wizardOpcao).where(eq(schema.wizardOpcao.filialId, filialId));
      await tx.delete(schema.wizardProduto).where(eq(schema.wizardProduto.filialId, filialId));
      await tx.delete(schema.wizardPergunta).where(eq(schema.wizardPergunta.filialId, filialId));
      await tx.insert(schema.wizardPergunta).values(
        perguntas.map((p) => ({
          filialId,
          codigoExterno: p.c,
          texto: p.d ? String(p.d).slice(0, 200) : null,
          respostasMin: Number(p.mn) || 0,
          respostasMax: Number(p.mx) || 0,
        })),
      );
      if (opcoes.length > 0) {
        await tx.insert(schema.wizardOpcao).values(
          opcoes.map((o) => ({
            filialId,
            codigoExterno: o.c,
            codigoPergunta: o.p,
            nome: o.n ? String(o.n).slice(0, 200) : null,
            precoPromo: (Number(o.pr) || 0).toFixed(2),
            codigoVarianteExterno: o.pd ?? null,
          })),
        );
      }
      if (ligacoes.length > 0) {
        await tx.insert(schema.wizardProduto).values(
          ligacoes.map((l) => ({
            filialId,
            codigoVarianteExterno: l.v,
            codigoPergunta: l.p,
            ordem: Number(l.o) || 0,
          })),
        ).onConflictDoNothing();
      }
    }
    if (cozinhas.length > 0) {
      for (const c of cozinhas) {
        await tx
          .insert(schema.areaProducao)
          .values({ filialId, codigoExterno: c.c, nome: String(c.d).slice(0, 80) })
          .onConflictDoUpdate({
            target: [schema.areaProducao.filialId, schema.areaProducao.codigoExterno],
            set: { nome: String(c.d).slice(0, 80), sincronizadoEm: new Date() },
          });
      }
    }
    if (observacoes.length > 0) {
      // Substitui: a ligação observação↔categoria muda por remoção, e o
      // Consumer não avisa o que saiu.
      await tx.delete(schema.observacaoPdv).where(eq(schema.observacaoPdv.filialId, filialId));
      await tx.insert(schema.observacaoPdv).values(
        observacoes.map((o) => ({
          filialId,
          codigoExterno: o.c,
          texto: String(o.t).slice(0, 120),
          codigoEtiqueta: o.e ?? null,
          categoria: o.cat ? String(o.cat).slice(0, 100) : null,
        })),
      ).onConflictDoNothing();
    }
    if (usuarios.length > 0) {
      for (const u of usuarios) {
        // PIN NÃO vem do Consumer (cifra não revertida) — o registro entra sem
        // senha e a pessoa cadastra a dela. Reimportar não pode apagar o PIN
        // já cadastrado aqui: por isso o UPDATE não toca pin_hash/salt.
        // SQL cru porque a chave é um índice por expressão, lower(login).
        const perms = Array.isArray(u.perms) ? u.perms.filter((n) => Number.isFinite(n)) : [];
        await tx.execute(sql`
          INSERT INTO usuario_operacao (filial_id, login, nome, perms, admin, origem, codigo_pdv, tipo)
          VALUES (${filialId}, ${String(u.l).slice(0, 30)}, ${String(u.n || u.l).slice(0, 80)},
                  ${perms}, ${!!u.adm}, 'consumer', ${u.c}, ${u.t ? String(u.t).slice(0, 30) : null})
          ON CONFLICT (filial_id, lower(login)) DO UPDATE
          SET nome = EXCLUDED.nome, perms = EXCLUDED.perms, admin = EXCLUDED.admin,
              codigo_pdv = EXCLUDED.codigo_pdv, tipo = EXCLUDED.tipo, atualizado_em = now()`);
      }
    }
    if (etiquetas.length > 0) {
      for (const e of etiquetas) {
        await tx
          .insert(schema.produtoEtiqueta)
          .values({ filialId, codigoExterno: e.c, nome: String(e.d).slice(0, 100) })
          .onConflictDoUpdate({
            target: [schema.produtoEtiqueta.filialId, schema.produtoEtiqueta.codigoExterno],
            set: { nome: String(e.d).slice(0, 100), sincronizadoEm: new Date() },
          });
      }
    }
  });

  // O Consumer só manda código; o uuid da variante é resolvido aqui.
  await db.execute(sql`
    UPDATE wizard_opcao o SET variante_id = pv.id FROM produto_variante pv
    WHERE o.filial_id = ${filialId} AND pv.filial_id = ${filialId}
      AND pv.codigo_externo = o.codigo_variante_externo AND o.variante_id IS NULL`);
  await db.execute(sql`
    UPDATE wizard_produto w SET variante_id = pv.id FROM produto_variante pv
    WHERE w.filial_id = ${filialId} AND pv.filial_id = ${filialId}
      AND pv.codigo_externo = w.codigo_variante_externo AND w.variante_id IS NULL`);

  return NextResponse.json({
    ok: true,
    perguntas: perguntas.length,
    opcoes: opcoes.length,
    ligacoes: ligacoes.length,
    etiquetas: etiquetas.length,
    cozinhas: cozinhas.length,
    observacoes: observacoes.length,
    usuarios: usuarios.length,
  });
}
