// /delivery/entrega/[token] — link do boy (dono 22/11/2026). Público (rota
// /delivery/* já é pública no proxy). 1ª vez: cadastro (nome, CPF, chave Pix,
// telefone confirmado no WhatsApp). Na porta: digita o código do cliente e o
// Pix do frete cai na chave dele.

import { notFound } from 'next/navigation';
import { visaoDoBoy } from '@/lib/delivery/despacho';
import { EntregaClient } from './entrega-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Entrega', robots: { index: false } };

export default async function EntregaBoyPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const v = await visaoDoBoy(token);
  if (!v) notFound();
  return <EntregaClient token={token} inicial={v} />;
}
