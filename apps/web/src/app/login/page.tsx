import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">concilia</h1>
          <p className="mt-2 text-sm text-slate-600">Entre na sua conta</p>
        </div>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
