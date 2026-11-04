// Admissão pelo link do WhatsApp (04/11/2026): o RH digita o CPF, o SPC traz
// os dados, confere o WhatsApp, acerta o contrato e manda o link. A pessoa
// preenche, sobe os documentos e assina em /op/admissao/<token>.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { EMPREGADORES } from '@/lib/rh/admissao';
import { AdmissaoCliente } from './admissao-cliente';

export const dynamic = 'force-dynamic';

const CNPJ_DA_CASA: Record<string, string> = {
  '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9': '33159574000166',
  'e899dae2-38bf-4f3f-9149-7effd059fab8': '33159574000328',
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': '33159574000247',
  '69717762-31ef-4134-9b0c-6e1cd6e56d01': '05486249000172',
  '90cad0c0-1404-49d2-884e-4d6554fc10f8': '54228128000136',
};

export default async function AdmissaoPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'funcionario.create');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel = await escolherFilial(filiais, sp.filialId);
  if (!sel) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = sel;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-4">
          <a href={`/rh/funcionarios?filialId=${filial.id}`} className="text-xs text-slate-500 hover:underline">
            ← Funcionários
          </a>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Admissão pelo WhatsApp</h1>
          <p className="mt-1 text-sm text-slate-600">
            Digite o CPF: o SPC traz nome, nascimento, mãe, pai (quando tem) e telefone. Confira o WhatsApp, acerte o contrato (quem registra, onde trabalha e a escala) e mande o link.
            A pessoa preenche o resto (pai, RG, PIS, CTPS…), sobe os documentos, lê o contrato, aceita e assina com selfie e
            rubrica. Assinou → o cadastro, o contrato e os documentos entram na ficha sozinhos.
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}

        <AdmissaoCliente
          filialId={filial.id}
          filialNome={filial.nome}
          casas={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          hoje={hojeBr()}
          empregadores={EMPREGADORES.map((e) => ({ cnpj: e.cnpj, rotulo: e.rotulo }))}
          empregadorPadrao={CNPJ_DA_CASA[filial.id] ?? EMPREGADORES[0].cnpj}
        />
      </section>
    </main>
  );
}
