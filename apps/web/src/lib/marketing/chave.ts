// Chave válida de uma casa numa rede — renova na hora quando precisa e grava a
// nova. Usada pela tela e pelo cron /api/cron/marketing-tokens.

import { ligacaoRede, salvarLigacaoRede, type LigacaoRede, type Rede } from './ligacao';
import { renovarInstagram } from './instagram';
import { renovarTiktok } from './tiktok';

const DIA = 24 * 3600 * 1000;

/** Renova se está perto de vencer. `forcar` = cron (Instagram: chave com +24 h
 *  e menos de 50 dias de vida; TikTok: sempre, pra manter a renovação viva). */
export async function renovarSePreciso(
  filialId: string,
  rede: Rede,
  l: LigacaoRede,
  forcar = false,
): Promise<LigacaoRede> {
  const vence = Date.parse(l.expiraEm) || 0;
  const falta = vence - Date.now();
  if (rede === 'instagram') {
    // a Meta só renova chave com mais de 24 h; nova dura 60 dias
    const precisa = forcar ? falta < 59 * DIA : falta < 7 * DIA;
    if (!precisa || falta <= 0) return l;
    const n = await renovarInstagram(l.accessToken);
    await salvarLigacaoRede(filialId, rede, n, null);
    return { ...l, ...n };
  }
  const precisa = forcar || falta < 10 * 60 * 1000;
  if (!precisa || !l.refreshToken) return l;
  const n = await renovarTiktok(l.refreshToken);
  const novo = {
    accessToken: n.accessToken,
    refreshToken: n.refreshToken || l.refreshToken,
    expiraEm: n.expiraEm,
    refreshExpiraEm: n.refreshExpiraEm,
  };
  await salvarLigacaoRede(filialId, rede, novo, null);
  return { ...l, ...novo };
}

export async function chaveValida(filialId: string, rede: Rede): Promise<LigacaoRede | null> {
  const l = await ligacaoRede(filialId, rede);
  if (!l) return null;
  return renovarSePreciso(filialId, rede, l);
}
