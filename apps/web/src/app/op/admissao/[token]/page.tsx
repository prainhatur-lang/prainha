// Admissão pelo link do WhatsApp (04/11/2026) — página PÚBLICA /op/admissao/<token>.
// A pessoa preenche os dados, sobe os documentos, lê o contrato, aceita e assina
// com selfie e rubrica. Quem valida tudo é a rota /api/admissao-publica.
import type { Metadata } from 'next';
import { AdmissaoPublicaCliente } from './admissao-publica-cliente';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seu registro — Prainha', robots: { index: false, follow: false } };

export default async function AdmissaoPublicaPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <AdmissaoPublicaCliente token={token} />;
}
