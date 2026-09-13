// Mesas juntadas de uma reserva. A coluna `reserva.mesa_juntada` guarda as
// mesas EXTRAS emendadas à `mesa` principal, separadas por vírgula
// ("13,14" = mesa principal + 13 + 14). Nasceu com uma mesa só; virou lista
// quando a recepção precisou juntar 3+ mesas pra grupo grande (set/2026).
// Sem import de banco — serve no client e no server.

const SEPARADOR = /[,+/;\s]+/;

/** "13, 14" | "13+14" | "13" | null → ['13','14'] (sem vazio, sem repetição). */
export function parseJuntadas(v: string | null | undefined): string[] {
  if (!v) return [];
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const parte of String(v).split(SEPARADOR)) {
    const m = parte.trim();
    if (!m || vistas.has(m)) continue;
    vistas.add(m);
    out.push(m);
  }
  return out;
}

/** Lista → valor pra gravar na coluna (null = sem junção). Tira a mesa
 *  principal e limita cada número a 20 chars / o total a 100 (largura da coluna). */
export function serializeJuntadas(mesas: string[], mesaPrincipal?: string | null): string | null {
  const principal = mesaPrincipal ? String(mesaPrincipal).trim() : '';
  const limpas = parseJuntadas(mesas.map((m) => String(m).trim().slice(0, 20)).join(',')).filter((m) => m !== principal);
  if (limpas.length === 0) return null;
  const txt = limpas.join(',');
  return txt.length > 100 ? txt.slice(0, 100).replace(/,[^,]*$/, '') : txt;
}

/** Todas as mesas da reserva (principal + juntadas), pra checar ocupação. */
export function mesasDaReserva(mesa: string | null | undefined, juntadas: string | null | undefined): string[] {
  const out = mesa ? [String(mesa).trim()] : [];
  for (const m of parseJuntadas(juntadas)) if (!out.includes(m)) out.push(m);
  return out;
}

/** "12+13+14" (ou "12" / "" sem mesa) — pra listas, WhatsApp, painel da loja. */
export function textoMesas(mesa: string | null | undefined, juntadas: string | null | undefined, sep = '+'): string {
  return mesasDaReserva(mesa, juntadas).join(sep);
}
