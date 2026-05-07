import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { VERSAO_RELEASE } from '../../api/agente-release/route';

function statusFromPing(ultimoPing: Date | null): { cor: string; texto: string; icon: string } {
  if (!ultimoPing) return { cor: 'text-gray-500', texto: 'sem ping', icon: '⚫' };
  const min = (Date.now() - ultimoPing.getTime()) / 60000;
  if (min < 30) return { cor: 'text-green-600', texto: 'online', icon: '🟢' };
  if (min < 120) return { cor: 'text-yellow-600', texto: 'atrasado', icon: '🟡' };
  return { cor: 'text-red-600', texto: 'offline', icon: '🔴' };
}

function relativeTime(d: Date | null): string {
  if (!d) return '-';
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export default async function AgentePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filiaisIds = filiais.map((f) => f.id);

  const linhas =
    filiaisIds.length === 0
      ? []
      : await db
          .select({
            id: schema.filial.id,
            nome: schema.filial.nome,
            ultimoPing: schema.filial.ultimoPing,
          })
          .from(schema.filial)
          .where(inArray(schema.filial.id, filiaisIds))
          .orderBy(schema.filial.nome);

  return (
    <div>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold">Agente local</h1>
        <p className="mb-6 text-sm text-gray-600">
          Sincroniza dados do Consumer Rede (Firebird) com o concilia. Roda como
          serviço Windows em cada filial. Versão atual:{' '}
          <strong>v{VERSAO_RELEASE}</strong>.
        </p>

        <section className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-5">
          <h2 className="mb-2 text-lg font-bold text-blue-900">
            🚀 Instalação 1-clique
          </h2>
          <ol className="mb-3 list-decimal pl-6 text-sm text-blue-900">
            <li>
              Clica em <strong>📦 Baixar instalador</strong> da filial desejada
              (abaixo)
            </li>
            <li>
              Conecta no PC da filial (Chrome Remote Desktop) e copia o arquivo{' '}
              <code>.bat</code> baixado pra lá
            </li>
            <li>
              <strong>Duplo-clique no .bat</strong> → aceita o UAC → pronto
            </li>
          </ol>
          <p className="text-sm text-blue-800">
            O instalador é <strong>idempotente</strong>: serve pra instalar do
            zero, atualizar versão ou reparar instalação quebrada. Preserva
            checkpoint de sync. Não precisa desinstalar nada antes.
          </p>
        </section>

        <h2 className="mb-3 text-lg font-semibold">Filiais</h2>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">Filial</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Último ping</th>
                <th className="px-4 py-2 text-right">Instalador</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    Nenhuma filial encontrada
                  </td>
                </tr>
              ) : (
                linhas.map((f) => {
                  const s = statusFromPing(f.ultimoPing);
                  return (
                    <tr key={f.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{f.nome}</td>
                      <td className={`px-4 py-3 font-semibold ${s.cor}`}>
                        {s.icon} {s.texto}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {relativeTime(f.ultimoPing)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/api/agente-release/instalar.bat?filial=${f.id}`}
                          download
                          className="inline-block rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          📦 Baixar instalador
                        </a>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-8 rounded border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          <p className="mb-2 font-semibold">Detalhes técnicos:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              O .bat se auto-eleva via UAC e baixa o instalador PowerShell em
              streaming (sem precisar salvar arquivo intermediário)
            </li>
            <li>
              O instalador detecta o caminho do banco do Consumer
              (consumer.fdb), gera config.json sem BOM, instala como serviço
              Windows via NSSM e valida no log
            </li>
            <li>
              Bundle hospedado em{' '}
              <code>/agente-release/concilia-agente-v{VERSAO_RELEASE}.zip</code>{' '}
              (~30 MB — inclui node.exe + nssm.exe + agente.cjs)
            </li>
            <li>
              Token da filial fica embutido no .bat — <strong>não compartilhe</strong> esse arquivo fora do PC da
              filial
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
