// Botão flutuante "fale no WhatsApp" dos sites públicos (dono, 19/10/2026:
// "colocar atendimento por zap em todos os sites"). Cai no número da
// atendente da casa — Nina no Prainha Bar, Otávio na Tabuará e Marina na
// Prainha Mar (número próprio desde 20/10; antes caía na Nina). Mesmos números
// de whatsapp_numero; casa nova sem número cai na Nina.

const NINA = '5579996749949';
const OTAVIO = '557935120567';
const MARINA = '5579999812578';

const PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const PRAINHA_MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';

const POR_FILIAL: Record<string, { numero: string; atendente: string; casa: string }> = {
  [PRAINHA_BAR]: { numero: NINA, atendente: 'Nina', casa: 'Prainha Bar' },
  [TABUARA]: { numero: OTAVIO, atendente: 'Otávio', casa: 'Tabuará' },
  [PRAINHA_MAR]: { numero: MARINA, atendente: 'Marina', casa: 'Prainha Mar e Grill' },
};

/** Acha a casa pelo nome da filial ("Tabuara", "Prainha Mar"...), pra telas que só têm o nome. */
export function filialIdPorNome(nome: string): string {
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('tabuara')) return TABUARA;
  if (n.includes('mar')) return PRAINHA_MAR;
  return PRAINHA_BAR;
}

export function ZapFlutuante({
  filialId,
  assunto,
  acimaDaBarra = false,
}: {
  filialId: string;
  /** Vai depois de "Olá! " na mensagem já escrita. */
  assunto?: string;
  /** Sobe o botão quando a página tem barra fixa embaixo (sacola do delivery). */
  acimaDaBarra?: boolean;
}) {
  const c = POR_FILIAL[filialId] ?? POR_FILIAL[PRAINHA_BAR];
  const texto = `Olá! ${assunto ?? `Vim pelo site do ${c.casa}.`}`;
  const href = `https://wa.me/${c.numero}?text=${encodeURIComponent(texto)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={`Falar com a ${c.atendente} no WhatsApp`}
      className={`group fixed right-4 z-40 flex items-center gap-2 rounded-full bg-[#25D366] p-3.5 text-white shadow-lg shadow-black/25 transition-transform hover:scale-105 sm:right-6 sm:pr-5 ${
        acimaDaBarra ? 'bottom-28 lg:bottom-6' : 'bottom-5 sm:bottom-6'
      }`}
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" fill="currentColor" aria-hidden>
        <path d="M16.04 3C8.86 3 3.03 8.82 3.03 16c0 2.3.6 4.53 1.74 6.5L3 29l6.68-1.75A12.95 12.95 0 0 0 16.04 29C23.2 29 29 23.18 29 16S23.2 3 16.04 3Zm0 23.7c-1.98 0-3.92-.53-5.61-1.53l-.4-.24-3.97 1.04 1.06-3.86-.26-.4A10.66 10.66 0 0 1 5.33 16c0-5.9 4.8-10.7 10.71-10.7 5.9 0 10.66 4.8 10.66 10.7 0 5.9-4.76 10.7-10.66 10.7Zm5.86-8.01c-.32-.16-1.9-.94-2.2-1.04-.29-.11-.5-.16-.72.16-.21.32-.82 1.04-1.01 1.25-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.58-1.6-.95-.85-1.6-1.9-1.78-2.22-.19-.32-.02-.5.14-.66.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.72-1.73-.98-2.37-.26-.62-.52-.54-.72-.55h-.61c-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.66 0 1.57 1.14 3.09 1.3 3.3.16.21 2.25 3.43 5.44 4.81.76.33 1.35.52 1.81.67.76.24 1.45.2 2 .12.61-.09 1.9-.78 2.16-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37Z" />
      </svg>
      <span className="hidden text-sm font-semibold sm:inline">Fale com a gente</span>
    </a>
  );
}
