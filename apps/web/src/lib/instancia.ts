// Qual instância do Concilia está rodando (02/11/2026).
//
// O mesmo código sobe em dois lugares:
// - 'prainha' (padrão): app.prainhabar.com, banco do Prainha.
// - 'clientes': instância separada dos clientes do SaaS, com banco próprio e
//   SEM nenhum dado do Prainha. Lá os crons não rodam (o vercel.json é o
//   mesmo) e a rota /api/saas/provisionar cria a loja de quem se cadastrou no
//   /conheca.

export function ehInstanciaClientes(): boolean {
  return process.env.CONCILIA_INSTANCIA === 'clientes';
}
