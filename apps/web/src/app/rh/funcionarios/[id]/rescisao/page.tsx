// TRCT calculado pelo sistema (04/11/2026). Abre pela ficha do funcionário
// ("🧮 Fazer o TRCT pelo sistema"). Calcula na tela (lib/rh/trct.ts) e imprime
// o termo pra assinar. Não grava nada: o termo assinado sobe na ficha como
// sempre e o botão "💰 Lançar pagamento da rescisão" continua lançando a conta.

import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { calcularFolhaMensal } from '@/lib/rh/folha-mensal';
import { horasDoMesPorCpf } from '@/lib/rh/folha-mensal-dados';
import { proximosFeriados } from '@/lib/reservas/feriados';
import { TrctForm } from './trct-form';

export const dynamic = 'force-dynamic';

const NOTURNO = new Set(['25', '219', '250', '854']);

export default async function RescisaoPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [f] = await db.select().from(schema.funcionario).where(eq(schema.funcionario.id, id)).limit(1);
  if (!f) notFound();
  const filiais = await filiaisDoUsuario(user.id);
  const filial = filiais.find((x) => x.id === f.filialId);
  if (!filial) notFound();

  const afastamento = f.dataDesligamento ?? hojeBr();

  // Adicional noturno do mês da saída, pelo ponto (mesma conta da folha calculada).
  let noturno = 0;
  if (f.cpf && f.regimeSalarial === 'clt_mensal' && Number(f.salarioBase) > 0) {
    const comp = afastamento.slice(0, 7);
    const ini = `${comp}-01`;
    try {
      const [horas, feriados] = await Promise.all([
        horasDoMesPorCpf([f.cpf], ini, afastamento),
        proximosFeriados(ini, 31).then((l) => l.map((x) => x.data)),
      ]);
      const calc = calcularFolhaMensal({
        regime: 'clt_mensal',
        salario: Number(f.salarioBase),
        comp,
        admissao: f.dataAdmissao,
        desligamento: afastamento,
        dias: horas.get(f.cpf) ?? [],
        feriados,
      });
      noturno = calc.rubricas.filter((r) => NOTURNO.has(r.codigo)).reduce((s, r) => s + r.valor, 0);
    } catch {
      noturno = 0;
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>
      <section className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
        <div className="print:hidden">
          <a href={`/rh/funcionarios/${f.id}`} className="text-xs font-medium text-blue-700 hover:underline">
            ← Ficha de {f.nome}
          </a>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">TRCT pelo sistema</h1>
          <p className="mt-1 text-sm text-slate-600">
            Confira os dados, escolha o tipo de saída e imprima o termo pra assinar. Depois suba o termo assinado na
            ficha e use “💰 Lançar pagamento da rescisão”. Nada é gravado aqui.
          </p>
        </div>
        <TrctForm
          pessoa={{
            nome: f.nome,
            cpf: f.cpf,
            endereco: f.endereco,
            cargo: f.cargoRegistro ?? f.cargo,
            cbo: f.cbo,
            matricula: f.matriculaFolha,
            empresa: f.empresaRegistro ?? filial.nome,
            cnpj: f.cnpjRegistro ?? null,
            casa: filial.nome,
            regime: f.regimeSalarial,
            motivo: f.motivoDesligamento,
          }}
          inicial={{
            salario: Number(f.salarioBase) || 0,
            admissao: f.dataAdmissao ?? '',
            afastamento,
            noturno: Math.round(noturno * 100) / 100,
          }}
        />
      </section>
    </main>
  );
}
