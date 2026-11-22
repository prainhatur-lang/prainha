// /delivery-admin/pedido/[id]/imprimir — via do pedido do delivery pra
// entregar (dono 22/11/2026: "onde se imprime o pedido ... pra entregar com o
// endereço direitinho"). Cupom de 80mm com cliente, telefone, endereço
// completo com referência, itens, totais e se já está pago. A loja continua
// imprimindo sozinha quando o caixa aceita; esta é a via pelo painel.

import { notFound, redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { BotoesImprimir } from './botoes';

export const dynamic = 'force-dynamic';

const brl = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function telefoneBonito(t: string): string {
  const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

export default async function ImprimirPedidoDelivery(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');

  const { id } = await props.params;
  const { auto } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, id))
    .limit(1);
  if (!p) notFound();
  const filiais = await filiaisDoUsuario(user.id);
  const casa = filiais.find((f) => f.id === p.filialId);
  if (!casa) notFound();

  const itens = await db
    .select()
    .from(schema.deliveryPedidoItem)
    .where(eq(schema.deliveryPedidoItem.pedidoId, p.id));

  const e = (p.endereco ?? null) as schema.DeliveryEnderecoCliente | null;
  const pago = p.pagamentoStatus === 'pago';
  const metodo =
    p.pagamentoMetodo === 'pix' ? 'Pix' : p.pagamentoMetodo === 'cartao' ? 'Cartão' : 'Na entrega';
  const quando = new Date(p.criadoEm).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const agendado =
    !p.asap && p.agendadoHora
      ? `${p.agendadoData.split('-').reverse().slice(0, 2).join('/')} às ${p.agendadoHora}`
      : null;

  const linha = <div className="my-2 border-t border-dashed border-black" />;

  return (
    <main className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto w-fit">
        <div className="no-print mb-4 flex items-center gap-3">
          <BotoesImprimir auto={auto === '1'} />
          <a href="/delivery-admin" className="text-sm text-slate-600 underline">
            ◂ voltar aos pedidos
          </a>
        </div>
        <div className="cupom bg-white px-4 py-5 font-mono text-[12px] leading-snug text-black shadow print:shadow-none">
          <div className="text-center">
            <div className="text-[13px] font-bold">{casa.nome}</div>
            <div className="text-[18px] font-bold">DELIVERY #{p.numero}</div>
            <div>{p.tipo === 'retirada' ? 'RETIRADA NA LOJA' : 'ENTREGA'}</div>
            <div>Pedido feito {quando}</div>
            {agendado && <div className="font-bold">AGENDADO: {agendado}</div>}
          </div>
          {linha}
          <div className="text-[14px] font-bold">{p.clienteNome}</div>
          <div>Tel: {telefoneBonito(p.clienteTelefone)}</div>
          {p.tipo !== 'retirada' && e && (
            <div className="mt-1 text-[13px]">
              <div className="font-bold">
                {[e.rua, e.numero].filter(Boolean).join(', ')}
              </div>
              {e.complemento && <div>{e.complemento}</div>}
              <div>
                {[e.bairro, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade]
                  .filter(Boolean)
                  .join(' - ')}
              </div>
              {e.cep && <div>CEP {e.cep}</div>}
              {e.referencia && <div className="font-bold">Ref.: {e.referencia}</div>}
              {p.distanciaKm && <div>~{Number(p.distanciaKm).toFixed(1)} km da loja</div>}
            </div>
          )}
          {linha}
          {itens.map((i) => (
            <div key={i.id} className="mb-1">
              <div className="flex justify-between gap-2">
                <span className="font-bold">
                  {i.qtd}x {i.nome}
                </span>
                <span>{brl(i.total)}</span>
              </div>
              {(i.complementos ?? []).map((c, k) => (
                <div key={k} className="pl-3">
                  + {c.nome}
                </div>
              ))}
              {i.obs && <div className="pl-3 font-bold">Obs: {i.obs}</div>}
            </div>
          ))}
          {p.observacao && (
            <div className="mt-1 font-bold">Obs. do pedido: {p.observacao}</div>
          )}
          {linha}
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{brl(p.subtotal)}</span>
          </div>
          {Number(p.desconto) > 0 && (
            <div className="flex justify-between">
              <span>Desconto{p.cupomCodigo ? ` (${p.cupomCodigo})` : ''}</span>
              <span>-{brl(p.desconto)}</span>
            </div>
          )}
          {p.tipo !== 'retirada' && (
            <div className="flex justify-between">
              <span>Entrega</span>
              <span>{Number(p.taxaEntrega) > 0 ? brl(p.taxaEntrega) : 'grátis'}</span>
            </div>
          )}
          <div className="flex justify-between text-[15px] font-bold">
            <span>TOTAL</span>
            <span>{brl(p.total)}</span>
          </div>
          {linha}
          <div className="text-center text-[15px] font-bold">
            {pago ? `PAGO (${metodo}) — NÃO COBRAR` : `RECEBER NA ENTREGA: ${brl(p.total)}`}
          </div>
          {p.clienteCpf && <div className="mt-1 text-center">CPF na nota: {p.clienteCpf}</div>}
        </div>
      </div>
      <style>{`
        .cupom { width: 80mm; }
        @media print {
          .no-print { display: none !important; }
          @page { size: 80mm auto; margin: 2mm; }
          body { background: #fff; }
        }
      `}</style>
    </main>
  );
}
