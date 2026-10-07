// POST /api/relatorios/historico-faturamento/unidade — as unidades que somam no
// VGV. Só responde com a aba aberta (passe da senha valendo).
//
// Body: { organizacaoId, acao, ... }
//   criar    — { nome, filialId?, sistemaDesde?: 'YYYY-MM' }
//              com filialId é casa do sistema (o PDV responde de sistemaDesde em
//              diante); sem, é unidade de fora (só o que for digitado).
//   encerrar — { unidadeId, desde: 'YYYY-MM' | null }  (null = voltou a operar)

import { NextResponse } from 'next/server';
import { hojeBr } from '@/lib/datas';
import { guardaAba } from '@/lib/faturamento-acesso-sessao';
import {
  criarUnidade,
  ehUuid,
  marcarEncerrada,
  mesValido,
  somaMeses,
  unidadeDaOrg,
} from '@/lib/faturamento-historico';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NOME_MAX = 80;

const erro = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return erro('corpo inválido');

  const g = await guardaAba(body.organizacaoId, true);
  if (g.error) return g.error;
  const { org } = g;
  const mesAtual = hojeBr().slice(0, 7);

  if (body.acao === 'criar') {
    const nome = typeof body.nome === 'string' ? body.nome.trim().replace(/\s+/g, ' ') : '';
    if (!nome) return erro('Dê um nome pra unidade.');
    if (nome.length > NOME_MAX) return erro(`O nome passa de ${NOME_MAX} letras.`);

    let filialId: string | null = null;
    let sistemaDesde: string | null = null;
    if (body.filialId) {
      const filial = body.filialId;
      const desde = body.sistemaDesde;
      if (!ehUuid(filial)) return erro('filial inválida');
      if (!mesValido(desde) || desde > mesAtual) {
        return erro('Diga a partir de que mês o sistema responde por essa casa.');
      }
      filialId = filial;
      sistemaDesde = desde;
    }

    const r = await criarUnidade(org.id, nome, filialId, sistemaDesde);
    if ('erro' in r) {
      if (r.erro === 'nome-repetido') return erro('Já existe uma unidade com esse nome.', 409);
      if (r.erro === 'filial-em-uso') return erro('Essa casa já está no VGV.', 409);
      return erro('filial não encontrada', 404);
    }
    return NextResponse.json({ ok: true, id: r.id });
  }

  if (body.acao === 'encerrar') {
    const unidadeId = body.unidadeId;
    if (!ehUuid(unidadeId)) return erro('unidade inválida');
    const unidade = await unidadeDaOrg(unidadeId);
    if (!unidade || unidade.organizacaoId !== org.id) return erro('unidade não encontrada', 404);
    // Até o mês que vem: dá pra marcar hoje a casa que fecha no fim do mês.
    let desde: string | null = null;
    if (body.desde !== null) {
      const pedido = body.desde;
      if (!mesValido(pedido) || pedido > somaMeses(mesAtual, 1)) return erro('mês inválido');
      desde = pedido;
    }
    await marcarEncerrada(unidade.id, desde);
    return NextResponse.json({ ok: true });
  }

  return erro('ação desconhecida');
}
