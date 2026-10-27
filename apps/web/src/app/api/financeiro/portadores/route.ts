// POST /api/financeiro/portadores — mexe nos portadores do dinheiro em espécie
// (tela /financeiro/portadores). Uma ação por chamada:
//   { acao:'cadastrar', filialId, nome, tipo }       novo portador
//   { acao:'ativo', filialId, portadorId, ativo }    desativar/reativar (some da lista do caixa)
//   { acao:'lancar', filialId, tipo, de?, para?, valor, data, descricao }
//        ENTREGA de→para · DEPOSITO/PAGAMENTO saem de `de` · ENTRADA entra em `para`
//        · AJUSTE em `de` com valor com sinal (positivo soma, negativo tira)
//   { acao:'atribuir', filialId, movimentoId, portadorId }  sangria "sem portador" → portador
//   { acao:'excluir', filialId, movimentoId }        tira o lançamento (e o par, na entrega)
// Ver: conta_pagar.read · lançar/cadastrar: conta_pagar.marcar_pago.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { portadoresDaFilial, semAcento } from '@/lib/portador';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function POST(request: Request) {
  const g = await exigirPermApi('conta_pagar.marcar_pago');
  if (g.error) return g.error;
  const user = g.user;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return err('corpo inválido');
  const filialId = String(b.filialId ?? '');
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) return err('sem acesso a essa casa', 403);
  const portadores = await portadoresDaFilial(filialId);
  const daCasa = (id: unknown) => portadores.find((p) => p.id === String(id ?? ''));

  switch (String(b.acao ?? '')) {
    case 'cadastrar': {
      const nome = String(b.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (nome.length < 2) return err('digite o nome');
      const tipo = b.tipo === 'COFRE' ? 'COFRE' : 'PESSOA';
      if (portadores.some((p) => semAcento(p.nome) === semAcento(nome))) return err('já existe um portador com esse nome');
      await db.insert(schema.portador).values({ filialId, nome, tipo, criadoPor: user.id });
      return NextResponse.json({ ok: true });
    }
    case 'ativo': {
      const p = daCasa(b.portadorId);
      if (!p) return err('portador não encontrado');
      await db.update(schema.portador).set({ ativo: !!b.ativo }).where(eq(schema.portador.id, p.id));
      return NextResponse.json({ ok: true });
    }
    case 'lancar': {
      const tipo = String(b.tipo ?? '');
      const valorBruto = Math.round(Number(b.valor) * 100) / 100;
      const data = String(b.data ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return err('data inválida');
      const descricao = String(b.descricao ?? '').trim().slice(0, 300) || null;
      const de = b.de ? daCasa(b.de) : undefined;
      const para = b.para ? daCasa(b.para) : undefined;
      const base = { filialId, data, descricao, criadoPor: user.id };
      if (tipo === 'AJUSTE') {
        if (!de) return err('escolha o portador');
        if (!valorBruto) return err('valor inválido');
        await db.insert(schema.portadorMovimento).values({ ...base, portadorId: de.id, tipo, valor: valorBruto.toFixed(2) });
        return NextResponse.json({ ok: true });
      }
      const valor = Math.abs(valorBruto);
      if (!(valor > 0)) return err('valor inválido');
      if (tipo === 'ENTREGA') {
        if (!de || !para) return err('escolha de quem e pra quem');
        if (de.id === para.id) return err('de quem e pra quem são o mesmo portador');
        const a = randomUUID();
        const c = randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(schema.portadorMovimento).values([
            { ...base, id: a, parId: c, portadorId: de.id, tipo, valor: (-valor).toFixed(2), descricao: `→ ${para.nome}${descricao ? ' · ' + descricao : ''}` },
            { ...base, id: c, parId: a, portadorId: para.id, tipo, valor: valor.toFixed(2), descricao: `← ${de.nome}${descricao ? ' · ' + descricao : ''}` },
          ]);
        });
        return NextResponse.json({ ok: true });
      }
      if (tipo === 'DEPOSITO' || tipo === 'PAGAMENTO') {
        if (!de) return err('escolha de quem saiu o dinheiro');
        if (tipo === 'PAGAMENTO' && !descricao) return err('diga o que foi pago');
        await db.insert(schema.portadorMovimento).values({ ...base, portadorId: de.id, tipo, valor: (-valor).toFixed(2) });
        return NextResponse.json({ ok: true });
      }
      if (tipo === 'ENTRADA') {
        if (!para) return err('escolha quem recebeu');
        if (!descricao) return err('diga de onde veio o dinheiro');
        await db.insert(schema.portadorMovimento).values({ ...base, portadorId: para.id, tipo, valor: valor.toFixed(2) });
        return NextResponse.json({ ok: true });
      }
      return err('tipo inválido');
    }
    case 'atribuir': {
      const p = daCasa(b.portadorId);
      const mid = String(b.movimentoId ?? '');
      if (!p || !UUID.test(mid)) return err('parâmetros');
      await db
        .update(schema.portadorMovimento)
        .set({ portadorId: p.id, atribuidoPor: user.id, atribuidoEm: new Date() })
        .where(and(
          eq(schema.portadorMovimento.id, mid),
          eq(schema.portadorMovimento.filialId, filialId),
          eq(schema.portadorMovimento.tipo, 'SANGRIA'),
          isNull(schema.portadorMovimento.excluidoEm),
        ));
      return NextResponse.json({ ok: true });
    }
    case 'excluir': {
      const mid = String(b.movimentoId ?? '');
      if (!UUID.test(mid)) return err('parâmetros');
      const [m] = await db
        .select({ id: schema.portadorMovimento.id, tipo: schema.portadorMovimento.tipo, parId: schema.portadorMovimento.parId })
        .from(schema.portadorMovimento)
        .where(and(eq(schema.portadorMovimento.id, mid), eq(schema.portadorMovimento.filialId, filialId)))
        .limit(1);
      if (!m) return err('lançamento não encontrado');
      // sangria é do caixa: corrige-se atribuindo, não apagando (senão o dinheiro some)
      if (m.tipo === 'SANGRIA') return err('sangria vem do caixa — não dá pra excluir aqui');
      await db
        .update(schema.portadorMovimento)
        .set({ excluidoEm: new Date(), excluidoPor: user.id })
        .where(and(
          eq(schema.portadorMovimento.filialId, filialId),
          m.parId ? or(eq(schema.portadorMovimento.id, m.id), eq(schema.portadorMovimento.id, m.parId)) : eq(schema.portadorMovimento.id, m.id),
        ));
      return NextResponse.json({ ok: true });
    }
  }
  return err('ação inválida');
}
