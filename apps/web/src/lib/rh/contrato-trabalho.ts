// Contrato de trabalho gerado pelo sistema (pedido do dono 04/11/2026: "fazer
// o contrato de trabalho diretamente pelo nosso sistema… subindo todos os
// documentos, tudo direitinho"). Tela em /rh/funcionarios/[id]/contrato.
//
// Três modelos: intermitente (CLT arts. 443 §3º e 452-A), experiência (arts.
// 443 §2º "c", 445 parágrafo único e 451) e prazo indeterminado. Os dados
// ficam em funcionario.dados_registro (jsonb): `pessoais` (RG, CTPS, PIS…) e
// `contrato` (termos do último contrato gerado). Imprime pra assinar; o
// assinado sobe na ficha como "Contrato de trabalho assinado" e dali sai o
// pedido de assinatura eletrônica, como os outros documentos.

export type ModeloContrato = 'intermitente' | 'experiencia' | 'indeterminado';

export const MODELOS: { valor: ModeloContrato; rotulo: string; dica: string }[] = [
  { valor: 'intermitente', rotulo: 'Intermitente (por hora, por chamado)', dica: 'CLT art. 452-A: convocada com 3 dias de antecedência, recebe ao fim de cada período' },
  { valor: 'experiencia', rotulo: 'Experiência (mensal)', dica: 'até 90 dias no total, prorrogável uma vez; depois vira prazo indeterminado' },
  { valor: 'indeterminado', rotulo: 'Prazo indeterminado (mensal)', dica: 'contrato normal, sem data pra acabar' },
];

export interface DadosPessoais {
  nacionalidade: string;
  naturalidade: string;
  estadoCivil: string;
  escolaridade: string;
  rg: string;
  rgOrgao: string;
  rgData: string;
  ctps: string;
  ctpsSerie: string;
  pis: string;
  titulo: string;
  reservista: string;
  mae: string;
  pai: string;
  email: string;
  logradouro: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  dependentes: string;
}

export interface TermosContrato {
  modelo: ModeloContrato;
  empregadorCnpj: string;
  admissao: string;
  cargo: string;
  cbo: string;
  atividades: string;
  /** Intermitente: valor da hora. Mensal: salário do mês. */
  valor: string;
  jornada: string;
  local: string;
  /** Experiência: dias do 1º período e da prorrogação. */
  expDias: string;
  expProrrogacao: string;
  valeTransporte: 'quer' | 'nao_quer' | '';
  cidadeAssinatura: string;
  dataAssinatura: string;
  preposto: string;
  prepostoCargo: string;
  testemunha1: string;
  testemunha2: string;
}

export interface DadosRegistro {
  pessoais?: Partial<DadosPessoais>;
  contrato?: Partial<TermosContrato>;
  atualizadoEm?: string;
}

export interface Empregador {
  cnpj: string;
  razaoSocial: string;
  nomeCasa: string;
  endereco: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
}

export const PESSOAIS_VAZIO: DadosPessoais = {
  nacionalidade: 'brasileira',
  naturalidade: '',
  estadoCivil: '',
  escolaridade: '',
  rg: '',
  rgOrgao: '',
  rgData: '',
  ctps: '',
  ctpsSerie: '',
  pis: '',
  titulo: '',
  reservista: '',
  mae: '',
  pai: '',
  email: '',
  logradouro: '',
  bairro: '',
  municipio: 'Aracaju',
  uf: 'SE',
  cep: '',
  dependentes: '',
};

/** Piso da CCT SINDHOTRE×SEHASE 2026/2028 (cl. 3ª) e a hora dele (÷220, pra cima). */
export const PISO_CCT = 1670;
export const PISO_HORA = Math.ceil((PISO_CCT / 220) * 100) / 100;
export const CCT_NOME = 'Convenção Coletiva SINDHOTRE × SEHASE 2026/2028 (registro MTE SE000084/2026)';

/** O que pedir à pessoa antes de assinar (vai na tela e na folha impressa). */
export const PEDIR_A_PESSOA: { item: string; dica?: string }[] = [
  { item: 'RG (frente e verso) ou CNH', dica: 'número, órgão e data de emissão' },
  { item: 'CPF' },
  { item: 'Carteira de trabalho digital', dica: 'print da tela do app com o número; a digital usa o CPF' },
  { item: 'Número do PIS/NIS', dica: 'no app da Carteira de Trabalho, Caixa Tem ou Meu INSS' },
  { item: 'Comprovante de endereço recente', dica: 'até 3 meses' },
  { item: 'Título de eleitor' },
  { item: 'Certificado de reservista', dica: 'homem de 18 a 45 anos' },
  { item: 'Certidão de nascimento ou casamento' },
  { item: 'Certidão de nascimento e vacina dos filhos até 14 anos', dica: 'pro salário-família e IR' },
  { item: 'Comprovante de escolaridade' },
  { item: 'Foto 3×4 ou a foto do ponto facial' },
  { item: 'Dados do Pix ou conta bancária', dica: 'no nome da própria pessoa' },
  { item: 'Exame admissional (ASO)', dica: 'feito ANTES de começar; sobe na ficha' },
  { item: 'Se quer ou não vale-transporte', dica: 'a declaração sai junto com o contrato' },
];

/** Documento faltando que impede o contrato (fica em vermelho na tela). */
export function faltandoParaContrato(p: Partial<DadosPessoais>, t: Partial<TermosContrato>, cpf: string | null): string[] {
  const f: string[] = [];
  if (!cpf) f.push('CPF no cadastro');
  if (!p.rg) f.push('RG');
  if (!p.pis) f.push('PIS');
  if (!p.logradouro) f.push('endereço');
  if (!t.empregadorCnpj) f.push('empregador');
  if (!t.admissao) f.push('data de início');
  if (!t.cargo) f.push('cargo');
  if (!t.valor || !(Number(t.valor.replace(',', '.')) > 0)) f.push(t.modelo === 'intermitente' ? 'valor da hora' : 'salário');
  if (!t.jornada) f.push('jornada');
  return f;
}

export function fmtCnpj(c: string): string {
  const d = c.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c;
}
export function fmtCpf(c: string | null): string {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c ?? '';
}
export function fmtData(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.split('-').reverse().join('/') : ymd;
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function dataExtenso(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [a, m, d] = ymd.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
export function brl(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
/** Aceita "7,60", "7.60" e "1.670,00". */
export function numero(v: string): number {
  const s = v.trim();
  if (/,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s);
}
export function somarDias(ymd: string, n: number): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export interface Clausula {
  titulo: string;
  paragrafos: string[];
}

/** Avisos que aparecem na tela antes de imprimir (não travam). */
export function avisosContrato(t: Partial<TermosContrato>): string[] {
  const a: string[] = [];
  const v = numero(t.valor ?? '');
  if (t.modelo === 'intermitente' && v > 0 && v < PISO_HORA) {
    a.push(`Valor da hora abaixo do piso da CCT por hora (${brl(PISO_HORA)} = ${brl(PISO_CCT)} ÷ 220). O art. 452-A não deixa pagar menos que a hora do piso nem menos que quem faz a mesma função.`);
  }
  if (t.modelo !== 'intermitente' && v > 0 && v < PISO_CCT) {
    a.push(`Salário abaixo do piso da CCT (${brl(PISO_CCT)}).`);
  }
  if (t.modelo === 'experiencia') {
    const d1 = Number(t.expDias || 0);
    const d2 = Number(t.expProrrogacao || 0);
    if (d1 + d2 > 90) a.push('Experiência passa de 90 dias somando a prorrogação (CLT art. 445, parágrafo único).');
  }
  return a;
}

/** Cláusulas do contrato. Texto corrido, sem HTML. */
export function clausulas(t: TermosContrato, emp: Empregador): Clausula[] {
  const local = t.local || `${emp.nomeCasa}, ${[emp.endereco, emp.bairro, `${emp.municipio}/${emp.uf}`].filter(Boolean).join(', ')}`;
  const cargo = `${t.cargo.toUpperCase()}${t.cbo ? ` (CBO ${t.cbo})` : ''}`;
  const valor = numero(t.valor);
  const c: Clausula[] = [];

  if (t.modelo === 'intermitente') {
    c.push({
      titulo: 'Do objeto e da modalidade',
      paragrafos: [
        `O EMPREGADOR contrata o EMPREGADO para exercer a função de ${cargo}, em regime de TRABALHO INTERMITENTE, nos termos dos arts. 443, § 3º, e 452-A da Consolidação das Leis do Trabalho (CLT), com prestação de serviços não contínua, alternando períodos de prestação de serviços e de inatividade.`,
        t.atividades ? `Compreendem a função as seguintes atividades: ${t.atividades}.` : 'Compreendem a função as atividades próprias do cargo e as que forem compatíveis com a condição pessoal do EMPREGADO.',
        `O contrato tem início em ${fmtData(t.admissao)} e vigora por prazo indeterminado.`,
      ],
    });
    c.push({
      titulo: 'Da remuneração',
      paragrafos: [
        `Pelas horas efetivamente trabalhadas, o EMPREGADO receberá ${brl(valor)} (${valorExtenso(valor)}) por hora, valor que não é inferior ao valor horário do salário mínimo nem ao devido aos demais empregados do estabelecimento que exerçam a mesma função, em contrato intermitente ou não (CLT, art. 452-A, caput), nem ao piso da categoria proporcional às horas.`,
        'Serão pagos, quando houver, o adicional noturno de 20% sobre a hora trabalhada entre 22h e 5h (CLT, art. 73), as horas extras com adicional de 50% e o trabalho em feriado com adicional de 100%, na forma da Convenção Coletiva.',
      ],
    });
    c.push({
      titulo: 'Da convocação',
      paragrafos: [
        'O EMPREGADOR convocará o EMPREGADO por qualquer meio de comunicação eficaz (WhatsApp, ligação, mensagem ou aplicativo), informando o dia, o horário e o local de trabalho, com pelo menos 3 (três) dias corridos de antecedência (CLT, art. 452-A, § 1º).',
        'Recebida a convocação, o EMPREGADO terá o prazo de 1 (um) dia útil para responder; o silêncio será entendido como recusa (CLT, art. 452-A, § 2º). A recusa da oferta não descaracteriza a subordinação (§ 3º).',
        'Aceita a oferta, a parte que descumprir, sem justo motivo, pagará à outra, no prazo de 30 (trinta) dias, multa de 50% (cinquenta por cento) da remuneração que seria devida, permitida a compensação em igual prazo (CLT, art. 452-A, § 4º).',
        'O período de inatividade não é considerado tempo à disposição do EMPREGADOR, e nele o EMPREGADO pode prestar serviços a outros contratantes (CLT, art. 452-A, § 5º).',
      ],
    });
    c.push({
      titulo: 'Do pagamento',
      paragrafos: [
        'Ao final de cada período de prestação de serviço, o EMPREGADO receberá de imediato a remuneração, as férias proporcionais com acréscimo de um terço, o décimo terceiro salário proporcional, o repouso semanal remunerado e os adicionais legais (CLT, art. 452-A, § 6º), com recibo que discrimine cada parcela (§ 7º).',
        'Quando a convocação abranger período superior a um mês, o pagamento não será estipulado por período maior que um mês e será feito até o quinto dia útil do mês seguinte ao trabalhado.',
        'O EMPREGADOR recolherá a contribuição previdenciária e o FGTS sobre os valores pagos no mês e entregará ao EMPREGADO o comprovante (CLT, art. 452-A, § 8º).',
        'O pagamento será feito por Pix ou depósito em conta de titularidade do EMPREGADO.',
      ],
    });
    c.push({
      titulo: 'Das férias',
      paragrafos: [
        'A cada 12 (doze) meses, o EMPREGADO adquire o direito de usufruir, nos 12 (doze) meses seguintes, um mês de férias, período em que não poderá ser convocado pelo EMPREGADOR (CLT, art. 452-A, § 9º).',
      ],
    });
  } else {
    const exp = t.modelo === 'experiencia';
    const d1 = Number(t.expDias || 45);
    const d2 = Number(t.expProrrogacao || 0);
    const fim1 = t.admissao ? somarDias(t.admissao, d1 - 1) : '';
    c.push({
      titulo: 'Do objeto',
      paragrafos: [
        `O EMPREGADOR contrata o EMPREGADO para exercer a função de ${cargo}.`,
        t.atividades ? `Compreendem a função as seguintes atividades: ${t.atividades}.` : 'Compreendem a função as atividades próprias do cargo e as que forem compatíveis com a condição pessoal do EMPREGADO.',
      ],
    });
    c.push({
      titulo: exp ? 'Do prazo de experiência' : 'Do prazo',
      paragrafos: exp
        ? [
            `O presente contrato é celebrado A TÍTULO DE EXPERIÊNCIA (CLT, art. 443, § 2º, "c"), pelo prazo de ${d1} (${inteiroExtenso(d1)}) dias, de ${fmtData(t.admissao)} a ${fmtData(fim1)}.`,
            d2 > 0
              ? `O prazo poderá ser prorrogado uma única vez, por mais ${d2} (${inteiroExtenso(d2)}) dias, até ${fmtData(somarDias(fim1, d2))}, sem ultrapassar 90 (noventa) dias no total (CLT, arts. 445, parágrafo único, e 451). Continuando o EMPREGADO a trabalhar depois do prazo, o contrato passa a vigorar por prazo indeterminado.`
              : 'Continuando o EMPREGADO a trabalhar depois do prazo, o contrato passa a vigorar por prazo indeterminado.',
            'A parte que, sem justa causa, encerrar o contrato antes do prazo pagará à outra metade da remuneração a que teria direito até o termo do contrato (CLT, arts. 479 e 480).',
          ]
        : [`O presente contrato tem início em ${fmtData(t.admissao)} e vigora por prazo indeterminado.`],
    });
    c.push({
      titulo: 'Da remuneração',
      paragrafos: [
        `O EMPREGADO receberá o salário mensal de ${brl(valor)} (${valorExtenso(valor)}), pago até o quinto dia útil do mês seguinte ao trabalhado, por Pix ou depósito em conta de sua titularidade.`,
        'Serão pagos, quando houver, o adicional noturno de 20% entre 22h e 5h (CLT, art. 73), as horas extras com adicional de 50% e o trabalho em feriado com adicional de 100% ou folga compensatória, na forma da Convenção Coletiva.',
      ],
    });
  }

  c.push({
    titulo: 'Da jornada',
    paragrafos: [
      t.modelo === 'intermitente'
        ? `A jornada de cada convocação será informada na própria convocação, respeitados os limites legais e a Convenção Coletiva. Referência combinada: ${t.jornada}.`
        : `Jornada: ${t.jornada}, respeitado o limite de 8 (oito) horas diárias e 44 (quarenta e quatro) semanais, com intervalo para refeição conforme a Convenção Coletiva e o descanso semanal remunerado conforme a escala.`,
      'O EMPREGADO registrará entrada, saída e intervalo no ponto eletrônico do EMPREGADOR (reconhecimento facial no tablet da casa ou link pessoal no celular). As horas extras e a compensação, inclusive por banco de horas, seguem a Convenção Coletiva.',
    ],
  });
  c.push({
    titulo: 'Do local de trabalho',
    paragrafos: [
      `O trabalho será prestado em ${local}, podendo o EMPREGADO, mediante aviso prévio, ser designado para outro estabelecimento do EMPREGADOR no município de Aracaju/SE, sem mudança de domicílio (CLT, art. 469).`,
    ],
  });
  c.push({
    titulo: 'Das obrigações do empregado',
    paragrafos: [
      'O EMPREGADO se obriga a cumprir o regulamento interno, as ordens de serviço, as normas de higiene e manipulação de alimentos (RDC ANVISA nº 216/2004), de segurança e de uso de uniforme e equipamentos de proteção, e a zelar pelos bens do EMPREGADOR.',
      'Em caso de dano causado pelo EMPREGADO, fica autorizado o desconto do valor correspondente, se houver dolo, ou, se houver culpa, conforme este acordo (CLT, art. 462, § 1º).',
      'Além dos descontos legais (INSS, IRRF, faltas e, se optar, até 6% do salário de vale-transporte), somente serão feitos descontos autorizados por escrito pelo EMPREGADO.',
    ],
  });
  c.push({
    titulo: 'Da proteção de dados',
    paragrafos: [
      'O EMPREGADO autoriza o tratamento dos seus dados pessoais, inclusive a biometria facial usada no registro de ponto, para as finalidades do contrato de trabalho, cumprimento de obrigações legais (eSocial, FGTS, INSS, folha de pagamento) e segurança, na forma da Lei nº 13.709/2018 (LGPD), arts. 7º, II e V, e 11, II, "a". Os dados são guardados pelo prazo exigido em lei.',
    ],
  });
  c.push({
    titulo: 'Da norma coletiva e do foro',
    paragrafos: [
      `Aplica-se a este contrato a ${CCT_NOME}, ou a que vier a substituí-la, no que for mais específico.`,
      'Para dirimir questões deste contrato fica eleito o foro da Justiça do Trabalho de Aracaju/SE.',
      'E, por estarem de acordo, as partes assinam este contrato em 2 (duas) vias de igual teor, na presença de 2 (duas) testemunhas.',
    ],
  });
  return c;
}

const UNID = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEM[c]);
  if (r) {
    if (r < 20) partes.push(UNID[r]);
    else partes.push(DEZ[Math.floor(r / 10)] + (r % 10 ? ` e ${UNID[r % 10]}` : ''));
  }
  return partes.join(' e ');
}

export function inteiroExtenso(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zero';
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (mil) partes.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
  if (resto) partes.push(ate999(resto));
  return partes.join(resto && (resto < 100 || resto % 100 === 0) ? ' e ' : ' ');
}

export function valorExtenso(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return 'zero real';
  const reais = Math.floor(v + 1e-9);
  const cent = Math.round((v - reais) * 100);
  const p: string[] = [];
  if (reais) p.push(`${inteiroExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`);
  if (cent) p.push(`${inteiroExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return p.join(' e ');
}
