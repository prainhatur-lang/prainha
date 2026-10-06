// Logo de cada casa pro cabeçalho das notas (DANFE). Vale a que foi enviada em
// Configurações → Fiscal (fiscal_config.logoUrl); sem ela, a que já mora no
// projeto pra casa. Casa sem nenhuma das duas sai sem logo, como antes.

const PADRAO: Record<string, string> = {
  // 02 Tabuará
  'fde37b95-7c7e-4b41-a618-2aba1fbc0de7': '/tabuara/logo.png',
  // 03 Prainha Mar
  'e899dae2-38bf-4f3f-9149-7effd059fab8': '/prainhamar/icone.png',
};

export function logoDaFilial(filialId: string, cfg: { logoUrl?: string } | null | undefined): string | null {
  return cfg?.logoUrl || PADRAO[filialId] || null;
}
