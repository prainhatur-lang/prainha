// Advertência / suspensão disciplinar pelo sistema (pedido do dono 10/11/2026):
// "o gerente clica no funcionário, diz por que foi a advertência e emite pra
// ela via WhatsApp, pra que ela receba, assine, tire a foto e mande de volta".
// O documento é gerado aqui (HTML só com estilo inline), guardado como
// funcionario_documento momento 'ocorrencia' e assinado pelo fluxo de sempre
// (/op/assinar/<token>: CPF + rubrica + selfie). Assinar = CIÊNCIA, não concordância.

export const TIPOS_OCORRENCIA = ['advertencia', 'suspensao'] as const;
export type TipoOcorrencia = (typeof TIPOS_OCORRENCIA)[number];

export const MOTIVOS_ADVERTENCIA = [
  'Atraso',
  'Falta sem justificativa',
  'Erro no caixa / cobrança',
  'Desrespeito a colega, cliente ou superior',
  'Uso de celular no horário de trabalho',
  'Descumprimento de norma da casa',
  'Saída sem autorização',
  'Outro',
];

export const ehOcorrencia = (tipo: string) => (TIPOS_OCORRENCIA as readonly string[]).includes(tipo);

/** Texto que a pessoa aceita numa advertência: confirma que recebeu, não que concorda. */
export function textoCienciaOcorrencia(nome: string, documento: string): string {
  return (
    `Eu, ${nome}, declaro que recebi e li o documento "${documento}" e que tomei ciência do seu conteúdo. ` +
    `Esta assinatura confirma o recebimento e a ciência, não significa que concordo com os fatos. ` +
    `Assino eletronicamente por este aceite, confirmado com o meu CPF e com a minha foto (selfie) tirada neste momento. ` +
    `Reconheço esta assinatura eletrônica como válida (Lei 14.063/2020 e MP 2.200-2/2001, art. 10, §2º).`
  );
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtCpf = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d || '—';
};
const fmtCnpj = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d || '—';
};
const fmtYmd = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const porExtenso = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} de ${MESES[(m ?? 1) - 1]} de ${y}`;
};

export interface DadosAdvertencia {
  tipo: TipoOcorrencia;
  empregador: string;
  cnpj: string | null;
  casa: string;
  nome: string;
  cpf: string | null;
  cargo: string | null;
  dataFato: string; // YYYY-MM-DD
  motivo: string;
  descricao: string;
  gerente: string;
  numero: number; // 1ª, 2ª... ocorrência desse tipo pra pessoa
  dataEmissao: string; // YYYY-MM-DD
  dias?: number | null; // suspensão
  inicioSuspensao?: string | null; // YYYY-MM-DD
}

export function htmlAdvertencia(a: DadosAdvertencia): string {
  const susp = a.tipo === 'suspensao';
  const titulo = susp ? 'SUSPENSÃO DISCIPLINAR' : 'ADVERTÊNCIA DISCIPLINAR';
  const corpo = susp
    ? `Pela presente, fica V.Sa. <b>SUSPENSO(A)</b> das suas atividades por <b>${a.dias ?? 1} dia(s)</b>` +
      (a.inicioSuspensao ? `, a partir de <b>${fmtYmd(a.inicioSuspensao)}</b>` : '') +
      `, sem remuneração dos dias de suspensão (art. 474 da CLT), pelo motivo descrito abaixo.`
    : `Pela presente, fica V.Sa. <b>ADVERTIDO(A)</b> pelo motivo descrito abaixo.`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} — ${esc(a.nome)}</title></head>
<body style="margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
<div style="max-width:720px;margin:0 auto;padding:24px 18px">
  <div style="text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:18px">
    <div style="font-size:16px;font-weight:bold">${esc(a.empregador)}</div>
    <div style="font-size:12px;color:#444">CNPJ ${fmtCnpj(a.cnpj)} · ${esc(a.casa)}</div>
  </div>
  <h1 style="text-align:center;font-size:20px;margin:0 0 4px">${titulo}</h1>
  <div style="text-align:center;font-size:12px;color:#555;margin-bottom:18px">${a.numero}ª ${susp ? 'suspensão' : 'advertência'} registrada no sistema</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
    <tr><td style="padding:4px 6px;border:1px solid #ccc;width:32%;background:#f5f5f5">Funcionário(a)</td><td style="padding:4px 6px;border:1px solid #ccc"><b>${esc(a.nome)}</b></td></tr>
    <tr><td style="padding:4px 6px;border:1px solid #ccc;background:#f5f5f5">CPF</td><td style="padding:4px 6px;border:1px solid #ccc">${fmtCpf(a.cpf)}</td></tr>
    <tr><td style="padding:4px 6px;border:1px solid #ccc;background:#f5f5f5">Função</td><td style="padding:4px 6px;border:1px solid #ccc">${esc(a.cargo || '—')}</td></tr>
    <tr><td style="padding:4px 6px;border:1px solid #ccc;background:#f5f5f5">Data do fato</td><td style="padding:4px 6px;border:1px solid #ccc">${fmtYmd(a.dataFato)}</td></tr>
    <tr><td style="padding:4px 6px;border:1px solid #ccc;background:#f5f5f5">Motivo</td><td style="padding:4px 6px;border:1px solid #ccc">${esc(a.motivo)}</td></tr>
  </table>
  <p>Prezado(a) ${esc(a.nome)},</p>
  <p>${corpo}</p>
  <div style="border:1px solid #999;border-radius:6px;padding:10px 12px;margin:12px 0;background:#fafafa;white-space:pre-wrap">${esc(a.descricao)}</div>
  <p>Solicitamos que tal conduta não se repita. A reincidência poderá levar a penalidades mais severas,
  inclusive à rescisão do contrato de trabalho por justa causa, nos termos do art. 482 da CLT.</p>
  <p>A sua assinatura abaixo confirma apenas que você <b>recebeu e tomou ciência</b> deste documento;
  não significa que concorda com o conteúdo. Se quiser, pode registrar a sua versão por escrito com a gerência.</p>
  <p style="margin-top:22px">Aracaju/SE, ${porExtenso(a.dataEmissao)}.</p>
  <div style="margin-top:28px;display:flex;gap:24px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px;border-top:1px solid #111;padding-top:4px;font-size:12px">
      ${esc(a.gerente)}<br>pela empresa ${esc(a.empregador)}
    </div>
    <div style="flex:1;min-width:220px;border-top:1px solid #111;padding-top:4px;font-size:12px">
      ${esc(a.nome)}<br>ciente — assinatura eletrônica com CPF, rubrica e selfie
    </div>
  </div>
</div></body></html>`;
}
