// Assinatura eletrônica de documento (29/10/2026) — página PÚBLICA do link
// /op/assinar/<token>. Sem AppHeader, mobile-first. Quem valida tudo (token,
// CPF, selfie, documento não trocado) é a rota /api/assinatura-publica.
import type { Metadata } from 'next';
import { AssinarCliente } from './assinar-cliente';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Assinar documento', robots: { index: false, follow: false } };

export default async function AssinarPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <AssinarCliente token={token} />;
}
