// Chamadas da aba Histórico de faturamento (VGV) pras rotas dela — roda no
// navegador.

export type Rota = 'acesso' | 'lancamento' | 'unidade';

export interface Resposta {
  ok: boolean;
  /** 0 = nem chegou no servidor. */
  status: number;
  dados: Record<string, unknown> | null;
  /** Mensagem pronta pra mostrar quando !ok. */
  erro: string;
}

export async function chamar(rota: Rota, corpo: Record<string, unknown>): Promise<Resposta> {
  let r: Response;
  try {
    r = await fetch(`/api/relatorios/historico-faturamento/${rota}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    return { ok: false, status: 0, dados: null, erro: 'Sem conexão. Tente de novo.' };
  }
  const dados = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.ok) return { ok: true, status: r.status, dados, erro: '' };
  const bruto = typeof dados?.error === 'string' ? dados.error : '';
  const erro =
    bruto === 'unauthorized'
      ? 'Seu login no app venceu. Entre de novo.'
      : bruto
        ? bruto.charAt(0).toUpperCase() + bruto.slice(1)
        : 'Não deu certo. Tente de novo.';
  return { ok: false, status: r.status, dados, erro };
}

/**
 * A resposta diz que a tela está velha: a aba trancou (o passe venceu ou a
 * senha foi trocada em outro aparelho) ou o login caiu. Quem chamou recarrega
 * a página — o servidor mostra o cadeado ou o login.
 */
export function telaVelha(r: Resposta): boolean {
  return r.status === 423 || (r.status === 401 && r.dados?.error === 'unauthorized');
}
