// Novo orçamento de evento.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { diasAtrasBr } from '@/lib/datas';
import { montarLocaisEvento } from '@/lib/orcamentos-server';
import { FormOrcamento, type OrcamentoInicial } from '../form-orcamento';

export const dynamic = 'force-dynamic';

const CONDICOES_PADRAO = [
  '• Reserva da data mediante pagamento de sinal de 50% do valor total.',
  '• Saldo restante pago no dia do evento.',
  '• Valores válidos para a data e quantidade de pessoas indicadas neste orçamento.',
  '• Bebidas cobradas à parte, conforme consumo.',
].join('\n');

export default async function NovoOrcamentoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'orcamento.create');

  const filiais = await filiaisDoUsuario(user.id);
  if (filiais.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const locais = await montarLocaisEvento(filiais);

  const inicial: OrcamentoInicial = {
    filialId: filiais[0].id,
    local: '',
    clienteNome: '',
    clienteTelefone: '',
    dataEvento: '',
    hora: '',
    pessoas: 20,
    valorPessoa: '',
    pratos: [],
    sobremesaIncluida: false,
    sobremesaDescricao: '',
    taxaEspaco: '',
    taxaExclusividade: '',
    observacoes: '',
    condicoes: CONDICOES_PADRAO,
    // Validade padrão: 15 dias a partir de hoje (diasAtrasBr negativo = futuro).
    validoAte: diasAtrasBr(-15),
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <Link href="/orcamentos" className="text-sm text-blue-600 hover:underline">
            ← Orçamentos
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Novo orçamento de evento</h1>
        </div>
        <FormOrcamento locais={locais} inicial={inicial} />
      </section>
    </main>
  );
}
