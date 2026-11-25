// /cobranca/<token> — link de pagamento avulso por cartão (25/11/2026).
// Público: o cliente abre pelo WhatsApp e paga. Uso único e 3DS obrigatório
// (regras em /api/link-pagamento/[token]/cartao). O valor mostrado e o cobrado
// saem do banco.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { situacaoLinkPagamento, MSG_SEM_3DS } from '@/lib/link-pagamento';
import { CobrancaCliente } from './cobranca-cliente';

export const dynamic = 'force-dynamic';

// O prefixo {{N}} aparece quando o link sai por botão de template da Meta.
function limpar(token: string): string {
  return decodeURIComponent(token).replace(/^\{\{\d+\}\}/, '').trim();
}

function Aviso({ titulo, texto, ok }: { titulo: string; texto: string; ok?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fbf6ec] px-6">
      <div className="max-w-sm rounded-2xl border border-[#e2c9a0] bg-white px-6 py-8 text-center">
        {ok && (
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f7ee] text-2xl">
            ✓
          </div>
        )}
        <h1 className={`text-lg font-semibold ${ok ? 'text-[#15803d]' : 'text-[#1d130c]'}`}>{titulo}</h1>
        <p className="mt-2 text-sm text-[#8a7a64]">{texto}</p>
      </div>
    </main>
  );
}

export default async function CobrancaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: bruto } = await params;
  const token = limpar(bruto);
  const [row] = await db
    .select({ link: schema.linkPagamento, filialNome: schema.filial.nome })
    .from(schema.linkPagamento)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.linkPagamento.filialId))
    .where(eq(schema.linkPagamento.token, token))
    .limit(1);

  if (!row) return <Aviso titulo="Link inválido" texto="Confira o link recebido ou peça um novo à casa." />;
  const { link, filialNome } = row;
  const situacao = situacaoLinkPagamento(link);
  const valor = Number(link.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (situacao === 'pago')
    return <Aviso ok titulo="Pagamento já realizado" texto={`${valor} — ${link.descricao}. Este link não pode ser usado de novo.`} />;
  if (situacao === 'cancelado')
    return <Aviso titulo="Link cancelado" texto="Este link foi cancelado pela casa. Peça um novo, se for o caso." />;
  if (situacao === 'expirado')
    return <Aviso titulo="Link vencido" texto="O prazo deste link acabou. Peça um novo à casa." />;
  if (situacao === 'travado')
    return <Aviso titulo="Link bloqueado" texto="Muitas tentativas recusadas. Por segurança, peça um novo link à casa." />;
  if (situacao === 'verificar' || situacao === 'processando')
    return (
      <Aviso
        titulo="Pagamento em conferência"
        texto="Já houve uma tentativa de pagamento neste link e estamos conferindo. Fale com a casa antes de tentar de novo."
      />
    );

  return (
    <main className="min-h-screen bg-[#fbf6ec] px-5 py-8">
      <div className="mx-auto max-w-md">
        <header className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8a7a64]">{filialNome}</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#1d130c]">Pagamento</h1>
          <p className="mt-1 text-sm text-[#8a7a64]">{link.descricao}</p>
          {link.clienteNome && <p className="text-sm text-[#8a7a64]">{link.clienteNome}</p>}
          <p className="mt-4 text-4xl font-bold tracking-tight text-[#1d130c]">{valor}</p>
        </header>
        <div className="mt-7 rounded-2xl border border-[#e2c9a0] bg-white px-5 py-6">
          <CobrancaCliente
            token={token}
            referencia={`LP${link.numero}`}
            totalCents={Math.round(Number(link.valor) * 100)}
            msgSem3ds={MSG_SEM_3DS}
          />
        </div>
        <p className="mt-5 text-center text-xs leading-relaxed text-[#8a7a64]">
          Pagamento processado pela Cielo. Este link vale para um único pagamento e exige a
          confirmação do seu banco (3-D Secure).
          <br />
          Seus dados de cartão não ficam guardados no sistema da casa.
        </p>
      </div>
    </main>
  );
}
