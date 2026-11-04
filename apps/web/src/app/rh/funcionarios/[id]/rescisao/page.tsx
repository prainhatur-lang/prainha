// TRCT calculado pelo sistema (04/11/2026). Abre pela ficha do funcionário
// ("🧮 Fazer o TRCT pelo sistema"). Calcula na tela (lib/rh/trct.ts) e imprime
// o termo pra assinar. Não grava nada: o termo assinado sobe na ficha como
// sempre e o botão "💰 Lançar pagamento da rescisão" continua lançando a conta.

import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { calcularFolhaMensal } from '@/lib/rh/folha-mensal';
import { horasDoMesPorCpf, salarioFamiliaPorCpf } from '@/lib/rh/folha-mensal-dados';
import { proximosFeriados } from '@/lib/reservas/feriados';
import { faltasDoPonto, type FaltasDoPonto } from '@/lib/rh/trct-faltas';
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

  // Salário-família: cotas da última folha do contador (rubrica 995), inclusive
  // a do próprio mês da saída se já tiver.
  let salFamilia: { cotas: number; valorCota: number } | null = null;
  const cpfLimpo = (f.cpf ?? '').replace(/\D/g, '');
  if (cpfLimpo) {
    const [a, m] = afastamento.split('-').map(Number);
    const compSeguinte = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
    try {
      salFamilia = (await salarioFamiliaPorCpf([cpfLimpo], compSeguinte)).get(cpfLimpo) ?? null;
    } catch {
      salFamilia = null;
    }
  }

  // Faltas do mês da saída pelo ponto (todo TRCT, pedido do dono 04/11/2026).
  let faltasPonto: FaltasDoPonto | null = null;
  if (f.cpf) {
    try {
      faltasPonto = await faltasDoPonto(f.cpf, f.dataAdmissao, afastamento);
    } catch {
      faltasPonto = null;
    }
  }

  // Carta de pedido de demissão subida na ficha (Documentos de saída): é a
  // prova de que a pessoa pediu pra sair, então o tipo sugerido segue ela.
  const [carta] = await db
    .select({ nome: schema.funcionarioDocumento.arquivoNome, em: schema.funcionarioDocumento.criadoEm })
    .from(schema.funcionarioDocumento)
    .where(
      and(
        eq(schema.funcionarioDocumento.funcionarioId, f.id),
        eq(schema.funcionarioDocumento.tipo, 'pedido_demissao'),
        isNull(schema.funcionarioDocumento.canceladoEm),
      ),
    )
    .orderBy(desc(schema.funcionarioDocumento.criadoEm))
    .limit(1);

  // Endereço do empregador: da casa com o mesmo CNPJ (cadastro fiscal) ou o da E.B.
  const cnpjEmp = (f.cnpjRegistro ?? '').replace(/\D/g, '');
  let empregador = { endereco: '', bairro: '', municipio: 'ARACAJU', uf: 'SE', cep: '', cnae: '' };
  if (cnpjEmp === '05486249000172') {
    empregador = { endereco: 'Rua R ZAQUEU BRANDAO, 752', bairro: 'SALGADO FILHO', municipio: 'ARACAJU', uf: 'SE', cep: '49020595', cnae: '5620-1/04' };
  } else if (cnpjEmp) {
    const [casa] = await db
      .select({ fiscal: schema.filial.fiscalConfig })
      .from(schema.filial)
      .where(eq(schema.filial.cnpj, cnpjEmp))
      .limit(1);
    const e = casa?.fiscal?.endereco;
    if (e) {
      empregador = {
        endereco: [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', '),
        bairro: e.bairro ?? '',
        municipio: e.municipio ?? 'ARACAJU',
        uf: e.uf ?? 'SE',
        cep: e.cep ?? '',
        cnae: '',
      };
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
          funcionarioId={f.id}
          empregador={empregador}
          pessoa={{
            nascimento: f.dataNascimento ?? null,
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
            salFamilia,
            faltasPonto,
            cartaPedido: carta ? { nome: carta.nome ?? 'arquivo' } : null,
          }}
        />
      </section>
    </main>
  );
}
