// Dados públicos da Receita pelo CNPJ (BrasilAPI, reserva Minha Receita). Grátis.
// Usado pelo cadastro sozinho do Concilia (/conheca). O pedido-sem-nota tem a
// cópia dele (dadosReceitaCnpj) e continua igual.

export type ReceitaCnpj = {
  razaoSocial: string;
  nomeFantasia: string | null;
  cidade: string | null;
  uf: string | null;
  situacao: string | null;
};

export async function buscarCnpjReceita(cnpj: string): Promise<ReceitaCnpj | null> {
  const doc = cnpj.replace(/\D/g, '');
  if (doc.length !== 14) return null;
  for (const base of ['https://brasilapi.com.br/api/cnpj/v1/', 'https://minhareceita.org/']) {
    try {
      const r = await fetch(`${base}${doc}`, {
        headers: { 'User-Agent': 'concilia-prainha/1.0 (app.prainhabar.com)', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const c = (await r.json()) as Record<string, unknown>;
      const s = (k: string, max: number) => {
        const v = c[k];
        const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
        return t ? t.slice(0, max) : null;
      };
      const razaoSocial = s('razao_social', 200);
      if (!razaoSocial) continue;
      return {
        razaoSocial,
        nomeFantasia: s('nome_fantasia', 200),
        cidade: s('municipio', 120),
        uf: s('uf', 2)?.toUpperCase() ?? null,
        situacao: s('descricao_situacao_cadastral', 40),
      };
    } catch {
      /* tenta a próxima */
    }
  }
  return null;
}
