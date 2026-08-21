// Cadastro de cliente: validação + normalização num lugar só, usada pelo POST
// (novo) e pelo PATCH (edição).
//
// A fonte da verdade do cliente é o CONTATOS do Consumer, na loja. A nuvem não
// alcança o Firebird direto — quem escreve lá é o agente local, pela fila
// `agente_comando`. Então todo campo daqui tem um par no Firebird (COL_MAP do
// agente, em agente-local/src/index.ts): mudar um lado sem o outro faz o
// campo salvar na nuvem e não chegar na loja.

export interface CamposCliente {
  nome?: string;
  cpfOuCnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  celular?: string | null;
  dataNascimento?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
  observacao?: string | null;
  limiteCreditoContaCorrente?: number | string | null;
  bloquearVendaAposLimite?: boolean;
  arquivarFiado?: boolean;
}

export interface ClienteNormalizado {
  /** Pro banco da nuvem (colunas de `cliente`). */
  nuvem: Record<string, unknown>;
  /** Pro Firebird, via fila do agente (chaves do COL_MAP). */
  loja: Record<string, string | number | null>;
}

const soDig = (s: string) => s.replace(/\D/g, '');

function texto(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().slice(0, max);
  return t || null;
}

export class ErroCadastro extends Error {}

/** Valida e normaliza. Lança ErroCadastro com mensagem pro usuário. */
export function normalizarCliente(
  body: CamposCliente,
  { exigirNome }: { exigirNome: boolean },
): ClienteNormalizado {
  const nuvem: Record<string, unknown> = {};
  const loja: Record<string, string | number | null> = {};

  if ('nome' in body || exigirNome) {
    const nome = texto(body.nome, 200);
    if (!nome && exigirNome) throw new ErroCadastro('nome é obrigatório');
    if (nome) {
      if (nome.length < 2) throw new ErroCadastro('nome muito curto');
      nuvem.nome = nome;
      loja.nome = nome;
    }
  }

  if ('cpfOuCnpj' in body) {
    const doc = body.cpfOuCnpj ? soDig(String(body.cpfOuCnpj)) : '';
    if (doc && doc.length !== 11 && doc.length !== 14) {
      throw new ErroCadastro('CPF/CNPJ deve ter 11 ou 14 dígitos');
    }
    nuvem.cpfOuCnpj = doc || null;
    loja.cnpjOuCpf = doc || null;
  }

  if ('email' in body) {
    const email = texto(body.email, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ErroCadastro('e-mail inválido');
    }
    nuvem.email = email;
    loja.email = email;
  }

  for (const [campo, colLoja, max] of [
    ['telefone', 'telefone', 30],
    ['celular', 'celular', 30],
  ] as const) {
    if (campo in body) {
      const bruto = body[campo];
      const dig = bruto ? soDig(String(bruto)) : '';
      if (dig && dig.length < 10) throw new ErroCadastro(`${campo} incompleto (DDD + número)`);
      const val = dig ? dig.slice(0, max) : null;
      nuvem[campo] = val;
      loja[colLoja] = val;
    }
  }

  if ('dataNascimento' in body) {
    const d = texto(body.dataNascimento, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ErroCadastro('nascimento inválido');
    if (d && (d < '1900-01-01' || d > new Date().toISOString().slice(0, 10))) {
      throw new ErroCadastro('data de nascimento fora do intervalo');
    }
    nuvem.dataNascimento = d;
    loja.dataNascimento = d;
  }

  for (const [campo, max] of [
    ['endereco', 120],
    ['numero', 20],
    ['complemento', 100],
    ['bairro', 100],
    ['cidade', 100],
    ['observacao', 500],
  ] as const) {
    if (campo in body) {
      const v = texto(body[campo], max);
      nuvem[campo] = v;
      loja[campo] = v;
    }
  }

  if ('uf' in body) {
    const uf = body.uf ? String(body.uf).trim().toUpperCase().slice(0, 2) : null;
    if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroCadastro('UF inválida');
    nuvem.uf = uf;
    loja.uf = uf;
  }

  if ('cep' in body) {
    const cep = body.cep ? soDig(String(body.cep)) : '';
    if (cep && cep.length !== 8) throw new ErroCadastro('CEP deve ter 8 dígitos');
    nuvem.cep = cep || null;
    loja.cep = cep || null;
  }

  // --- Fiado ---
  // Regra do sistema (vendas-local, fbClienteFiado): limite > 0 = habilitado.
  // Zero não é "sem teto", é "não faz fiado".
  if ('limiteCreditoContaCorrente' in body) {
    const bruto = body.limiteCreditoContaCorrente;
    if (bruto === null || bruto === '') {
      nuvem.limiteCreditoContaCorrente = null;
      loja.limiteCredito = 0;
    } else {
      const n = Number(String(bruto).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) throw new ErroCadastro('limite inválido');
      if (n > 1_000_000) throw new ErroCadastro('limite acima do teto (R$ 1.000.000)');
      nuvem.limiteCreditoContaCorrente = n.toFixed(2);
      loja.limiteCredito = n;
    }
  }

  if (typeof body.bloquearVendaAposLimite === 'boolean') {
    nuvem.bloquearVendaAposLimite = body.bloquearVendaAposLimite;
    loja.bloquearVendaAposLimite = body.bloquearVendaAposLimite ? 'S' : 'N';
  }

  if (typeof body.arquivarFiado === 'boolean') {
    nuvem.arquivarFiado = body.arquivarFiado;
    loja.arquivarFiado = body.arquivarFiado ? 'S' : 'N';
  }

  return { nuvem, loja };
}
