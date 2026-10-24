// Ponto pelo celular (24/10/2026) — página PÚBLICA do link pessoal
// /op/ponto/<token>. Sem AppHeader, mobile-first. Quem valida tudo (token,
// selfie, GPS, travas) é a rota /api/ponto-celular; aqui só pega GPS + selfie.
import type { Metadata } from 'next';
import { PontoCelularCliente } from './ponto-cliente';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ponto', robots: { index: false, follow: false } };

export default async function PontoCelularPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <PontoCelularCliente token={token} />;
}
