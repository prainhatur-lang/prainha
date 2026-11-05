// Admissão pelo link do WhatsApp (pedido do dono 04/11/2026): "a gente coloca
// o CPF, pelo SPC traz as informações… confirma o WhatsApp… envia um link pra
// pessoa que vai ser contratada. Ela preenche todos os dados, sobe documento,
// foto, comprovante de residência, PIS… declara que aceita trabalhar naquele
// formato, pelo valor acertado, aceita o contrato de experiência, tira uma
// foto e assina digitalmente."
//
// Tabela admissao_convite. RH em /rh/admissao; a pessoa em /op/admissao/<token>.
// Ao assinar: cria (ou religa) o funcionario, grava o contrato em HTML na
// ficha (Documentos de entrada) + a assinatura eletrônica (comprovante em
// /rh/assinatura/<id>) + os documentos que ela subiu.
// O SPC não tem nome do pai — a pessoa preenche no link.

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import {
  CCT_NOME,
  clausulas,
  fmtCnpj,
  fmtCpf,
  fmtData,
  brl,
  numero,
  valorExtenso,
  type DadosPessoais,
  type Empregador,
  type TermosContrato,
} from '@/lib/rh/contrato-trabalho';

export const ADMISSAO_VALIDADE_DIAS = 15;
export const LINK_BASE_ADMISSAO = 'https://app.prainhabar.com/op/admissao/';

/** Quem pode registrar (CNPJ → nome que vai no cadastro, igual ao já usado). */
export const EMPREGADORES: { cnpj: string; empresaRegistro: string; rotulo: string }[] = [
  { cnpj: '33159574000166', empresaRegistro: 'PRAINHA TURISMO LTDA', rotulo: 'Prainha Turismo — Prainha Bar (0001-66)' },
  { cnpj: '33159574000328', empresaRegistro: 'PRAINHA TURISMO LTDA', rotulo: 'Prainha Turismo — Prainha Mar (0003-28)' },
  { cnpj: '33159574000247', empresaRegistro: 'PRAINHA TURISMO LTDA', rotulo: 'Prainha Turismo — Tabuará (0002-47)' },
  { cnpj: '05486249000172', empresaRegistro: 'E.B.SERVICOS LTDA', rotulo: 'E.B. Serviços' },
  { cnpj: '54228128000136', empresaRegistro: 'LELIS ATACADISTA E VAREJISTA DE ALIMENTO', rotulo: 'Lelis' },
];

/** Endereço e razão do empregador: cadastro fiscal da casa com o CNPJ (E.B. fixo). */
export async function empregadorDoCnpj(cnpj: string): Promise<Empregador> {
  const c = cnpj.replace(/\D/g, '');
  if (c === '05486249000172') {
    return {
      cnpj: c,
      razaoSocial: 'E.B. SERVIÇOS LTDA',
      nomeCasa: 'E.B. Serviços',
      endereco: 'Rua Zaqueu Brandão, 752',
      bairro: 'Salgado Filho',
      municipio: 'Aracaju',
      uf: 'SE',
      cep: '49020595',
    };
  }
  const [casa] = await db
    .select({ nome: schema.filial.nome, fiscal: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.cnpj, c))
    .limit(1);
  const e = casa?.fiscal?.endereco;
  const conhecido = EMPREGADORES.find((x) => x.cnpj === c);
  return {
    cnpj: c,
    razaoSocial: casa?.fiscal?.razaoSocial || conhecido?.empresaRegistro || casa?.nome || '',
    nomeCasa: casa?.nome ?? '',
    endereco: e ? [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ') : '',
    bairro: e?.bairro ?? '',
    municipio: e?.municipio ?? 'Aracaju',
    uf: e?.uf ?? 'SE',
    cep: e?.cep ?? '',
  };
}

/** "Casa, endereço" da filial onde a pessoa vai trabalhar (o local do contrato
 *  quando quem registra é outra empresa, ex.: E.B. registra, trabalha na Mar). */
export async function localDaCasa(filialId: string): Promise<string> {
  const [casa] = await db
    .select({ nome: schema.filial.nome, fiscal: schema.filial.fiscalConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!casa) return '';
  const e = casa.fiscal?.endereco;
  const end = e
    ? [[e.logradouro, e.numero, e.complemento].filter(Boolean).join(', '), e.bairro, `${e.municipio ?? 'Aracaju'}/${e.uf ?? 'SE'}`]
        .filter(Boolean)
        .join(', ')
    : '';
  return end ? `${casa.nome}, ${end}` : casa.nome;
}

/** O que o RH acerta antes de mandar o link (vai no contrato). */
export interface TermosConvite {
  modelo: TermosContrato['modelo'];
  empregadorCnpj: string;
  admissao: string;
  cargo: string;
  cbo: string;
  atividades: string;
  valor: string;
  jornada: string;
  local: string;
  expDias: string;
  expProrrogacao: string;
  setor: string;
  /** Escala (rh_jornada) que entra na ficha quando assina; vazio = decide na escala do mês. */
  jornadaId?: string;
  /** Pedido do exame admissional (ASO): onde e quando se apresentar. Vazio = sem pedido. */
  aso?: AsoConvite;
  /** Já trabalha antes do registro: até a véspera de `admissao` recebe por diária
   *  na folha semanal (fornecedor_folha.diarista_ate). 05/11/2026. */
  diariaAntes?: boolean;
}

/** Véspera do registro (último dia pago como diária). */
export function vesperaDoRegistro(admissao: string): string {
  const [y, m, d] = admissao.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}

/** Encaminhamento pro exame admissional (04/11/2026). O registro é `admissao`. */
export interface AsoConvite {
  clinica: string;
  endereco: string;
  telefone: string;
  /** YYYY-MM-DD — dia de se apresentar na clínica. */
  data: string;
  /** HH:MM (opcional). */
  hora: string;
  observacao: string;
}

/** Dados que a pessoa preenche no link (o contrato + o que a ficha pede). */
export interface PessoaisAdmissao extends DadosPessoais {
  nome: string;
  nascimento: string;
  sexo: string;
  numero: string;
  complemento: string;
  pixTipo: string;
  pixChave: string;
  contatoEmergencia: string;
  valeTransporte: 'quer' | 'nao_quer' | '';
}

export const PESSOAIS_ADMISSAO_VAZIO: PessoaisAdmissao = {
  nome: '',
  nascimento: '',
  sexo: '',
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
  numero: '',
  complemento: '',
  bairro: '',
  municipio: 'Aracaju',
  uf: 'SE',
  cep: '',
  dependentes: '',
  pixTipo: 'cpf',
  pixChave: '',
  contatoEmergencia: '',
  valeTransporte: '',
};

/** Documentos que a pessoa sobe no link → tipo na ficha (funcionario_documento). */
export const DOCS_PEDIDOS: { chave: string; rotulo: string; tipoFicha: string; obrigatorio: boolean; dica?: string; quem?: 'homem' }[] = [
  { chave: 'rg_frente', rotulo: 'RG ou CNH — frente', tipoFicha: 'documentos_pessoais', obrigatorio: true },
  { chave: 'rg_verso', rotulo: 'RG ou CNH — verso', tipoFicha: 'documentos_pessoais', obrigatorio: true },
  { chave: 'comprovante_endereco', rotulo: 'Comprovante de residência', tipoFicha: 'documentos_pessoais', obrigatorio: true, dica: 'conta de luz, água ou internet de até 3 meses' },
  { chave: 'ctps', rotulo: 'Carteira de trabalho digital', tipoFicha: 'ctps', obrigatorio: true, dica: 'print da tela do app Carteira de Trabalho Digital' },
  { chave: 'pis', rotulo: 'Comprovante do PIS/NIS', tipoFicha: 'documentos_pessoais', obrigatorio: false, dica: 'print do app da Carteira, Caixa Tem ou Meu INSS' },
  { chave: 'titulo', rotulo: 'Título de eleitor', tipoFicha: 'documentos_pessoais', obrigatorio: false, dica: 'pode ser o e-Título' },
  { chave: 'reservista', rotulo: 'Certificado de reservista', tipoFicha: 'documentos_pessoais', obrigatorio: false, dica: 'homem de 18 a 45 anos', quem: 'homem' },
  { chave: 'certidao', rotulo: 'Certidão de nascimento ou casamento', tipoFicha: 'documentos_pessoais', obrigatorio: false },
  { chave: 'escolaridade', rotulo: 'Comprovante de escolaridade', tipoFicha: 'outro_admissao', obrigatorio: false },
  { chave: 'filhos', rotulo: 'Certidão e vacina dos filhos até 14 anos', tipoFicha: 'outro_admissao', obrigatorio: false, dica: 'pro salário-família; pode subir mais de um' },
  { chave: 'aso', rotulo: 'Exame admissional (ASO)', tipoFicha: 'aso_admissional', obrigatorio: false, dica: 'se já fez' },
  { chave: 'outro', rotulo: 'Outro documento', tipoFicha: 'outro_admissao', obrigatorio: false },
];

export interface DocSubido {
  chave: string;
  path: string;
  nome: string;
  em: string;
}

/** Campos que travam a assinatura enquanto estiverem vazios. */
export function faltandoNoLink(p: Partial<PessoaisAdmissao>, docs: DocSubido[]): string[] {
  const f: string[] = [];
  if (!p.nome?.trim()) f.push('nome completo');
  if (!p.nascimento) f.push('data de nascimento');
  if (!p.mae?.trim()) f.push('nome da mãe');
  if (!p.estadoCivil) f.push('estado civil');
  if (!p.rg?.trim()) f.push('número do RG');
  if (!p.pis?.trim()) f.push('número do PIS');
  if (!p.logradouro?.trim()) f.push('endereço');
  if (!p.bairro?.trim()) f.push('bairro');
  if (!p.pixChave?.trim()) f.push('chave Pix');
  if (!p.valeTransporte) f.push('se quer vale-transporte');
  for (const d of DOCS_PEDIDOS.filter((x) => x.obrigatorio)) {
    if (!docs.some((s) => s.chave === d.chave)) f.push(d.rotulo);
  }
  return f;
}

export function termosParaContrato(t: TermosConvite, p: Partial<PessoaisAdmissao>, dataAssinatura: string): TermosContrato {
  return {
    modelo: t.modelo,
    empregadorCnpj: t.empregadorCnpj,
    admissao: t.admissao,
    cargo: t.cargo,
    cbo: t.cbo,
    atividades: t.atividades,
    valor: t.valor,
    jornada: t.jornada,
    local: t.local,
    expDias: t.expDias,
    expProrrogacao: t.expProrrogacao,
    valeTransporte: p.valeTransporte ?? '',
    cidadeAssinatura: 'Aracaju/SE',
    dataAssinatura,
    preposto: '',
    prepostoCargo: '',
    testemunha1: '',
    testemunha2: '',
  };
}

export function tituloContrato(modelo: TermosContrato['modelo']): string {
  if (modelo === 'intermitente') return 'Contrato de trabalho intermitente';
  if (modelo === 'experiencia') return 'Contrato de trabalho por prazo determinado — experiência';
  return 'Contrato de trabalho por prazo indeterminado';
}

/** Resumo do combinado (o que ela aceita, em uma frase). */
export function resumoCombinado(t: TermosConvite): string {
  const v = numero(t.valor);
  const valor = t.modelo === 'intermitente' ? `${brl(v)} por hora trabalhada` : `salário de ${brl(v)} por mês`;
  const modelo =
    t.modelo === 'intermitente'
      ? 'trabalho intermitente (por convocação)'
      : t.modelo === 'experiencia'
        ? `contrato de experiência de ${t.expDias || 45} dias${Number(t.expProrrogacao) > 0 ? `, prorrogável por mais ${t.expProrrogacao}` : ''}`
        : 'contrato por prazo indeterminado';
  return `${t.cargo} · ${modelo} · ${valor} · início em ${fmtData(t.admissao)} · jornada: ${t.jornada}`;
}

export const ACEITES = [
  { chave: 'contrato', texto: 'Li o contrato inteiro e aceito trabalhar nessas condições: função, formato, jornada e valor combinados.' },
  { chave: 'dados', texto: 'Os dados e documentos que enviei são verdadeiros e são meus.' },
  { chave: 'regulamento', texto: 'Vou cumprir o regulamento da casa, as normas de higiene e de segurança e registrar o ponto.' },
  { chave: 'lgpd', texto: 'Autorizo o uso dos meus dados e da minha foto (inclusive no ponto facial) para o contrato de trabalho, o eSocial e a folha (LGPD).' },
] as const;

export function textoAceiteAdmissao(nome: string, cpf: string, t: TermosConvite): string {
  return (
    `Eu, ${nome}, CPF ${fmtCpf(cpf)}, declaro que li o "${tituloContrato(t.modelo)}" por inteiro e aceito trabalhar nas condições combinadas ` +
    `(${resumoCombinado(t)}). Declaro ainda que: ${ACEITES.map((a) => a.texto.replace(/\.$/, '')).join('; ')}. ` +
    `Assino eletronicamente por este aceite, confirmado com o meu CPF, a minha rubrica e a minha foto (selfie) tirada neste momento, ` +
    `e reconheço esta assinatura como válida (Lei 14.063/2020 e MP 2.200-2/2001, art. 10, §2º).`
  );
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function qualificacao(nome: string, cpf: string, p: Partial<PessoaisAdmissao>): string {
  const partes = [
    `<b>${esc(nome.toUpperCase())}</b>`,
    p.nacionalidade || 'brasileira',
    p.estadoCivil,
    p.nascimento ? `nascido(a) em ${fmtData(p.nascimento)}` : '',
    p.naturalidade ? `natural de ${p.naturalidade}` : '',
    p.mae ? `filho(a) de ${p.mae}${p.pai ? ` e ${p.pai}` : ''}` : '',
    `CPF ${fmtCpf(cpf)}`,
    p.rg ? `RG ${p.rg}${p.rgOrgao ? ` ${p.rgOrgao}` : ''}` : '',
    p.pis ? `PIS ${p.pis}` : '',
    p.ctps ? `CTPS ${p.ctps}${p.ctpsSerie ? ` série ${p.ctpsSerie}` : ''}` : 'CTPS digital',
    `residente em ${[p.logradouro, p.numero, p.complemento, p.bairro, `${p.municipio || 'Aracaju'}/${p.uf || 'SE'}`, p.cep ? `CEP ${p.cep}` : ''].filter(Boolean).join(', ')}`,
  ].filter(Boolean);
  return partes.map((x, i) => (i === 0 ? x : esc(x))).join(', ');
}

export interface AssinaturaNoContrato {
  em: Date;
  ip: string | null;
  aparelho: string | null;
  textoAceite: string;
  rubricaPng?: Buffer | null;
  selfie?: { buf: Buffer; mime: string } | null;
  conviteId: string;
}

/** Contrato completo em HTML (sem script; servido travado por responderDocHtml). */
export function contratoHtml(o: {
  nome: string;
  cpf: string;
  pessoais: Partial<PessoaisAdmissao>;
  termos: TermosConvite;
  empregador: Empregador;
  assinatura?: AssinaturaNoContrato;
}): string {
  const { nome, cpf, pessoais: p, termos: t, empregador: emp } = o;
  const dataAss = o.assinatura ? o.assinatura.em : new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Maceio' }).format(dataAss);
  const tc = termosParaContrato(t, p, ymd);
  const cls = clausulas(tc, emp);
  const v = numero(t.valor);
  const endEmp = [emp.endereco, emp.bairro, `${emp.municipio}/${emp.uf}`, emp.cep ? `CEP ${emp.cep}` : ''].filter(Boolean).join(', ');
  const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Maceio', dateStyle: 'short', timeStyle: 'medium' }).format(dataAss);

  const vt =
    p.valeTransporte === 'nao_quer'
      ? `Eu, ${esc(nome)}, declaro que NÃO desejo receber o vale-transporte (Lei 7.418/1985 e Decreto 10.854/2021, art. 112), por não precisar de transporte coletivo para ir e voltar do trabalho, e assumo a responsabilidade por esta informação.`
      : p.valeTransporte === 'quer'
        ? `Eu, ${esc(nome)}, declaro que DESEJO receber o vale-transporte (Lei 7.418/1985 e Decreto 10.854/2021, art. 112) e autorizo o desconto de até 6% do meu salário básico. Comprometo-me a informar mudança de endereço ou de trajeto e reconheço que usar o benefício de forma indevida é falta grave.`
        : '';

  const ass = o.assinatura;
  const img = (buf: Buffer, mime: string, alt: string, h: number) =>
    `<img alt="${alt}" src="data:${mime};base64,${buf.toString('base64')}" style="height:${h}px;max-width:100%;object-fit:contain">`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tituloContrato(t.modelo))} — ${esc(nome)}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:800px;margin:0 auto;padding:24px;line-height:1.5;font-size:14px;background:#fff}
h1{font-size:18px;text-align:center;text-transform:uppercase;margin:0 0 16px}
h2{font-size:14px;text-transform:uppercase;margin:18px 0 6px}
p{margin:6px 0;text-align:justify}
.box{border:1px solid #999;padding:10px 12px;margin:16px 0;border-radius:4px}
.ass{display:flex;gap:24px;flex-wrap:wrap;margin-top:24px}
.ass>div{flex:1;min-width:240px;border-top:1px solid #333;padding-top:6px;font-size:12px}
.meta{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#333;word-break:break-all}
@media print{body{padding:0}}
</style></head><body>
<h1>${esc(tituloContrato(t.modelo))}</h1>
<p><b>EMPREGADOR:</b> <b>${esc(emp.razaoSocial)}</b>, inscrito no CNPJ ${esc(fmtCnpj(emp.cnpj))}, com sede em ${esc(endEmp)}.</p>
<p><b>EMPREGADO(A):</b> ${qualificacao(nome, cpf, p)}.</p>
<p>As partes acima firmam o presente contrato de trabalho, que se rege pela Consolidação das Leis do Trabalho, pela ${esc(CCT_NOME)} e pelas cláusulas seguintes:</p>
${cls
  .map(
    (c, i) =>
      `<h2>Cláusula ${i + 1}ª — ${esc(c.titulo)}</h2>${c.paragrafos.map((x) => `<p>${esc(x)}</p>`).join('')}`,
  )
  .join('\n')}
<div class="box"><b>Resumo do combinado:</b> ${esc(resumoCombinado(t))}. Valor por extenso: ${esc(valorExtenso(v))}.</div>
${vt ? `<h2>Declaração de vale-transporte</h2><p>${vt}</p>` : ''}
<h2>Dados para pagamento</h2>
<p>Pix (${esc(p.pixTipo || 'chave')}): ${esc(p.pixChave || '—')} — conta de titularidade do(a) empregado(a).</p>
<p style="margin-top:18px">${esc(tc.cidadeAssinatura)}, ${esc(fmtData(ymd))}.</p>
<div class="ass">
  <div><b>${esc(emp.razaoSocial)}</b><br>CNPJ ${esc(fmtCnpj(emp.cnpj))}<br>Empregador</div>
  <div>${ass?.rubricaPng ? img(ass.rubricaPng, 'image/png', 'rubrica', 70) + '<br>' : ''}<b>${esc(nome.toUpperCase())}</b><br>CPF ${esc(fmtCpf(cpf))}<br>Empregado(a)</div>
</div>
${
  ass
    ? `<div class="box"><b>Assinatura eletrônica do(a) empregado(a)</b>
<div style="display:flex;gap:12px;align-items:flex-start;margin-top:8px;flex-wrap:wrap">
${ass.selfie ? img(ass.selfie.buf, ass.selfie.mime, 'selfie', 140) : ''}
<div class="meta">Assinado em ${esc(quando)} (horário de Aracaju)<br>IP: ${esc(ass.ip ?? '—')}<br>Aparelho: ${esc((ass.aparelho ?? '—').slice(0, 160))}<br>Convite: ${esc(ass.conviteId)}</div>
</div>
<p style="font-size:12px">${esc(ass.textoAceite)}</p></div>`
    : ''
}
</body></html>`;
}

/** Path de um arquivo do convite no bucket do RH. */
export function pastaConvite(filialId: string, conviteId: string): string {
  return `rh-documentos/${filialId}/admissao/${conviteId}`;
}

export const ROTULO_STATUS_CONVITE: Record<string, string> = {
  enviado: 'link enviado',
  aberto: 'pessoa abriu o link',
  assinado: 'assinado',
  cancelado: 'cancelado',
};

export function regimeDoModelo(m: TermosContrato['modelo']): 'intermitente_hora' | 'clt_mensal' {
  return m === 'intermitente' ? 'intermitente_hora' : 'clt_mensal';
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
/** "2026-11-09" → "segunda-feira, 09/11/2026". */
export function dataComDiaSemana(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  const dia = DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dia}, ${fmtData(ymd)}`;
}

/** Próxima segunda-feira depois de `ymd` (registro sai na segunda pra fechar a folha da semana). */
export function proximaSegunda(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const falta = ((8 - t.getUTCDay()) % 7) || 7;
  t.setUTCDate(t.getUTCDate() + falta);
  return t.toISOString().slice(0, 10);
}

/** Endereço público da guia do ASO (abre sem CPF; a defesa é o token). */
export const guiaAsoLink = (token: string) => `https://app.prainhabar.com/api/admissao-publica?token=${token}&guia=aso`;

/** Linhas do pedido do ASO pro texto do WhatsApp. */
export function textoAsoWhatsapp(a: AsoConvite, admissao: string, token: string): string {
  const quando = `${dataComDiaSemana(a.data)}${a.hora ? ` às ${a.hora}` : ''}`;
  return [
    `*Exame admissional (ASO):* apresente-se na ${a.clinica}${a.endereco ? ` (${a.endereco})` : ''} em ${quando}, com documento com foto e esta guia:`,
    guiaAsoLink(token),
    a.observacao ? `Obs.: ${a.observacao}` : '',
    `*Seu registro começa em ${dataComDiaSemana(admissao)}.*`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Guia de encaminhamento pro exame admissional — a pessoa mostra na clínica. */
export function guiaAsoHtml(o: {
  nome: string;
  cpf: string;
  nascimento?: string;
  termos: TermosConvite;
  empregador: Empregador;
  casa: string;
}): string {
  const { termos: t, empregador: emp } = o;
  const a = t.aso!;
  const endEmp = [emp.endereco, emp.bairro, `${emp.municipio}/${emp.uf}`].filter(Boolean).join(', ');
  const linha = (k: string, v: string) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Encaminhamento ASO — ${esc(o.nome)}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;color:#111;max-width:800px;margin:0 auto;padding:24px;line-height:1.5;font-size:14px;background:#fff}
h1{font-size:18px;text-align:center;text-transform:uppercase;margin:0 0 4px}
.sub{text-align:center;font-size:12px;color:#444;margin:0 0 16px}
h2{font-size:14px;text-transform:uppercase;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}
th{width:34%;background:#f4f4f4;font-weight:normal}
.box{border:2px solid #111;padding:10px 12px;margin:16px 0;border-radius:4px;font-size:15px}
.ass{margin-top:48px;border-top:1px solid #333;padding-top:6px;font-size:12px;width:60%}
@media print{body{padding:0}}
</style></head><body>
<h1>Encaminhamento para exame admissional</h1>
<p class="sub">ASO — Atestado de Saúde Ocupacional (NR-7)</p>
<h2>Empresa</h2>
<table>${linha('Razão social', emp.razaoSocial)}${linha('CNPJ', fmtCnpj(emp.cnpj))}${linha('Endereço', endEmp)}${linha('Local de trabalho', o.casa)}</table>
<h2>Candidato(a)</h2>
<table>${linha('Nome', o.nome)}${linha('CPF', fmtCpf(o.cpf))}${linha('Nascimento', o.nascimento ? fmtData(o.nascimento) : '')}${linha('Cargo / função', t.cargo)}${linha('CBO', t.cbo)}</table>
<h2>Clínica</h2>
<table>${linha('Clínica', a.clinica)}${linha('Endereço', a.endereco)}${linha('Telefone', a.telefone)}</table>
<div class="box"><b>Apresentar-se em:</b> ${esc(dataComDiaSemana(a.data))}${a.hora ? ` às ${esc(a.hora)}` : ''}<br>
<b>Data prevista do registro (admissão):</b> ${esc(dataComDiaSemana(t.admissao))}</div>
${a.observacao ? `<p><b>Observação:</b> ${esc(a.observacao)}</p>` : ''}
<p>Levar documento oficial com foto. O resultado (ASO) deve ser entregue ao RH antes da data do registro.</p>
<div class="ass">RH — ${esc(emp.razaoSocial)}</div>
</body></html>`;
}
