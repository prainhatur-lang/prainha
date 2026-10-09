// soea.prainhabar.com — página do QR Code do card da 81ª SOEA (13 a 18/10/2026).
// Pública. O participante se cadastra (nome, celular, CPF) e sai daqui com um
// Cliente VIP Prainha Bar na categoria do benefício + 1 drink de boas-vindas.
// Regras em @/lib/soea; o cadastro bate em /api/soea.

import Image from 'next/image';
import { cookies } from 'next/headers';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { carregarPrograma } from '@/lib/fidelidade/config';
import { baseUrl } from '@/lib/fidelidade/vista';
import { SOEA, nivelSoea, soeaAberta } from '@/lib/soea';
import { CadastroSoea } from './cadastro';

export const dynamic = 'force-dynamic';

const RESERVAS_URL = 'https://reservas.prainhabar.com';
const SITE_URL = 'https://www.prainhabar.com';
const INSTAGRAM_URL = 'https://www.instagram.com/prainha.se/';
const MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Prainha+Bar+Matapoa+Aracaju';
const ENDERECO = 'Estrada Matapoã, 2288 · Mosqueiro, Aracaju/SE';

const display = { fontFamily: 'var(--font-display-soea)' };
const texto = { fontFamily: 'var(--font-texto-soea)' };

type IconProps = { className?: string };
const S = (p: IconProps & { children: React.ReactNode }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {p.children}
  </svg>
);
const Calendario = (p: IconProps) => <S {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></S>;
const Globo = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></S>;
const Insta = (p: IconProps) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></S>;
const Pino = (p: IconProps) => <S {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></S>;
const Seta = (p: IconProps) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;

function Atalho({ href, titulo, sub, children }: { href: string; titulo: string; sub: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 transition hover:border-[#F2C27A]/50 hover:bg-white/[0.08]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F2C27A]/10 text-[#F2C27A]">{children}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-[#FBF3E4]">{titulo}</span>
        <span className="block truncate text-[13px] text-[#FBF3E4]/55">{sub}</span>
      </span>
      <Seta className="h-5 w-5 shrink-0 text-[#FBF3E4]/30 transition group-hover:translate-x-0.5 group-hover:text-[#F2C27A]" />
    </a>
  );
}

export default async function SoeaPage() {
  const prog = await carregarPrograma(SOEA.filialId);
  const nivel = nivelSoea(prog.config);
  const bonus = prog.config.bonusDiaUtilPct;
  const aberta = soeaAberta() && prog.ativo;

  // quem já se cadastrou neste aparelho volta direto pro cartão
  const tk = (await cookies()).get(SOEA.cookie)?.value;
  const [meu] = tk && tk.length >= 16
    ? await db
        .select({ token: schema.fidelidadeCartao.token, nome: schema.fidelidadeCartao.nome })
        .from(schema.fidelidadeCartao)
        .where(eq(schema.fidelidadeCartao.token, tk))
        .limit(1)
    : [];

  const passos = [
    { n: '1', t: 'Cadastre-se', d: 'Nome, celular e CPF. Leva menos de um minuto.' },
    { n: '2', t: 'Confirme pelo WhatsApp', d: `Chega um código no seu número e o cartão ${prog.marca} ${nivel.nome} abre no celular.` },
    { n: '3', t: 'No Prainha', d: 'Mostre o cartão e o crachá ao garçom para o drink. Na hora de pagar, toque em “Vou pagar agora” e diga o código de 4 letras.' },
  ];

  return (
    <main className="min-h-screen bg-[#160c08] text-[#FBF3E4] antialiased" style={texto}>
      {/* Abertura: o pôr do sol */}
      <section className="relative isolate overflow-hidden">
        {/* a foto ocupa a primeira tela; o sol fica acima do texto, que cai sobre a água */}
        <div className="absolute inset-x-0 top-0 -z-20 h-[88svh] min-h-[560px]">
          <Image
            src="/soea/por-do-sol.jpg"
            alt="Pôr do sol sobre o rio, visto do Prainha Bar, em Aracaju"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[50%_45%]"
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(22,12,8,.50) 0%, rgba(22,12,8,0) 20%, rgba(22,12,8,0) 44%, rgba(22,12,8,.62) 62%, rgba(22,12,8,.92) 86%, #160c08 100%)',
            }}
          />
        </div>
        <div className="mx-auto w-full max-w-xl px-5 pb-10 pt-7 sm:px-6">
          <header className="flex items-center justify-between">
            <div>
              <div className="text-[22px] font-semibold uppercase leading-none tracking-[0.32em] text-white" style={display}>
                Prainha
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.28em] text-white/75">Bar e restaurante · Aracaju</div>
            </div>
            <div className="rounded-full border border-white/35 bg-black/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-white backdrop-blur-sm">
              81ª SOEA
            </div>
          </header>

          <div className="pt-[max(50svh,330px)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-[#F2C27A]">13 a 18 de outubro</p>
            <h1 className="mt-3 text-[44px] font-medium leading-[1.02] text-white sm:text-[56px]" style={display}>
              O pôr do sol de Aracaju
              <br />
              <span className="italic text-[#F2C27A]">é à beira-rio.</span>
            </h1>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-white/85">
              Participante da SOEA é convidado da casa: um drink de boas-vindas e {nivel.pct}% de desconto na conta
              {bonus ? <>, {nivel.pct + bonus}% de segunda a sexta</> : null}.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/12 bg-black/25 px-4 py-3.5 backdrop-blur-md">
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[#F2C27A]">Boas-vindas</dt>
                <dd className="mt-1 text-[22px] leading-tight text-white" style={display}>1 drink da casa</dd>
              </div>
              <div className="rounded-2xl border border-white/12 bg-black/25 px-4 py-3.5 backdrop-blur-md">
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[#F2C27A]">Na conta</dt>
                <dd className="mt-1 text-[22px] leading-tight text-white" style={display}>
                  {bonus ? `${nivel.pct}% a ${nivel.pct + bonus}%` : `${nivel.pct}% de desconto`}
                </dd>
              </div>
            </dl>

            <div id="cadastro" className="mt-5 rounded-3xl border border-white/12 bg-[#1d110b]/85 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
              {meu ? (
                <div className="space-y-4 text-center">
                  <p className="text-2xl leading-tight" style={display}>
                    {meu.nome.trim().split(/\s+/)[0]}, seu cartão está pronto.
                  </p>
                  <a
                    href={`${baseUrl()}/cartao/${meu.token}`}
                    className="block w-full rounded-xl bg-gradient-to-b from-[#F2A65A] to-[#E0782A] px-5 py-4 text-[16px] font-semibold tracking-wide text-[#2A1408]"
                  >
                    Abrir meu cartão
                  </a>
                </div>
              ) : aberta ? (
                <>
                  <h2 className="text-[26px] leading-tight" style={display}>Seu cartão em um minuto</h2>
                  <p className="mb-5 mt-1 text-[14px] text-[#FBF3E4]/65">
                    Vira um {prog.marca} {nivel.nome}, no seu celular, válido durante o evento.
                  </p>
                  <CadastroSoea nivel={nivel.nome} />
                </>
              ) : (
                <div className="space-y-2 text-center">
                  <p className="text-2xl leading-tight" style={display}>O benefício da 81ª SOEA encerrou.</p>
                  <p className="text-[15px] text-[#FBF3E4]/70">O pôr do sol continua todos os dias. Reserve sua mesa.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-xl space-y-12 px-5 pb-14 pt-4 sm:px-6">
        <section aria-labelledby="como">
          <h2 id="como" className="text-[30px] leading-tight" style={display}>Como funciona</h2>
          <ol className="mt-5 space-y-5">
            {passos.map((p) => (
              <li key={p.n} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#F2C27A]/50 text-[17px] text-[#F2C27A]" style={display}>
                  {p.n}
                </span>
                <div>
                  <div className="text-[16px] font-medium">{p.t}</div>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-[#FBF3E4]/65">{p.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="casa" className="space-y-3">
          <h2 id="casa" className="text-[30px] leading-tight" style={display}>A casa</h2>
          <p className="pb-2 text-[15px] leading-relaxed text-[#FBF3E4]/70">
            Mesas na areia, à beira do rio, com música ao vivo, moqueca de camarão e o pôr do sol mais bonito da cidade.
            Entrada gratuita.
          </p>
          <Atalho href={RESERVAS_URL} titulo="Reservar mesa" sub="Escolha dia, horário e área"><Calendario className="h-5 w-5" /></Atalho>
          <Atalho href={MAPS_URL} titulo="Como chegar" sub={ENDERECO}><Pino className="h-5 w-5" /></Atalho>
          <Atalho href={INSTAGRAM_URL} titulo="Instagram" sub="@prainha.se"><Insta className="h-5 w-5" /></Atalho>
          <Atalho href={SITE_URL} titulo="Site" sub="prainhabar.com"><Globo className="h-5 w-5" /></Atalho>
        </section>

        <footer className="border-t border-white/10 pt-6 text-[12px] leading-relaxed text-[#FBF3E4]/45">
          <p>
            Benefício para participantes da 81ª SOEA, de 13 a 18/10/2026, só no Prainha Bar. Um drink de boas-vindas
            por participante, mediante crachá do evento e cartão ativado; bebida alcoólica apenas para maiores de 18
            anos. O desconto vale sobre o consumo (a taxa de serviço continua sobre o valor cheio), um uso por dia.
          </p>
          <p className="mt-3">
            Seus dados (nome, celular e CPF) são usados só para emitir o cartão e o benefício. Para pedir a exclusão,
            escreva para prainha@prainhabar.com.
          </p>
        </footer>
      </div>
    </main>
  );
}
