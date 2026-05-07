// Upload do espelho de ponto XLSX da Stelanto pra preencher folha_horas.
// Faz fuzzy match das abas (= pessoas no espelho) com os fornecedores
// vinculados a folha. Retorna preview pro user revisar antes de salvar.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { fuzzyMatchPessoa, parseEspelho } from '@/lib/folha/parse-espelho';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;

  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  // RBAC
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  if (folha.status !== 'aberta') {
    return new NextResponse('Folha já foi fechada', { status: 400 });
  }

  // Parse do XLSX
  const formData = await req.formData();
  const file = formData.get('arquivo') as File | null;
  if (!file) return new NextResponse('Arquivo faltando', { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const horasPorPessoa = parseEspelho(buf, folha.dataInicio);

  // Pessoas vinculadas pra fazer match
  const pessoas = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      nome: schema.fornecedor.nome,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .where(
      and(
        eq(schema.fornecedor.filialId, folha.filialId),
        eq(schema.fornecedorFolha.ativo, true),
      ),
    );
  const pessoasNorm = pessoas.map((p) => ({
    fornecedorId: p.fornecedorId,
    nome: p.nome ?? '',
  }));

  // Faz fuzzy match e salva folha_horas com matches automáticos
  const matches: Array<{
    nomeEspelho: string;
    fornecedorId: string | null;
    fornecedorNome: string | null;
    score: number | null;
    horasPorDia: Record<string, number>;
    totalMin: number;
  }> = [];

  // Limpa folha_horas existente da folha (re-upload sobrescreve)
  await db
    .delete(schema.folhaHoras)
    .where(eq(schema.folhaHoras.folhaSemanaId, folha.id));

  for (const h of horasPorPessoa) {
    const match = fuzzyMatchPessoa(h.nomeEspelho, pessoasNorm);
    const totalMin = Object.values(h.horasPorDia).reduce((a, b) => a + b, 0);
    matches.push({
      nomeEspelho: h.nomeEspelho,
      fornecedorId: match?.fornecedorId ?? null,
      fornecedorNome: match
        ? pessoasNorm.find((p) => p.fornecedorId === match.fornecedorId)?.nome ?? null
        : null,
      score: match?.score ?? null,
      horasPorDia: h.horasPorDia,
      totalMin,
    });

    // Se matchou e tem horas, salva folha_horas
    if (match && totalMin > 0) {
      const rows = Object.entries(h.horasPorDia)
        .filter(([, min]) => min > 0)
        .map(([dia, min]) => ({
          folhaSemanaId: folha.id,
          fornecedorId: match.fornecedorId,
          dia,
          totalMin: min,
          origem: 'espelho',
        }));
      if (rows.length > 0) {
        await db.insert(schema.folhaHoras).values(rows);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    totalAbas: horasPorPessoa.length,
    casados: matches.filter((m) => m.fornecedorId).length,
    semMatch: matches.filter((m) => !m.fornecedorId).length,
    matches,
  });
}
