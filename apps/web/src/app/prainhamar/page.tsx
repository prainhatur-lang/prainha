import Image from 'next/image';
import { headers } from 'next/headers';
import { BAR, COZINHA, type SecaoCardapio } from './cardapio';

// Site público da Prainha Mar e Grill (filial 03), servido em prainhamar.com.br
// pelo rewrite do proxy.ts (PRAINHAMAR_HOSTS). A reserva é online, igual à do
// Prainha Bar (mesas 1 a 70); WhatsApp fica como alternativa. Delivery não
// está ativo.

type IconProps = { className?: string };
const S = (props: IconProps & { children: React.ReactNode }) => (
  <svg className={props.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {props.children}
  </svg>
);
const MapPin = (p: IconProps) => <S {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></S>;
const Phone = (p: IconProps) => <S {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.6 9.8a16 16 0 0 0 6 6l1.4-1.4a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" /></S>;
const Chat = (p: IconProps) => <S {...p}><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5Z" /></S>;
const ArrowRight = (p: IconProps) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;

// WhatsApp da casa (atendimento da Nina) e telefone do salão.
const WHATSAPP_URL =
  'https://wa.me/5579996749949?text=' + encodeURIComponent('Olá! Quero reservar uma mesa na Prainha Mar e Grill.');
const TELEFONE = '(79) 99600-7289';
const TELEFONE_URL = 'tel:+5579996007289';
const ENDERECO = 'Shopping Praia Sul, loja 198 · Rod. dos Náufragos, 4880 · Aruana, Aracaju - SE';
const MAPS_BUSCA = encodeURIComponent('Shopping Praia Sul, Aracaju - SE');
const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${MAPS_BUSCA}`;
const MAPS_EMBED = `https://www.google.com/maps?q=${MAPS_BUSCA}&z=16&output=embed`;

// Reserva é da CASA: abre na mesma aba e no mesmo domínio. Em prainhamar.com.br
// o proxy serve /reserva (PRAINHAMAR_REWRITES); em outro host (app.prainhabar.com/
// prainhamar) vale o caminho de verdade.
const PRAINHAMAR_HOSTS = new Set(['prainhamar.com.br', 'www.prainhamar.com.br']);
const RESERVA_TOKEN = 'f631c264ae946fc54b3f52c0cb63fc2f0b8f2d94b92c02fc7c6162fa5a8900d3';

async function linkReserva(): Promise<string> {
  const host = ((await headers()).get('host') ?? '').split(':')[0];
  return PRAINHAMAR_HOSTS.has(host) ? '/reserva' : `/reservar/${RESERVA_TOKEN}`;
}

const display = { fontFamily: 'var(--font-display-mar)' };
const texto = { fontFamily: 'var(--font-texto-mar)' };

const DESTAQUES = [
  { nome: 'Moqueca de camarão VG', preco: 230, desc: 'Camarão VG de Santa Catarina, na panela, pra dividir' },
  { nome: 'Dueto do mar', preco: 94, desc: 'Filé alto de robalo e camarão grelhados no azeite extra virgem' },
  { nome: 'Picanha CaraPreta 250 g', preco: 179, desc: 'Na brasa, com farofa amanteigada, cebola caramelizada e vinagrete' },
  { nome: 'Camarão Paris no panko', preco: 138, desc: 'Camarão VG crocante com molho dijon de creme fresco e cogumelo paris' },
];

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Faixa de azulejo, o mesmo motivo do cardápio impresso.
function FaixaAzulejo() {
  return (
    <div
      aria-hidden
      className="h-6 w-full"
      style={{
        backgroundColor: '#1E3A5F',
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke='%23F5EFE3' stroke-width='1.2' opacity='.85'%3E%3Cpath d='M12 3 21 12 12 21 3 12Z'/%3E%3Ccircle cx='12' cy='12' r='2.5'/%3E%3Cpath d='M0 0 3 3M24 0 21 3M0 24 3 21M24 24 21 21'/%3E%3C/g%3E%3C/svg%3E\")",
        backgroundSize: '24px 24px',
      }}
    />
  );
}

function Secao({ secao }: { secao: SecaoCardapio }) {
  return (
    <div className="break-inside-avoid pb-10">
      <h3 className="mb-4 flex items-center gap-3 text-2xl font-semibold text-[#1E3A5F]" style={display}>
        {secao.titulo}
        <span className="h-px flex-1 bg-[#DD6A10]/40" />
      </h3>
      <ul className="space-y-4">
        {secao.itens.map((it) => (
          <li key={it.nome}>
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-medium text-[#1E3A5F]">
                {it.nome}
                {it.consulta && <span className="text-[#DD6A10]">*</span>}
              </span>
              <span className="mb-1 min-w-4 flex-1 border-b border-dotted border-[#1E3A5F]/30" />
              <span className="whitespace-nowrap text-[17px] font-semibold text-[#DD6A10]">{brl(it.preco)}</span>
            </div>
            {it.desc && <p className="mt-0.5 text-[15px] italic leading-snug text-[#4A5568]">{it.desc}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function PrainhaMarPage() {
  const reservaUrl = await linkReserva();
  return (
    <main className="min-h-screen bg-[#FBF7EE] text-[#4A5568] antialiased" style={texto}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[#1E3A5F]/10 bg-[#FBF7EE]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="#topo" className="flex items-center gap-2.5">
            <Image src="/prainhamar/selo.svg" alt="" width={36} height={36} unoptimized />
            <span className="text-xl font-semibold leading-none text-[#1E3A5F]" style={display}>
              Prainha <span className="italic text-[#DD6A10]">Mar &amp; Grill</span>
            </span>
          </a>
          <nav className="flex items-center gap-5 text-[15px]">
            <a href="#cardapio" className="hidden text-[#1E3A5F] hover:text-[#DD6A10] sm:inline">Cardápio</a>
            <a href="#visite" className="hidden text-[#1E3A5F] hover:text-[#DD6A10] sm:inline">Como chegar</a>
            <a
              href={reservaUrl}
              className="rounded-full bg-[#DD6A10] px-4 py-2 font-medium text-white transition hover:bg-[#c55d0c]"
            >
              Reservar
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section id="topo" className="relative overflow-hidden bg-[#F5EFE3]">
        <FaixaAzulejo />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.2fr_1fr] md:py-24">
          <div>
            <p className="mb-4 text-sm uppercase tracking-[0.3em] text-[#DD6A10]">Aracaju · Sergipe</p>
            <h1 className="text-5xl font-semibold leading-[1.05] text-[#1E3A5F] sm:text-6xl md:text-7xl" style={display}>
              Prainha
              <br />
              <span className="italic text-[#DD6A10]">Mar &amp; Grill</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed sm:text-xl">
              Frutos do mar, moquecas pra dividir, carnes na brasa e drinks da casa — com o jeito Prainha de receber.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={reservaUrl}
                className="inline-flex items-center gap-2 rounded-full bg-[#1E3A5F] px-6 py-3 text-lg font-medium text-white transition hover:bg-[#162c49]"
              >
                Reservar mesa <ArrowRight className="h-5 w-5" />
              </a>
              <a
                href="#cardapio"
                className="inline-flex items-center gap-2 rounded-full border border-[#1E3A5F]/30 px-6 py-3 text-lg font-medium text-[#1E3A5F] transition hover:border-[#DD6A10] hover:text-[#DD6A10]"
              >
                Ver o cardápio <ArrowRight className="h-5 w-5" />
              </a>
            </div>
          </div>
          <div className="flex justify-center">
            <Image
              src="/prainhamar/selo.svg"
              alt="Selo Prainha Mar & Grill"
              width={360}
              height={360}
              priority
              unoptimized
              className="h-auto w-64 drop-shadow-[0_12px_30px_rgba(30,58,95,0.18)] sm:w-80 md:w-[360px]"
            />
          </div>
        </div>
        <FaixaAzulejo />
      </section>

      {/* Destaques */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <p className="text-center text-sm uppercase tracking-[0.3em] text-[#DD6A10]">Da casa</p>
        <h2 className="mt-2 text-center text-4xl font-semibold text-[#1E3A5F] sm:text-5xl" style={display}>
          Pra começar a escolher
        </h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {DESTAQUES.map((d) => (
            <div key={d.nome} className="flex flex-col rounded-2xl border border-[#1E3A5F]/10 bg-white p-6 shadow-sm">
              <h3 className="text-2xl font-semibold leading-tight text-[#1E3A5F]" style={display}>{d.nome}</h3>
              <p className="mt-2 flex-1 text-[15px] italic leading-snug">{d.desc}</p>
              <p className="mt-4 text-xl font-semibold text-[#DD6A10]">R$ {brl(d.preco)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Cardápio */}
      <section id="cardapio" className="scroll-mt-16 bg-[#F5EFE3]">
        <FaixaAzulejo />
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
          <p className="text-center text-sm uppercase tracking-[0.3em] text-[#DD6A10]">Cardápio</p>
          <h2 className="mt-2 text-center text-4xl font-semibold text-[#1E3A5F] sm:text-5xl" style={display}>
            Cozinha &amp; Bar
          </h2>
          <p className="mt-3 text-center text-[15px]">Preços em reais.</p>

          <div className="mt-12 grid gap-x-16 md:grid-cols-[1.4fr_1fr]">
            <div>
              <h3 className="mb-8 text-center text-sm uppercase tracking-[0.3em] text-[#1E3A5F]/70">Cozinha</h3>
              <div className="lg:columns-2 lg:gap-12">
                {COZINHA.map((s) => <Secao key={s.titulo} secao={s} />)}
              </div>
              <p className="text-[14px] italic">
                <span className="text-[#DD6A10]">*</span> Sob consulta — pergunte ao garçom a disponibilidade do dia.
              </p>
            </div>
            <div className="mt-12 md:mt-0">
              <h3 className="mb-8 text-center text-sm uppercase tracking-[0.3em] text-[#1E3A5F]/70">Bar</h3>
              {BAR.map((s) => <Secao key={s.titulo} secao={s} />)}
            </div>
          </div>
        </div>
        <FaixaAzulejo />
      </section>

      {/* CTA */}
      <section className="bg-[#1E3A5F] text-[#F5EFE3]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6">
          <h2 className="text-4xl font-semibold sm:text-5xl" style={display}>
            Guarde sua <span className="italic text-[#F0A35E]">mesa</span>
          </h2>
          <p className="max-w-xl text-lg text-[#F5EFE3]/85">
            Escolha o dia, o horário e a mesa em 1 minuto — ou chame no WhatsApp que a gente reserva por você.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={reservaUrl}
              className="inline-flex items-center gap-2 rounded-full bg-[#DD6A10] px-7 py-3.5 text-lg font-medium text-white transition hover:bg-[#c55d0c]"
            >
              Reservar mesa <ArrowRight className="h-5 w-5" />
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-full border border-[#F5EFE3]/40 px-7 py-3.5 text-lg font-medium text-[#F5EFE3] transition hover:border-[#F0A35E] hover:text-[#F0A35E]"
            >
              <Chat className="h-5 w-5" /> WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* Visite */}
      <section id="visite" className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[#DD6A10]">Visite</p>
            <h2 className="mt-2 text-4xl font-semibold text-[#1E3A5F] sm:text-5xl" style={display}>Como chegar</h2>
            <ul className="mt-8 space-y-5 text-lg">
              <li className="flex gap-3">
                <MapPin className="mt-1 h-5 w-5 shrink-0 text-[#DD6A10]" />
                <a href={MAPS_URL} target="_blank" rel="noopener" className="hover:text-[#DD6A10]">{ENDERECO}</a>
              </li>
              <li className="flex gap-3">
                <Chat className="mt-1 h-5 w-5 shrink-0 text-[#DD6A10]" />
                <a href={WHATSAPP_URL} target="_blank" rel="noopener" className="hover:text-[#DD6A10]">WhatsApp — reservas e informações</a>
              </li>
              <li className="flex gap-3">
                <Phone className="mt-1 h-5 w-5 shrink-0 text-[#DD6A10]" />
                <a href={TELEFONE_URL} className="hover:text-[#DD6A10]">{TELEFONE}</a>
              </li>
            </ul>
            <a
              href={MAPS_URL}
              target="_blank"
              rel="noopener"
              className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#1E3A5F]/30 px-6 py-3 font-medium text-[#1E3A5F] transition hover:border-[#DD6A10] hover:text-[#DD6A10]"
            >
              Abrir no Google Maps <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#1E3A5F]/10 shadow-sm">
            <iframe
              src={MAPS_EMBED}
              title="Mapa — Prainha Mar e Grill"
              className="h-80 w-full md:h-full md:min-h-[360px]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#F5EFE3]">
        <FaixaAzulejo />
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-10 text-center text-sm sm:px-6">
          <Image src="/prainhamar/selo.svg" alt="" width={56} height={56} unoptimized />
          <p className="text-lg font-semibold text-[#1E3A5F]" style={display}>Prainha Mar &amp; Grill</p>
          <p>{ENDERECO}</p>
          <p className="text-[#4A5568]/70">Prainha Turismo EIRELI · CNPJ 33.159.574/0003-28</p>
        </div>
      </footer>
    </main>
  );
}
