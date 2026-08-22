import Image from 'next/image';
import { TabuaraGallery } from '@/components/tabuara-gallery';

export const dynamic = 'force-static';

type IconProps = { className?: string };
const S = (props: IconProps & { children: React.ReactNode }) => (
  <svg className={props.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {props.children}
  </svg>
);
const MapPin = (p: IconProps) => <S {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></S>;
const CalendarDays = (p: IconProps) => <S {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></S>;
const ShoppingBag = (p: IconProps) => <S {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18M16 10a4 4 0 0 1-8 0" /></S>;
const Instagram = (p: IconProps) => <S {...p}><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" /></S>;
const Phone = (p: IconProps) => <S {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.6 9.8a16 16 0 0 0 6 6l1.4-1.4a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" /></S>;
const Clock = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
const ArrowRight = (p: IconProps) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;

const RESERVA_URL =
  'https://app.prainhabar.com/reservar/6dd10ed01259fc44d1e0c67d1d29bf986ccb22e8a527d0419cc6a4c35a6e534e';
const DELIVERY_URL = 'https://tabuara.menudino.com.br';
const INSTAGRAM_URL = 'https://instagram.com/tabuara.se';
const MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Tabuara+Praca+de+Eventos+Coroa+do+Meio+Aracaju';
const MAPS_EMBED =
  'https://www.google.com/maps?q=Tabuara+Praca+de+Eventos+Coroa+do+Meio+Aracaju&output=embed';
const TELEFONE = '(79) 3512-0567';

const serif = { fontFamily: 'var(--font-serif-tab)' };

// Nomes e ruas conferidos contra o cardápio que está no PDV da casa (0002).
// A foto manda: o arquivo `prato-risoto.jpg` é o Camarão Tigre e saiu daqui.
const DESTAQUES = [
  { src: '/tabuara/destaque-polvo.jpg', nome: 'Risoto all Mare', rua: 'Avenida Tancredo Neves', desc: 'Polvo, camarão e lula sobre risoto cremoso' },
  { src: '/tabuara/prato-file.jpg', nome: 'Picanha com batatas gratinadas', rua: 'Avenida Ivo do Prado', desc: 'No ponto, com gratin dauphinois e chimichurri' },
  { src: '/tabuara/prato-coco.jpg', nome: 'Mini Fondue', rua: 'Rua Laranjeiras', desc: 'Fondue de queijo servido no pão, com iscas empanadas' },
  { src: '/tabuara/prato-salmao.jpg', nome: 'Salmão filetado', rua: 'Rua Rosário do Catete', desc: 'Fatiado fino, crocante e toque cítrico' },
  { src: '/tabuara/prato-bruschetta.jpg', nome: 'Bruschetta', rua: 'Rua Estância', desc: 'Camarão salteado, tomate confitado e pesto' },
];

const GALERIA = [
  { id: 'g1', src: '/tabuara/ambiente.jpg', alt: 'Salão da Tabuará', title: 'O ambiente' },
  { id: 'g2', src: '/tabuara/destaque-polvo.jpg', alt: 'Risoto all Mare', title: 'Risoto all Mare' },
  { id: 'g3', src: '/tabuara/drink-assinatura.jpg', alt: 'Coquetel autoral', title: 'Coquetelaria' },
  { id: 'g4', src: '/tabuara/prato-salmao.jpg', alt: 'Salmão filetado', title: 'Salmão filetado' },
  { id: 'g5', src: '/tabuara/bar.jpg', alt: 'Bar da Tabuará', title: 'O bar' },
  { id: 'g6', src: '/tabuara/prato-file.jpg', alt: 'Picanha com batatas gratinadas', title: 'Corte nobre' },
  { id: 'g7', src: '/tabuara/drink-manga.jpg', alt: 'Drink autoral', title: 'Drinks' },
  { id: 'g8', src: '/tabuara/prato-bruschetta.jpg', alt: 'Bruschetta de camarão', title: 'Entradas' },
  { id: 'g9', src: '/tabuara/drink-vermelho.jpg', alt: 'Coquetel', title: 'Autorais' },
];

const DRINKS = [
  '/tabuara/drink-assinatura.jpg',
  '/tabuara/drink-negroni.jpg',
  '/tabuara/drink-manga.jpg',
  '/tabuara/drink-vermelho.jpg',
];

// A carta autoral da casa, como está no PDV — cada drink leva o nome de uma
// figura de Aracaju. A foto acima é ambientação: não dá pra afirmar qual copo
// é qual, então quem nomeia é a lista.
const AUTORAIS = [
  { nome: 'Seu Melinho', desc: 'Gin infusionado em framboesa, limão siciliano, xarope de açúcar e espuma de framboesa' },
  { nome: 'Seu Ataulfo', desc: 'Vodka de framboesa, limão taiti, xarope de gengibre e ginger ale' },
  { nome: 'Seu Nelson', desc: 'Vodka infusionada em baunilha, limão siciliano e redução de maracujá' },
  { nome: 'Seu Amintas', desc: 'Gin, xarope de gengibre, limão siciliano e cordial de capim-santo' },
  { nome: 'Seu Fonseca', desc: 'Bourbon fat washed em manteiga de garrafa, licor de avelã e bitter de cacau' },
  { nome: 'Seu Josias', desc: 'Gin, Royal Charlotte, sumo de morango, limão siciliano e xarope de canela' },
  { nome: 'Seu Juca Leo', desc: 'Gin infusionado com goiaba, limão siciliano, xarope de coco e Angostura' },
  { nome: 'Dona Olga', desc: 'Rum infusionado em abacaxi, bananinha, canela e limão siciliano' },
  { nome: 'Zé Balinha', desc: 'Gin infusionado em framboesa, vermute bianco, xarope de framboesa, limão siciliano e leite' },
  { nome: 'Fitzgerald', desc: 'Gin, limão siciliano, xarope de açúcar e Angostura bitter' },
];

export default function TabuaraPage() {
  return (
    <main className="min-h-screen bg-[#0d0b09] text-[#f3ede1] [font-family:var(--font-sans-tab)] antialiased">
      {/* ---------- NAV ---------- */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#0d0b09]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <span className="text-xl tracking-[0.25em] text-[#f3ede1]" style={serif}>
            TABUARÁ
          </span>
          <nav className="flex items-center gap-6 text-sm text-[#b8ad99]">
            <a href="#sobre" className="hidden transition-colors hover:text-[#d9bd82] sm:inline">A casa</a>
            <a href="#cardapio" className="hidden transition-colors hover:text-[#d9bd82] sm:inline">Cardápio</a>
            <a href="#visite" className="hidden transition-colors hover:text-[#d9bd82] sm:inline">Visite</a>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener" aria-label="Instagram" className="transition-colors hover:text-[#d9bd82]">
              <Instagram className="h-5 w-5" />
            </a>
            <a href={RESERVA_URL} target="_blank" rel="noopener" className="rounded-full border border-[#c9a24b]/50 px-4 py-1.5 text-[#d9bd82] transition-colors hover:bg-[#c9a24b]/10">
              Reservar
            </a>
          </nav>
        </div>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="relative flex min-h-[100svh] items-center justify-center overflow-hidden">
        <Image src="/tabuara/hero.jpg" alt="Ambiente da Tabuará" fill priority sizes="100vw" className="object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0d0b09]/70 via-[#0d0b09]/45 to-[#0d0b09]" />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 40%, transparent 40%, rgba(13,11,9,0.7) 100%)' }} />
        <div className="relative z-10 px-6 text-center [text-shadow:0_2px_30px_rgba(0,0,0,0.6)]">
          <p className="text-xs uppercase tracking-[0.4em] text-[#d9bd82]">Aracaju · Sergipe</p>
          <h1 className="mt-6 text-6xl leading-none tracking-tight text-[#f6f0e6] sm:text-8xl" style={serif}>Tabuará</h1>
          <p className="mt-5 text-lg font-light tracking-[0.2em] text-[#e4dccd] sm:text-xl">GASTRONOMIA SENSORIAL</p>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-[#c8bda9]">
            Cozinha autoral, coquetelaria e carta de vinhos, num ambiente pensado para despertar os sentidos.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a href={RESERVA_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full bg-[#c9a24b] px-7 py-3.5 text-sm font-medium text-[#0d0b09] transition-all hover:bg-[#d9bd82]">
              <CalendarDays className="h-4 w-4" /> Reservar mesa
            </a>
            <a href={DELIVERY_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full border border-[#f3ede1]/30 px-7 py-3.5 text-sm font-medium text-[#f3ede1] backdrop-blur-sm transition-all hover:border-[#f3ede1]/70">
              <ShoppingBag className="h-4 w-4" /> Delivery
            </a>
          </div>
        </div>
      </section>

      {/* ---------- SOBRE ---------- */}
      <section id="sobre" className="scroll-mt-20 bg-[#0d0b09]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 md:grid-cols-2 md:gap-16">
          <div className="relative aspect-[4/5] overflow-hidden rounded-sm">
            <Image src="/tabuara/ambiente.jpg" alt="Salão da Tabuará" fill sizes="(max-width:768px) 100vw, 45vw" className="object-cover" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#c9a24b]">A casa</p>
            <h2 className="mt-5 text-4xl leading-tight text-[#f3ede1] sm:text-5xl" style={serif}>Do tabuleiro de Ará</h2>
            <p className="mt-6 leading-relaxed text-[#b8ad99]">
              O nome <span className="text-[#e4dccd]">Tabuará</span> nasce de <span className="italic text-[#e4dccd]">Tabuleiro de Ará</span> — Aracaju,
              a primeira capital planejada do Brasil, desenhada em 1855 como um tabuleiro de xadrez cujas
              ruas correm até o rio Sergipe.
            </p>
            <p className="mt-4 leading-relaxed text-[#b8ad99]">
              Aqui, a memória afetiva da cidade — seus ladrilhos, suas ruas e as antigas bodegas — vira
              <span className="text-[#e4dccd]"> gastronomia sensorial</span>: cozinha autoral, coquetelaria e uma
              carta de vinhos, num ambiente que traduz Aracaju em cores, texturas e sabores.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/10 pt-8 text-sm">
              <div><p className="text-2xl text-[#d9bd82]" style={serif}>1855</p><p className="text-[#8f8574]">A cidade tabuleiro</p></div>
              <div><p className="text-2xl text-[#d9bd82]" style={serif}>Autoral</p><p className="text-[#8f8574]">Cozinha do chef</p></div>
              <div><p className="text-2xl text-[#d9bd82]" style={serif}>Sensorial</p><p className="text-[#8f8574]">Memória à mesa</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- CARDÁPIO / DESTAQUES ---------- */}
      <section id="cardapio" className="scroll-mt-20 bg-[#12100d]">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-[#c9a24b]">Do chef</p>
            <h2 className="mt-5 text-4xl text-[#f3ede1] sm:text-5xl" style={serif}>A cidade servida à mesa</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[#b8ad99]">
              Cada prato leva o nome de uma rua ou avenida de Aracaju — do Baião de Dois à Moqueca
              Rio Sergipe. A memória da cidade vira sabor. Veja o cardápio completo, com pratos,
              vinhos e drinks, no nosso menu online.
            </p>
          </div>
          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {DESTAQUES.map((d) => (
              <article key={d.nome} className="group">
                <div className="relative aspect-[4/3] overflow-hidden rounded-sm">
                  <Image src={d.src} alt={d.nome} fill sizes="(max-width:640px) 100vw, (max-width:1024px) 50vw, 33vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <h3 className="mt-4 text-xl text-[#f3ede1]" style={serif}>{d.nome}</h3>
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#c9a24b]">{d.rua}</p>
                <p className="mt-1.5 text-sm text-[#8f8574]">{d.desc}</p>
              </article>
            ))}
          </div>
          <div className="mt-14 text-center">
            <a href={DELIVERY_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full border border-[#c9a24b]/50 px-8 py-3.5 text-sm font-medium text-[#d9bd82] transition-colors hover:bg-[#c9a24b]/10">
              Ver cardápio completo <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ---------- COQUETELARIA ---------- */}
      <section className="relative overflow-hidden bg-[#0d0b09]">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-[#c9a24b]">Bar</p>
              <h2 className="mt-4 text-4xl text-[#f3ede1] sm:text-5xl" style={serif}>Coquetelaria autoral</h2>
            </div>
            <p className="max-w-xs text-sm text-[#8f8574]">Cada drink leva o nome de uma figura de Aracaju — gente que a cidade conhece pelo primeiro nome.</p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {DRINKS.map((src, i) => (
              <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-sm">
                <Image src={src} alt="Coquetel autoral da Tabuará" fill sizes="(max-width:768px) 50vw, 25vw" className="object-cover transition-transform duration-700 hover:scale-105" />
              </div>
            ))}
          </div>

          <div className="mt-14 grid gap-x-12 gap-y-7 border-t border-white/10 pt-12 sm:grid-cols-2">
            {AUTORAIS.map((d) => (
              <div key={d.nome}>
                <h3 className="text-lg text-[#f3ede1]" style={serif}>{d.nome}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[#8f8574]">{d.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- GALERIA ---------- */}
      <section className="bg-[#12100d]">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="mb-12 text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-[#c9a24b]">Galeria</p>
            <h2 className="mt-5 text-4xl text-[#f3ede1] sm:text-5xl" style={serif}>A Tabuará em imagens</h2>
          </div>
          <TabuaraGallery images={GALERIA} />
          <div className="mt-12 text-center">
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-sm text-[#b8ad99] transition-colors hover:text-[#d9bd82]">
              <Instagram className="h-4 w-4" /> @tabuara.se
            </a>
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="relative overflow-hidden">
        <Image src="/tabuara/destaque-polvo.jpg" alt="" fill sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-[#0d0b09]/85" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-4xl text-[#f6f0e6] sm:text-5xl" style={serif}>Reserve sua experiência</h2>
          <p className="mx-auto mt-4 max-w-lg text-[#c8bda9]">Garanta sua mesa ou receba a Tabuará em casa pelo delivery.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a href={RESERVA_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full bg-[#c9a24b] px-8 py-4 text-sm font-medium text-[#0d0b09] transition-all hover:bg-[#d9bd82]">
              <CalendarDays className="h-4 w-4" /> Reservar mesa
            </a>
            <a href={DELIVERY_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full border border-[#f3ede1]/30 px-8 py-4 text-sm font-medium text-[#f3ede1] transition-all hover:border-[#f3ede1]/70">
              <ShoppingBag className="h-4 w-4" /> Pedir delivery
            </a>
          </div>
        </div>
      </section>

      {/* ---------- VISITE ---------- */}
      <section id="visite" className="scroll-mt-20 bg-[#0d0b09]">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:px-8 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#c9a24b]">Visite</p>
            <h2 className="mt-5 text-4xl text-[#f3ede1] sm:text-5xl" style={serif}>Onde nos encontrar</h2>
            <ul className="mt-8 space-y-6 text-sm">
              <li className="flex items-start gap-4">
                <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#c9a24b]" />
                <div><p className="text-[#f3ede1]">Endereço</p><p className="mt-1 text-[#b8ad99]">Praça de Eventos — Coroa do Meio, Aracaju · SE<br />CEP 49035-820</p></div>
              </li>
              <li className="flex items-start gap-4">
                <Phone className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#c9a24b]" />
                <div><p className="text-[#f3ede1]">Telefone</p><a href={`tel:+557935120567`} className="mt-1 block text-[#b8ad99] transition-colors hover:text-[#d9bd82]">{TELEFONE}</a></div>
              </li>
              <li className="flex items-start gap-4">
                <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#c9a24b]" />
                <div><p className="text-[#f3ede1]">Reservas</p><p className="mt-1 text-[#b8ad99]">Recomendadas — garanta sua mesa pelo site.</p></div>
              </li>
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={MAPS_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full border border-[#f3ede1]/20 px-6 py-3 text-sm text-[#f3ede1] transition-colors hover:border-[#f3ede1]/50">
                <MapPin className="h-4 w-4" /> Abrir no Google Maps
              </a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-full border border-[#f3ede1]/20 px-6 py-3 text-sm text-[#f3ede1] transition-colors hover:border-[#f3ede1]/50">
                <Instagram className="h-4 w-4" /> @tabuara.se
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-sm border border-white/10">
            <iframe src={MAPS_EMBED} title="Tabuará — mapa" className="h-full min-h-[360px] w-full grayscale" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="border-t border-white/10 bg-[#0d0b09]">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <span className="text-lg tracking-[0.25em] text-[#f3ede1]" style={serif}>TABUARÁ</span>
            <p className="text-sm text-[#8f8574]">Gastronomia sensorial · Aracaju, SE</p>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-sm text-[#b8ad99] transition-colors hover:text-[#d9bd82]">
              <Instagram className="h-4 w-4" /> @tabuara.se
            </a>
          </div>
          <p className="mt-8 border-t border-white/5 pt-6 text-center text-xs text-[#6f6659]">
            © {new Date().getFullYear()} Tabuará. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </main>
  );
}
