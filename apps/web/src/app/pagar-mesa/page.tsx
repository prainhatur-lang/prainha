// /pagar-mesa?f=..&m=..&v=..&r=..&e=..&s=..
//
// O cliente da mesa cai aqui vindo do QR: o servidor da loja e' HTTP e nao
// pode receber numero de cartao. Aqui e' HTTPS (Vercel) e reaproveita a mesma
// tela de cartao com 3DS que a reserva ja usa.
//
// Os parametros sao assinados (HMAC) pelo vendas-local. Link adulterado ou
// vencido nem renderiza o formulario.

import { lerParams } from '@/lib/pagar-mesa';
import { PagarMesaCliente } from './pagar-mesa-cliente';

export const dynamic = 'force-dynamic';

export default async function PagarMesaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') usp.set(k, v);
  const p = lerParams(usp);

  if (!p) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fbf6ec] px-6">
        <div className="max-w-sm rounded-2xl border border-[#e2c9a0] bg-white px-6 py-8 text-center">
          <h1 className="text-lg font-semibold text-[#1d130c]">Link inválido ou expirado</h1>
          <p className="mt-2 text-sm text-[#8a7a64]">
            Volte à tela da mesa e toque em <b>Pagar com cartão</b> de novo — o link vale por
            poucos minutos, por segurança.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbf6ec] px-5 py-8">
      <div className="mx-auto max-w-md">
        <header className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8a7a64]">
            Prainha Bar
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[#1d130c]">Pagar a conta</h1>
          <p className="mt-1 text-sm text-[#8a7a64]">Mesa {p.mesa}</p>
          <p className="mt-4 text-4xl font-bold tracking-tight text-[#1d130c]">
            {(p.valorCentavos / 100).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </p>
        </header>
        <div className="mt-7 rounded-2xl border border-[#e2c9a0] bg-white px-5 py-6">
          <PagarMesaCliente
            params={{ ...p, sig: usp.get('s') || '' }}
            totalCents={p.valorCentavos}
          />
        </div>
        <p className="mt-5 text-center text-xs leading-relaxed text-[#8a7a64]">
          Pagamento processado pela Cielo, com autenticação 3-D Secure.
          <br />
          Seus dados de cartão não passam pelo sistema da casa.
        </p>
      </div>
    </main>
  );
}
