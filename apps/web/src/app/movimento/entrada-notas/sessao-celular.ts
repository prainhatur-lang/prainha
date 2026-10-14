// Sessão do "📱 Ler pelo celular" da Entrada de notas, guardada no navegador.
// o mesmo QR vale pra várias notas: guardado aqui, quem volta da nota aberta
// continua com o mesmo link (o celular não precisa ler outro QR)
const CHAVE_SESSAO = 'nota-chave-sessao:';
const SOBRA_MIN_MS = 30 * 60 * 1000;
// painel aberto nesta aba (sessionStorage): volta aberto da nota, e a página
// da nota também acompanha o celular enquanto ele estiver ligado
const CHAVE_PAINEL = 'nota-chave-painel:';

export function painelLigado(filialId: string): boolean {
  try {
    return sessionStorage.getItem(CHAVE_PAINEL + filialId) === '1';
  } catch {
    return false;
  }
}

export function marcarPainel(filialId: string, ligado: boolean) {
  try {
    if (ligado) sessionStorage.setItem(CHAVE_PAINEL + filialId, '1');
    else sessionStorage.removeItem(CHAVE_PAINEL + filialId);
  } catch {
    // sem sessionStorage — o painel só não volta aberto
  }
}

export function sessaoGuardada(filialId: string): { url: string; e: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO + filialId) ?? 'null') as { url?: string; e?: number } | null;
    if (s?.url && s.e && s.e * 1000 - Date.now() > SOBRA_MIN_MS) return { url: s.url, e: s.e };
  } catch {
    // sem localStorage — gera outro
  }
  return null;
}

export function guardarSessao(filialId: string, url: string, e: number) {
  try {
    localStorage.setItem(CHAVE_SESSAO + filialId, JSON.stringify({ url, e }));
  } catch {
    // sem localStorage — só não reaproveita o QR
  }
}
