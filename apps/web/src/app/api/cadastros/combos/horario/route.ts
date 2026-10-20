// PUT /api/cadastros/combos/horario — grava QUANDO o combo vale (combo_regra)
// e aplica na hora: fora da regra o combo é pausado pela fila e some do
// garçom, do caixa e da LIO; dentro, volta. Ver lib/combo-horario.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { salvarRegra } from '@/lib/combo-horario';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Regra = z.object({
  filialId: z.string().uuid(),
  varianteCodigo: z.number().int().positive(),
  ativa: z.boolean(),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  horaInicio: hora,
  horaFim: hora,
  dataInicio: dia.nullable(),
  dataFim: dia.nullable(),
  datasFora: z.array(dia).max(400),
  datasExtra: z.array(dia).max(400),
});

export async function PUT(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const parsed = Regra.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === b.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  if (b.dataInicio && b.dataFim && b.dataFim < b.dataInicio) {
    return NextResponse.json({ ok: false, erro: 'a data final é antes da inicial' }, { status: 400 });
  }
  if (b.horaInicio && b.horaFim && b.horaInicio === b.horaFim) {
    return NextResponse.json({ ok: false, erro: 'hora de início e de fim iguais' }, { status: 400 });
  }
  const feitos = await salvarRegra(
    b.filialId,
    b.varianteCodigo,
    {
      ativa: b.ativa,
      dias: [...new Set(b.dias)].sort(),
      horaInicio: b.horaInicio,
      horaFim: b.horaFim,
      dataInicio: b.dataInicio,
      dataFim: b.dataFim,
      datasFora: [...new Set(b.datasFora)].sort(),
      datasExtra: [...new Set(b.datasExtra)].sort(),
    },
    auth.user.email ?? null,
  );
  return NextResponse.json({ ok: true, aplicado: feitos[0] ?? null });
}
