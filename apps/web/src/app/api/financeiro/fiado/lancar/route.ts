// LANÇAR FIADO (crédito ou pagamento) pela tela do Financeiro.
//
// Não escreve no Firebird daqui: o banco é da loja e a nuvem não a alcança.
// O lançamento entra na fila (fiado_lancamento) e o vendas-local aplica em
// até ~1 min, devolvendo o resultado. Por isso a tela mostra "aguardando a
// loja" até virar 'aplicado'.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  clienteId: z.string().uuid(),
  tipo: z.enum(['credito', 'pagamento']),
  valor: z.number().positive().max(1_000_000),
  observacao: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const auth = await exigirPermApi('conta_receber.create');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const { clienteId, tipo, valor, observacao } = parsed.data;

  const [cli] = await db
    .select({
      filialId: schema.cliente.filialId,
      codigoExterno: schema.cliente.codigoExterno,
      nome: schema.cliente.nome,
    })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, clienteId))
    .limit(1);
  if (!cli) return NextResponse.json({ ok: false, erro: 'cliente não encontrado' }, { status: 404 });
  if (cli.codigoExterno == null) {
    return NextResponse.json({ ok: false, erro: 'cliente sem código no PDV — não dá pra lançar na conta corrente dele' }, { status: 422 });
  }
  // RBAC: só filial que o usuário enxerga
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === cli.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }

  const obs = (observacao || '').trim()
    || (tipo === 'pagamento' ? 'Pagamento de fiado.' : 'Lançamento manual de fiado.');
  const [novo] = await db
    .insert(schema.fiadoLancamento)
    .values({
      filialId: cli.filialId,
      clienteCodigoExterno: cli.codigoExterno,
      clienteNome: cli.nome ?? null,
      tipo,
      valor: valor.toFixed(2),
      observacao: obs,
      criadoPor: auth.user.email ?? null,
    })
    .returning({ id: schema.fiadoLancamento.id });

  return NextResponse.json({ ok: true, id: novo.id, aguardando: true });
}
