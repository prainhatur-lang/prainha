// GET /api/nfe/consulta-destinatario?cnpj=… | ?cep=… — preenche o cadastro do
// cliente da NF-e: CNPJ na BrasilAPI (base da Receita), CEP no ViaCEP. Só
// ajuda a digitar; quem confere é quem emite.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { validarCnpj } from '@/lib/nfce/documento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const str = (s: unknown) => String(s ?? '').trim();

export async function GET(req: Request) {
  const { error } = await exigirPermApi('nfce.read');
  if (error) return error;
  const url = new URL(req.url);
  const cnpj = so(url.searchParams.get('cnpj'));
  const cep = so(url.searchParams.get('cep'));

  try {
    if (cnpj) {
      if (!validarCnpj(cnpj)) return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 });
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return NextResponse.json({ error: 'CNPJ não encontrado na Receita — preencha na mão' }, { status: 404 });
      const j = (await r.json()) as Record<string, unknown>;
      const tipo = str(j.descricao_tipo_de_logradouro);
      return NextResponse.json({
        ok: true,
        situacao: str(j.descricao_situacao_cadastral),
        dados: {
          nome: str(j.razao_social),
          logradouro: [tipo, str(j.logradouro)].filter(Boolean).join(' '),
          numero: str(j.numero),
          complemento: str(j.complemento),
          bairro: str(j.bairro),
          codigoMunicipio: so(j.codigo_municipio_ibge),
          municipio: str(j.municipio),
          uf: str(j.uf),
          cep: so(j.cep),
          fone: so(j.ddd_telefone_1),
          email: str(j.email).toLowerCase(),
        },
      });
    }
    if (cep) {
      if (cep.length !== 8) return NextResponse.json({ error: 'CEP inválido' }, { status: 400 });
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(12000) });
      const j = r.ok ? ((await r.json()) as Record<string, unknown>) : null;
      if (!j || j.erro) return NextResponse.json({ error: 'CEP não encontrado — preencha na mão' }, { status: 404 });
      return NextResponse.json({
        ok: true,
        dados: {
          logradouro: str(j.logradouro),
          bairro: str(j.bairro),
          codigoMunicipio: so(j.ibge),
          municipio: str(j.localidade),
          uf: str(j.uf),
          cep,
        },
      });
    }
  } catch {
    return NextResponse.json({ error: 'consulta fora do ar — preencha na mão' }, { status: 503 });
  }
  return NextResponse.json({ error: 'informe cnpj ou cep' }, { status: 400 });
}
