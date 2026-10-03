// Ponto facial: a nuvem avisa a loja que o roster mudou (hoje: rosto apagado no
// /rh/ponto), pra loja puxar na hora em vez de esperar o pull dela, que é de 3
// em 3 min. 03/10/2026 (Sara): apagaram o rosto e ela foi bater o ponto antes
// do pull — a loja ainda tinha o rosto velho e o nome dela não vinha na lista
// de quem cadastra.
//
// Mesmo canal dos outros "o Concilia fala com o vendas-local desta filial"
// (filial.caixaUrl + PAGAR_MESA_SECRET), com escopo próprio 'ponto-roster' —
// separado do 'ponto' que a LOJA usa pra falar com a nuvem (a assinatura de um
// sentido não vale no outro). A loja verifica em centralAssinou(u,
// 'ponto-roster') e serve POST /api/central/ponto/roster. É só um "puxa agora":
// não leva nem traz dado de ninguém.
import { createHmac } from 'node:crypto';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';

export type AvisoRosterPonto = { ok: true; atualizado: boolean } | { ok: false; erro: string };

/** Avisa a loja pra puxar o roster do ponto agora. Nunca lança.
 *  `atualizado` = a loja confirmou que já puxou; false = recebeu o aviso mas o
 *  pull ainda não tinha terminado quando ela respondeu.
 *  Loja fora do ar ou em versão sem a rota → {ok:false}: ela pega no pull de
 *  3 min, como sempre pegou. */
export async function avisarLojaRosterPonto(filialId: string): Promise<AvisoRosterPonto> {
  try {
    const seg = process.env.PAGAR_MESA_SECRET;
    if (!seg || seg.length < 16) return { ok: false, erro: 'PAGAR_MESA_SECRET não configurado no servidor' };
    const base = await caixaUrlDaFilial(filialId);
    if (!base) return { ok: false, erro: 'filial sem a URL da loja configurada' };
    const e = Math.floor(Date.now() / 1000) + 120;
    const s = createHmac('sha256', seg).update([filialId, 'ponto-roster', String(e)].join('|')).digest('hex');
    // a loja segura a resposta até 5 s esperando o pull dela terminar
    const r = await fetch(`${base}/api/central/ponto/roster?e=${e}&s=${s}`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; erro?: string; atualizado?: boolean } | null;
    if (!j) return { ok: false, erro: `loja respondeu ${r.status} sem JSON` };
    if (!j.ok) return { ok: false, erro: j.erro || 'loja recusou o aviso' };
    return { ok: true, atualizado: j.atualizado === true };
  } catch (err) {
    return { ok: false, erro: 'loja fora do ar — ' + (err instanceof Error ? err.message : 'sem resposta') };
  }
}
