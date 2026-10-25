// Vitrine PÚBLICA do vale-presente no site das casas: "Dê um presente para
// quem você ama". A pessoa escolhe o valor, escreve o cartão, paga no Pix e
// recebe o voucher em /presente/<token>. Em tabuara.com.br e prainhamar.com.br
// o proxy serve isto em /presente; o site do Prainha Bar linka pra cá.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CASAS_PRESENTE, VALOR_PRESENTE_MAX, VALOR_PRESENTE_MIN } from '@/lib/vale-presente';
import { PresentearClient, type TemaCasa } from './presentear-client';

export const dynamic = 'force-dynamic';

const TEMAS: Record<string, TemaCasa> = {
  bar: {
    fundo: '#FFF7EC',
    fundo2: '#FCEBD3',
    texto: '#3B2A1E',
    suave: '#8A6E58',
    destaque: '#E0782F',
    destaqueTexto: '#FFFFFF',
    cartao: 'linear-gradient(135deg,#F6B26B 0%,#E0782F 45%,#9C3D2B 100%)',
    cartaoTexto: '#FFF8EE',
    escuro: false,
    frase: 'Pé na areia, sol se pondo e a mesa cheia. Presenteie um dia de Prainha.',
    imagem: null,
    selo: null,
  },
  tabuara: {
    fundo: '#0d0b09',
    fundo2: '#16130f',
    texto: '#f3ede1',
    suave: '#b8ad99',
    destaque: '#c9a24b',
    destaqueTexto: '#0d0b09',
    cartao: 'linear-gradient(135deg,#2a2218 0%,#14110d 55%,#3a2c17 100%)',
    cartaoTexto: '#e9d6a6',
    escuro: true,
    frase: 'Uma noite de gastronomia sensorial — cozinha autoral, coquetelaria e vinhos.',
    imagem: '/tabuara/hero.jpg',
    selo: null,
  },
  mar: {
    fundo: '#FBF7EE',
    fundo2: '#F5EFE3',
    texto: '#1E3A5F',
    suave: '#5B6B80',
    destaque: '#DD6A10',
    destaqueTexto: '#FFFFFF',
    cartao: 'linear-gradient(135deg,#1E3A5F 0%,#284d7a 50%,#DD6A10 140%)',
    cartaoTexto: '#FBF7EE',
    escuro: false,
    frase: 'Frutos do mar, brasa e drinks autorais. Um jantar pra lembrar.',
    imagem: null,
    selo: '/prainhamar/selo.svg',
  },
};

export async function generateMetadata(props: { params: Promise<{ casa: string }> }): Promise<Metadata> {
  const { casa } = await props.params;
  const c = CASAS_PRESENTE[casa];
  if (!c) return {};
  const titulo = `Vale-presente ${c.nome} — Dê um presente para quem você ama`;
  return {
    title: titulo,
    description: `Escolha o valor, escreva um cartão e pague no Pix. O vale chega na hora e vale como crédito no ${c.nome}.`,
    openGraph: { title: titulo, type: 'website', locale: 'pt_BR', siteName: c.nome },
  };
}

export default async function PresentearPage(props: { params: Promise<{ casa: string }> }) {
  const { casa } = await props.params;
  const c = CASAS_PRESENTE[casa];
  const tema = TEMAS[casa];
  if (!c || !tema) notFound();
  return (
    <PresentearClient
      casa={casa}
      nomeCasa={c.nome}
      site={c.site}
      tema={tema}
      minimo={VALOR_PRESENTE_MIN}
      maximo={VALOR_PRESENTE_MAX}
    />
  );
}
