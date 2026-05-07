import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { VERSAO_RELEASE } from '../../api/agente-release/route';
import { BotaoBaixar } from './botao-baixar';

function statusFromPing(ultimoPing: Date | null): { cor: string; texto: string } {
  if (!ultimoPing) return { cor: 'text-gray-500', texto: 'sem ping' };
  const min = (Date.now() - ultimoPing.getTime()) / 60000;
  if (min < 30) return { cor: 'text-green-600', texto: 'online' };
  if (min < 120) return { cor: 'text-yellow-600', texto: 'atrasado' };
  return { cor: 'text-red-600', texto: 'offline' };
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
          serviço Windows em cada filial.
        </p>

        <section className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm text-blue-900">Versão disponível</div>
              <div className="text-2xl font-bold text-blue-700">v{VERSAO_RELEASE}</div>
            </div>
            <BotaoBaixar />
          </div>
          <div className="text-sm text-blue-800">
            <p className="mb-1 font-semibold">Como atualizar uma filial:</p>
            <ol className="list-decimal pl-6">
              <li>
                Clica em <strong>Baixar atualizador</strong> ao lado
              </li>
              <li>Conecta no PC da filial via Chrome Remote Desktop</li>
              <li>Copia o arquivo <code>atualizar-agente-v{VERSAO_RELEASE}.ps1</code> pro PC</li>
              <li>
                Abre PowerShell como <strong>Administrador</strong> e roda:
                <pre className="mt-1 rounded bg-blue-900 p-2 text-xs text-white">
{`Set-ExecutionPolicy -Scope Process Bypass
.\\atualizar-agente-v${VERSAO_RELEASE}.ps1`}
                </pre>
              </li>
              <li>O script faz tudo: backup, download, swap do agente.cjs, restart, validação</li>
            </ol>
          </div>
        </section>

        <h2 className="mb-3 text-lg font-semibold">Status por filial</h2>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">Filial</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Último ping</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                    Nenhuma filial encontrada
                  </td>
                </tr>
              ) : (
                linhas.map((f) => {
                  const s = statusFromPing(f.ultimoPing);
                  return (
                    <tr key={f.id} className="border-t">
                      <td className="px-4 py-2 font-medium">{f.nome}</td>
                      <td className={`px-4 py-2 font-semibold ${s.cor}`}>{s.texto}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {relativeTime(f.ultimoPing)}
                        {f.ultimoPing && (
                          <span className="ml-2 text-xs text-gray-400">
                            ({f.ultimoPing.toLocaleString('pt-BR')})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-xs text-gray-500">
          <p>
            <strong>Observação:</strong> a versão do agente em cada filial só é
            visível olhando o log local. Pra centralizar isso aqui no painel é
            preciso que o agente envie a versão no heartbeat — feature futura.
          </p>
        </div>
      </main>
    </div>
  );
}
