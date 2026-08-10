// Validação de CPF/CNPJ pelos dígitos verificadores.
// Usada na emissão de NFC-e (documento do destinatário) — a mesma regra
// existe replicada no vendas-local e no lio-app pra validar antes de enviar.

export function validarCpf(raw: string): boolean {
  const cpf = String(raw).replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 000..., 111...
  for (const pos of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < pos; i++) soma += Number(cpf[i]) * (pos + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[pos])) return false;
  }
  return true;
}

export function validarCnpj(raw: string): boolean {
  const cnpj = String(raw).replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string): number => {
    // pesos 2..9 da direita pra esquerda
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += Number(base[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  if (calc(cnpj.slice(0, 12)) !== Number(cnpj[12])) return false;
  if (calc(cnpj.slice(0, 13)) !== Number(cnpj[13])) return false;
  return true;
}

/** Valida CPF (11) ou CNPJ (14). Retorna null se inválido. */
export function validarDocumento(raw: string): { doc: string; tipo: 'CPF' | 'CNPJ' } | null {
  const doc = String(raw || '').replace(/\D/g, '');
  if (doc.length === 11) return validarCpf(doc) ? { doc, tipo: 'CPF' } : null;
  if (doc.length === 14) return validarCnpj(doc) ? { doc, tipo: 'CNPJ' } : null;
  return null;
}

/** 12345678901 -> 123.456.789-01 · 14 digs -> 12.345.678/0001-90 */
export function formatarDocumento(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}
