import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900">concilia</h1>
        <p className="mt-4 text-lg text-slate-600">
          Conciliação financeira ponta-a-ponta para restaurantes.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Rastreie cada venda do PDV até a conta bancária.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            Entrar
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-slate-300 bg-white px-6 py-2.5 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-slate-50"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </main>
  );
}
