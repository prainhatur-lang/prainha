// GET /api/reservar/[token]/bebidas — catálogo real de Cerveja/Espumante/
// Vinho, direto do Consumer (sincronizado via CDC, sem tocar Firebird).
// Público. Cerveja ganha combo automático (long neck=10, 600ml=6) — pra já
// lançar direto quando o cliente chegar (Fase 2, futura).
//
// SEM FILTRO DE ESTOQUE: o campo estoque_atual sincronizado está
// desatualizado pra maioria dos produtos (achado 12/07/2026 — só 11/2137
// produtos com estoque > 0 no Postgres, itens comuns sem sync há semanas).
// Até corrigir a causa (gatilho de sincronização do Consumer), mostra a
// lista sem checar quantidade — decisão do usuário, ciente do risco de
// oferecer algo em falta.
//
// Códigos de etiqueta fixos da Prainha Bar (achados por consulta direta em
// 12/07/2026 — não variam, não precisam de busca online):
//   9=Cerveja, 36=Espumante, 23=Vinho

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORIAS: Record<string, string> = {
  '9': 'Cervejas',
  '36': 'Espumantes',
  '23': 'Vinhos',
};

// Itens cadastrados na etiqueta "Vinho" que não são bebida (taxa de
// serviço/acessório) — achados por inspeção manual em 12/07/2026.
const NAO_E_BEBIDA = new Set(['rolha', 'taça de vidro', 'taca de vidro']);

function comboCerveja(nome: string): number | null {
  const n = nome.toLowerCase().replace(/[\s-]/g, ''); // "long neck"/"long-neck"/"longneck" → "longneck"
  if (n.includes('longneck')) return 10;
  if (n.includes('600')) return 6;
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ categorias: [] });

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ categorias: [] });

  const produtos = await db
    .select({
      nome: schema.produto.nome,
      codigoEtiqueta: schema.produto.codigoEtiqueta,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        inArray(schema.produto.codigoEtiqueta, Object.keys(CATEGORIAS)),
        isNull(schema.produto.dataPausado),
        or(eq(schema.produto.descontinuado, false), isNull(schema.produto.descontinuado)),
      ),
    );

  // Prefixo "T " = variante de cardápio do Terraço (área só de eventos, não
  // entra na reserva comum) — mesmo produto duplicado, exclui. Pontuação
  // solta no começo do nome (".Becks...") é só truque de ordenação no
  // Consumer, limpa pra exibição. Sem preço aqui — o campo sincronizado
  // está tão desatualizado quanto o estoque (mesma causa), risco de
  // mostrar valor errado.
  const porCategoria = new Map<string, Array<{ nome: string; comboQtd: number | null }>>();
  const vistos = new Set<string>();
  for (const p of produtos) {
    if (!p.nome || p.nome.startsWith('T ')) continue;
    const nomeLimpo = p.nome.trim().replace(/^[.*\s]+/, '');
    if (!nomeLimpo || NAO_E_BEBIDA.has(nomeLimpo.toLowerCase())) continue;
    const cat = CATEGORIAS[p.codigoEtiqueta ?? ''];
    if (!cat) continue;
    const chave = `${cat}:${nomeLimpo.toLowerCase()}`;
    if (vistos.has(chave)) continue; // dedupe (mesmo nome, variantes de cadastro)
    vistos.add(chave);
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat)!.push({
      nome: nomeLimpo,
      comboQtd: cat === 'Cervejas' ? comboCerveja(nomeLimpo) : null,
    });
  }

  const categorias = ['Cervejas', 'Espumantes', 'Vinhos']
    .filter((c) => porCategoria.has(c))
    .map((nome) => ({
      nome,
      produtos: porCategoria.get(nome)!.sort((a, b) => a.nome.localeCompare(b.nome)),
    }));

  return NextResponse.json({ categorias });
}
