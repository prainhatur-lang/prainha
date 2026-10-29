// Comprovante da assinatura eletrônica de um documento pelo funcionário
// (29/10/2026). Junta as evidências do aceite: quem, quando, de onde, CPF
// conferido, selfie, rosto comparado com o do ponto e a impressão digital
// (SHA-256) do arquivo no pedido e no aceite. Regra em lib/rh/assinatura.ts.
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { rotuloTipo } from '@/lib/rh/documento-vinculo';
import { FACE_LIMIAR } from '@/lib/rh/ponto-celular';
import { ROTULO_STATUS_ASSINATURA } from '@/lib/rh/assinatura';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dataHora(d: Date | null): string {
  if (!d) return '—';
  return (
    d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + ' (horário de Brasília)'
  );
}

function cpfFmt(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c || '—';
}

export default async function ComprovanteAssinaturaPage(props: { params: Promise<{ id: string }> }) {
  const user = await exigirPermPage('funcionario.read');
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const A = schema.funcionarioAssinatura;
  const D = schema.funcionarioDocumento;
  const F = schema.funcionario;
  const [a] = await db
    .select({
      id: A.id,
      status: A.status,
      filialId: A.filialId,
      funcionarioId: A.funcionarioId,
      documentoId: A.documentoId,
      hashDocumento: A.hashDocumento,
      hashNoAceite: A.hashNoAceite,
      enviadoPor: A.enviadoPor,
      enviadoEm: A.enviadoEm,
      expiraEm: A.expiraEm,
      abertoEm: A.abertoEm,
      assinadoEm: A.assinadoEm,
      assinadoIp: A.assinadoIp,
      assinadoAparelho: A.assinadoAparelho,
      cpfInformado: A.cpfInformado,
      selfiePath: A.selfiePath,
      faceDistancia: A.faceDistancia,
      textoAceite: A.textoAceite,
      canceladoEm: A.canceladoEm,
      tipo: D.tipo,
      descricao: D.descricao,
      arquivoNome: D.arquivoNome,
      nome: F.nome,
      cpfCadastro: F.cpf,
      casa: schema.filial.nome,
    })
    .from(A)
    .innerJoin(D, eq(D.id, A.documentoId))
    .innerJoin(F, eq(F.id, A.funcionarioId))
    .innerJoin(schema.filial, eq(schema.filial.id, A.filialId))
    .where(eq(A.id, id))
    .limit(1);
  if (!a) notFound();

  // Mesma régua da ficha: lotação ou casa extra da pessoa.
  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((x) => x.id);
  const extras = await db
    .select({ filialId: schema.funcionarioFilialExtra.filialId })
    .from(schema.funcionarioFilialExtra)
    .where(eq(schema.funcionarioFilialExtra.funcionarioId, a.funcionarioId));
  const [pessoa] = await db
    .select({ filialId: F.filialId })
    .from(F)
    .where(eq(F.id, a.funcionarioId))
    .limit(1);
  const casas = [pessoa?.filialId, ...extras.map((e) => e.filialId)].filter(Boolean) as string[];
  if (!casas.some((c) => ids.includes(c))) notFound();

  let quemEnviou = '—';
  if (a.enviadoPor) {
    const [u] = await db
      .select({ email: schema.usuario.email, nome: schema.usuario.nome })
      .from(schema.usuario)
      .where(and(eq(schema.usuario.id, a.enviadoPor)))
      .limit(1);
    quemEnviou = u?.nome || u?.email || a.enviadoPor;
  }

  const nomeDoc = rotuloTipo(a.tipo) + (a.descricao ? ` — ${a.descricao}` : '');
  const fd = a.faceDistancia != null ? Number(a.faceDistancia) : null;
  const hashBate = !!a.hashNoAceite && a.hashNoAceite === a.hashDocumento;
  const status = a.canceladoEm ? 'cancelado' : a.status;

  const Linha = (p: { r: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-1 gap-0.5 border-b border-slate-100 py-2 sm:grid-cols-[200px_1fr]">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{p.r}</dt>
      <dd className="break-words text-sm text-slate-800">{p.children}</dd>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <a href={`/rh/funcionarios/${a.funcionarioId}`} className="text-sm text-blue-700 hover:underline">
            ← voltar à ficha
          </a>
          <BotaoImprimir />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-5 print:border-0 print:p-0">
          <h1 className="text-lg font-semibold text-slate-900">Comprovante de assinatura eletrônica</h1>
          <p className="mt-1 text-sm text-slate-600">
            {a.casa} · {nomeDoc}
          </p>
          <p
            className={`mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium ${
              status === 'assinado'
                ? 'bg-emerald-100 text-emerald-800'
                : status === 'pendente'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-200 text-slate-700'
            }`}
          >
            {ROTULO_STATUS_ASSINATURA[status as keyof typeof ROTULO_STATUS_ASSINATURA] ?? status}
          </p>

          <dl className="mt-4">
            <Linha r="Documento">
              {nomeDoc}
              {a.arquivoNome ? ` (${a.arquivoNome})` : ''} ·{' '}
              <a
                href={`/api/rh/documento?id=${a.documentoId}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 hover:underline print:hidden"
              >
                abrir o arquivo
              </a>
            </Linha>
            <Linha r="Funcionário">{a.nome}</Linha>
            <Linha r="CPF">
              {cpfFmt(a.cpfInformado || a.cpfCadastro)}
              {a.cpfInformado
                ? a.cpfCadastro
                  ? ' — digitado pela pessoa e conferido com o cadastro'
                  : ' — digitado pela pessoa (o cadastro não tinha CPF)'
                : ''}
            </Linha>
            <Linha r="Pedido enviado">
              {dataHora(a.enviadoEm)} por {quemEnviou}
            </Linha>
            <Linha r="Link válido até">{dataHora(a.expiraEm)}</Linha>
            <Linha r="Documento aberto">{dataHora(a.abertoEm)}</Linha>
            <Linha r="Assinado em">{dataHora(a.assinadoEm)}</Linha>
            <Linha r="IP">{a.assinadoIp || '—'}</Linha>
            <Linha r="Aparelho">
              <span className="text-xs text-slate-600">{a.assinadoAparelho || '—'}</span>
            </Linha>
            <Linha r="Impressão digital do arquivo (SHA-256)">
              <span className="font-mono text-[11px]">no pedido: {a.hashDocumento}</span>
              <br />
              <span className="font-mono text-[11px]">no aceite: {a.hashNoAceite || '—'}</span>
              {a.hashNoAceite && (
                <span className={`block text-xs ${hashBate ? 'text-emerald-700' : 'text-red-700'}`}>
                  {hashBate
                    ? '✓ iguais: a pessoa assinou exatamente o arquivo que a empresa enviou'
                    : '✗ diferentes'}
                </span>
              )}
            </Linha>
            <Linha r="Rosto × cadastro do ponto">
              {fd == null ? (
                'sem comparação (sem rosto cadastrado no ponto ou o celular não leu o rosto)'
              ) : fd <= FACE_LIMIAR ? (
                <span className="text-emerald-700">
                  ✓ mesma pessoa do ponto facial (distância {fd.toFixed(3)}; limite {FACE_LIMIAR})
                </span>
              ) : (
                <span className="text-amber-700">
                  ⚠ não bateu com o rosto do ponto (distância {fd.toFixed(3)}; limite {FACE_LIMIAR}) — confira a selfie
                </span>
              )}
            </Linha>
            <Linha r="Selfie no aceite">
              {a.selfiePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/rh/assinatura?id=${a.id}`}
                  alt="Selfie do aceite"
                  className="mt-1 h-48 w-auto rounded border border-slate-200 object-cover"
                />
              ) : (
                '—'
              )}
            </Linha>
          </dl>

          {a.textoAceite && (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-slate-800">Termo aceito</h2>
              <p className="mt-1 whitespace-pre-line rounded bg-slate-50 p-3 text-sm text-slate-700 print:bg-white">
                {a.textoAceite}
              </p>
            </div>
          )}
          <p className="mt-4 text-[11px] text-slate-400">Registro {a.id}</p>
        </section>
      </main>
    </div>
  );
}
