// Admissão pelo link do WhatsApp — lado da pessoa (04/11/2026). PÚBLICA: quem
// abre é a pessoa pelo link /op/admissao/<token>, sem login. A defesa é o
// token (24 bytes aleatórios, vale 15 dias) + o CPF dela em todo POST.
// GET  ?token=…                              → situação (primeiro nome, casa)
// GET  ?token=…&guia=aso                     → guia do exame admissional (HTML, pra mostrar na clínica)
// POST { token, cpf, acao:'abrir' }          → dados salvos + o combinado
// POST { …, acao:'salvar', pessoais }        → grava o que ela preencheu
// POST { …, acao:'contrato' }                → HTML do contrato (pra ler antes)
// POST { …, acao:'upload_url', chave, nome } → endereço assinado pro arquivo
// POST { …, acao:'registrar_doc', chave, path, nome } / 'remover_doc'
// POST { …, acao:'assinar', aceites, selfie, rubrica, descriptor? }
//   → cadastro (novo ou religado), contrato assinado e documentos na ficha.
// Regra em lib/rh/admissao.ts; o RH manda o link em /rh/admissao.

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createAdminClient } from '@/lib/supabase/server';
import { BUCKET_DOC_RH, DOC_RH_EXTENSOES, extensaoDoc, pastaDocRh } from '@/lib/rh/documento-vinculo';
import { distanciaFacial } from '@/lib/rh/ponto-celular';
import {
  caminhoRubricaAssinatura,
  caminhoSelfieAssinatura,
  descritorRosto,
  ipDoPedido,
  novoTokenAssinatura,
  rubricaDoAceite,
  selfieDoAceite,
} from '@/lib/rh/assinatura';
import {
  ACEITES,
  DOCS_PEDIDOS,
  EMPREGADORES,
  PESSOAIS_ADMISSAO_VAZIO,
  contaCaixaDoLink,
  contaInterDoLink,
  contratoHtml,
  dataComDiaSemana,
  empregadorDoCnpj,
  guiaAsoHtml,
  guiaAsoLink,
  faltandoNoLink,
  pastaConvite,
  regimeDoModelo,
  resumoCombinado,
  termosParaContrato,
  textoAceiteAdmissao,
  tituloContrato,
  vesperaDoRegistro,
  type DocSubido,
  type PessoaisAdmissao,
  type TermosConvite,
} from '@/lib/rh/admissao';
import { numero } from '@/lib/rh/contrato-trabalho';
import { garantirPapeisDaPessoa } from '@/lib/rh/pessoa-unica';
import { garantirVinculoFolhaNasFiliais } from '@/lib/rh/vincular-folha-extras';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const soDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

async function conviteDoToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) return null;
  const C = schema.admissaoConvite;
  const [c] = await db
    .select({
      id: C.id,
      filialId: C.filialId,
      funcionarioId: C.funcionarioId,
      cpf: C.cpf,
      nome: C.nome,
      telefone: C.telefone,
      termos: C.termos,
      dadosSpc: C.dadosSpc,
      pessoais: C.pessoais,
      documentos: C.documentos,
      status: C.status,
      expiraEm: C.expiraEm,
      criadoPor: C.criadoPor,
      criadoEm: C.criadoEm,
      abertoEm: C.abertoEm,
      assinadoEm: C.assinadoEm,
      casa: schema.filial.nome,
    })
    .from(C)
    .innerJoin(schema.filial, eq(schema.filial.id, C.filialId))
    .where(eq(C.token, token))
    .limit(1);
  return c ?? null;
}
type Convite = NonNullable<Awaited<ReturnType<typeof conviteDoToken>>>;

function situacao(c: Convite): string | null {
  if (c.status === 'cancelado') return 'Este link foi cancelado. Fale com o RH do Prainha.';
  if (c.status !== 'assinado' && c.expiraEm.getTime() < Date.now()) return 'Este link venceu. Peça um novo ao RH do Prainha.';
  return null;
}

const docsDo = (c: Convite): DocSubido[] => (Array.isArray(c.documentos) ? (c.documentos as DocSubido[]) : []);

/** "1990-05-31" ou "31/05/1990" → "1990-05-31"; o resto vira ''. */
function ymd(x: unknown): string {
  const s = String(x ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** Primeira vez: o que o SPC já trouxe. Depois: o que ela salvou. */
function pessoaisIniciais(c: Convite): PessoaisAdmissao {
  if (c.pessoais && typeof c.pessoais === 'object') return { ...PESSOAIS_ADMISSAO_VAZIO, ...(c.pessoais as Partial<PessoaisAdmissao>) };
  const s = (c.dadosSpc ?? {}) as Record<string, unknown>;
  const t = (k: string) => (typeof s[k] === 'string' ? (s[k] as string).trim() : '');
  return {
    ...PESSOAIS_ADMISSAO_VAZIO,
    nome: c.nome,
    nascimento: ymd(s.dataNascimento),
    mae: t('mae'),
    pai: t('pai'),
    email: t('email'),
    logradouro: t('endereco'),
    numero: t('numero'),
    bairro: t('bairro'),
    municipio: t('cidade') || PESSOAIS_ADMISSAO_VAZIO.municipio,
    uf: (t('uf') || PESSOAIS_ADMISSAO_VAZIO.uf).slice(0, 2).toUpperCase(),
    cep: soDig(s.cep).slice(0, 8),
    pixChave: c.cpf,
  };
}

/** Só as chaves conhecidas, texto curto. */
function limparPessoais(raw: unknown): PessoaisAdmissao {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...PESSOAIS_ADMISSAO_VAZIO } as Record<string, string>;
  for (const k of Object.keys(PESSOAIS_ADMISSAO_VAZIO)) {
    if (r[k] === undefined || r[k] === null) continue;
    out[k] = String(r[k]).slice(0, k === 'dependentes' ? 1000 : 200);
  }
  if (!['quer', 'nao_quer', ''].includes(out.valeTransporte)) out.valeTransporte = '';
  if (!['H', 'M', ''].includes(out.sexo)) out.sexo = '';
  out.nascimento = ymd(out.nascimento);
  out.rgData = out.rgData ? ymd(out.rgData) : '';
  out.uf = out.uf.slice(0, 2).toUpperCase();
  return out as unknown as PessoaisAdmissao;
}

function erro(msg: string, status = 400) {
  return NextResponse.json({ ok: false, erro: msg }, { status });
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const c = await conviteDoToken(sp.get('token'));
  if (!c) return erro('Link não encontrado. Confira se copiou inteiro.', 404);
  if (sp.get('guia') === 'aso') {
    const t = c.termos as TermosConvite;
    const html = (corpo: string, status = 200) =>
      new NextResponse(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    if (c.status === 'cancelado') return html('<p style="font-family:sans-serif">Este link foi cancelado. Fale com o RH do Prainha.</p>', 410);
    if (!t.aso) return html('<p style="font-family:sans-serif">O RH ainda não marcou o exame admissional.</p>', 404);
    const p = pessoaisIniciais(c);
    return html(
      guiaAsoHtml({
        nome: p.nome?.trim() || c.nome,
        cpf: c.cpf,
        nascimento: p.nascimento,
        termos: t,
        empregador: await empregadorDoCnpj(t.empregadorCnpj),
        casa: c.casa,
      }),
    );
  }
  const s = situacao(c);
  return NextResponse.json({
    ok: true,
    primeiroNome: c.nome.trim().split(/\s+/)[0],
    casa: c.casa,
    status: c.status,
    assinadoEm: c.assinadoEm,
    bloqueio: s,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return erro('pedido inválido');
  const c = await conviteDoToken(body.token);
  if (!c) return erro('Link não encontrado. Confira se copiou inteiro.', 404);
  const bloqueio = situacao(c);
  if (bloqueio) return erro(bloqueio, 410);
  if (soDig(body.cpf) !== c.cpf) return erro('O CPF não confere com o deste link.', 403);
  if (c.status === 'assinado') return erro('Este contrato já foi assinado. Obrigado!', 409);

  const C = schema.admissaoConvite;
  const termos = c.termos as TermosConvite;
  const acao = String(body.acao ?? '');

  if (acao === 'abrir') {
    if (c.status === 'enviado') {
      await db.update(C).set({ status: 'aberto', abertoEm: new Date() }).where(and(eq(C.id, c.id), eq(C.status, 'enviado')));
    }
    const emp = EMPREGADORES.find((e) => e.cnpj === termos.empregadorCnpj);
    return NextResponse.json({
      ok: true,
      casa: c.casa,
      pessoais: pessoaisIniciais(c),
      docs: docsDo(c),
      titulo: tituloContrato(termos.modelo),
      resumo: resumoCombinado(termos),
      empregador: emp?.rotulo ?? '',
      modelo: termos.modelo,
      docsPedidos: DOCS_PEDIDOS,
      aceites: ACEITES,
      textoAceite: textoAceiteAdmissao(c.nome, c.cpf, termos),
      aso: termos.aso
        ? {
            clinica: termos.aso.clinica,
            endereco: termos.aso.endereco,
            telefone: termos.aso.telefone,
            quando: `${dataComDiaSemana(termos.aso.data)}${termos.aso.hora ? ` às ${termos.aso.hora}` : ''}`,
            observacao: termos.aso.observacao,
            registro: dataComDiaSemana(termos.admissao),
            guia: guiaAsoLink(String(body.token)),
          }
        : null,
    });
  }

  if (acao === 'salvar') {
    const p = limparPessoais(body.pessoais);
    await db.update(C).set({ pessoais: p }).where(and(eq(C.id, c.id), inArray(C.status, ['enviado', 'aberto'])));
    return NextResponse.json({ ok: true, faltando: faltandoNoLink(p, docsDo(c)) });
  }

  if (acao === 'contrato') {
    const p = body.pessoais ? limparPessoais(body.pessoais) : pessoaisIniciais(c);
    const html = contratoHtml({
      nome: p.nome?.trim() || c.nome,
      cpf: c.cpf,
      pessoais: p,
      termos,
      empregador: await empregadorDoCnpj(termos.empregadorCnpj),
    });
    return NextResponse.json({ ok: true, html });
  }

  if (acao === 'upload_url') {
    const chave = String(body.chave ?? '');
    if (!DOCS_PEDIDOS.some((d) => d.chave === chave)) return erro('documento desconhecido');
    const ext = extensaoDoc(String(body.nome ?? ''));
    if (!DOC_RH_EXTENSOES.includes(ext)) return erro('Mande foto (JPG, PNG, HEIC) ou PDF.');
    if (docsDo(c).length >= 40) return erro('Muitos arquivos neste link. Fale com o RH.');
    const path = `${pastaConvite(c.filialId, c.id)}/${chave}-${Date.now()}.${ext}`;
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_DOC_RH).createSignedUploadUrl(path);
    if (error || !data) return erro('Não consegui preparar o envio. Tente de novo.', 500);
    return NextResponse.json({ ok: true, bucket: BUCKET_DOC_RH, path: data.path, token: data.token });
  }

  if (acao === 'registrar_doc') {
    const chave = String(body.chave ?? '');
    const path = String(body.path ?? '');
    if (!DOCS_PEDIDOS.some((d) => d.chave === chave)) return erro('documento desconhecido');
    if (!path.startsWith(pastaConvite(c.filialId, c.id) + '/') || path.includes('..')) return erro('arquivo inválido');
    const docs = docsDo(c).filter((d) => d.path !== path);
    docs.push({ chave, path, nome: String(body.nome ?? '').slice(0, 200) || path.split('/').pop()!, em: new Date().toISOString() });
    await db.update(C).set({ documentos: docs }).where(eq(C.id, c.id));
    return NextResponse.json({ ok: true, docs });
  }

  if (acao === 'remover_doc') {
    const path = String(body.path ?? '');
    const docs = docsDo(c).filter((d) => d.path !== path);
    await db.update(C).set({ documentos: docs }).where(eq(C.id, c.id));
    if (path.startsWith(pastaConvite(c.filialId, c.id) + '/')) {
      const admin = await createAdminClient();
      await admin.storage.from(BUCKET_DOC_RH).remove([path]).catch(() => null);
    }
    return NextResponse.json({ ok: true, docs });
  }

  if (acao === 'assinar') return assinar(req, c, body);

  return erro('ação desconhecida');
}

async function assinar(req: Request, c: Convite, body: Record<string, unknown>) {
  const termos = c.termos as TermosConvite;
  const p = body.pessoais ? limparPessoais(body.pessoais) : pessoaisIniciais(c);
  const docs = docsDo(c);
  const falta = faltandoNoLink(p, docs);
  if (falta.length) return erro(`Ainda falta: ${falta.join(', ')}.`);
  const aceites = (body.aceites ?? {}) as Record<string, unknown>;
  if (!ACEITES.every((a) => aceites[a.chave] === true)) return erro('Marque todos os aceites antes de assinar.');
  const selfie = selfieDoAceite(body.selfie);
  if (!selfie) return erro('Tire a selfie antes de assinar.');
  const rubrica = rubricaDoAceite(body.rubrica);
  if (!rubrica) return erro('Faça a sua rubrica com o dedo no quadro.');

  const F = schema.funcionario;
  const [existente] = await db
    .select({ id: F.id, ativo: F.ativo, filialId: F.filialId, cnpjRegistro: F.cnpjRegistro, dadosRegistro: F.dadosRegistro, faceDescriptor: F.faceDescriptor })
    .from(F)
    .where(eq(F.cpf, c.cpf))
    .limit(1);
  if (existente?.ativo && existente.cnpjRegistro && existente.cnpjRegistro !== termos.empregadorCnpj) {
    return erro('Já existe um registro ativo seu em outra empresa. Fale com o RH do Prainha.', 409);
  }
  // Ativa em outra casa → a casa do convite entra como lotação extra.
  const lotacaoExtra = !!existente?.ativo && existente.filialId !== c.filialId;

  const nome = p.nome.trim() || c.nome;
  const funcionarioId = existente?.id ?? crypto.randomUUID();
  const docId = crypto.randomUUID();
  const assinaturaId = crypto.randomUUID();
  const agora = new Date();
  const ip = ipDoPedido(req);
  const aparelho = (req.headers.get('user-agent') ?? '').slice(0, 400) || null;
  const texto = textoAceiteAdmissao(nome, c.cpf, termos);

  let faceDistancia: string | null = null;
  const desc = descritorRosto(body.descriptor);
  const cadastrado = descritorRosto(existente?.faceDescriptor);
  if (desc && cadastrado) faceDistancia = distanciaFacial(desc, cadastrado).toFixed(4);

  const html = contratoHtml({
    nome,
    cpf: c.cpf,
    pessoais: p,
    termos,
    empregador: await empregadorDoCnpj(termos.empregadorCnpj),
    assinatura: { em: agora, ip, aparelho, textoAceite: texto, rubricaPng: rubrica, selfie, conviteId: c.id },
  });
  const htmlBuf = Buffer.from(html, 'utf8');
  const hash = crypto.createHash('sha256').update(htmlBuf).digest('hex');

  // Arquivos primeiro (sem eles não há prova); o banco vem numa transação só.
  const admin = await createAdminClient();
  const bucket = admin.storage.from(BUCKET_DOC_RH);
  const contratoPath = `${pastaDocRh(c.filialId)}/${funcionarioId}/${docId}-contrato.html`;
  const selfiePath = caminhoSelfieAssinatura(c.filialId, funcionarioId, assinaturaId);
  const rubricaPath = caminhoRubricaAssinatura(c.filialId, funcionarioId, assinaturaId);
  const ups = await Promise.all([
    bucket.upload(contratoPath, htmlBuf, { contentType: 'text/html; charset=utf-8', upsert: true }),
    bucket.upload(selfiePath, selfie.buf, { contentType: selfie.mime, upsert: true }),
    bucket.upload(rubricaPath, rubrica, { contentType: 'image/png', upsert: true }),
  ]);
  if (ups.some((u) => u.error)) return erro('Não consegui guardar a assinatura. Tente de novo.', 500);

  const endereco = [p.logradouro, p.numero, p.complemento, p.bairro, `${p.municipio || 'Aracaju'}/${p.uf || 'SE'}`, p.cep ? `CEP ${p.cep}` : '']
    .filter((x) => x && String(x).trim())
    .join(', ');
  const emp = EMPREGADORES.find((e) => e.cnpj === termos.empregadorCnpj);
  const ymdHoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Maceio' }).format(agora);
  const dadosRegistro = {
    ...((existente?.dadosRegistro as Record<string, unknown> | null) ?? {}),
    pessoais: p,
    contrato: termosParaContrato(termos, p, ymdHoje),
    conviteId: c.id,
    atualizadoEm: agora.toISOString(),
  };
  const pessoaisFicha = {
    nome,
    telefone: c.telefone,
    dataNascimento: p.nascimento || null,
    sexo: p.sexo || null,
    endereco: endereco || null,
    dadosRegistro,
    atualizadoEm: agora,
  };
  const contratoFicha = {
    cargo: termos.cargo.slice(0, 60),
    cargoRegistro: termos.cargo.slice(0, 80),
    cbo: termos.cbo || null,
    setor: termos.setor || null,
    regimeSalarial: regimeDoModelo(termos.modelo),
    salarioBase: numero(termos.valor).toFixed(2),
    empresaRegistro: emp?.empresaRegistro ?? null,
    cnpjRegistro: termos.empregadorCnpj,
    dataAdmissao: termos.admissao,
  };

  try {
    await db.transaction(async (tx) => {
      if (!existente) {
        await tx.insert(F).values({ id: funcionarioId, filialId: c.filialId, cpf: c.cpf, ativo: true, ...pessoaisFicha, ...contratoFicha });
      } else if (lotacaoExtra) {
        // Ativa noutra casa: não mexe na lotação nem no contrato de lá.
        await tx.update(F).set(pessoaisFicha).where(eq(F.id, funcionarioId));
        await tx
          .insert(schema.funcionarioFilialExtra)
          .values({ funcionarioId, filialId: c.filialId })
          .onConflictDoNothing();
        await garantirVinculoFolhaNasFiliais(tx, funcionarioId, [c.filialId]);
      } else {
        await tx
          .update(F)
          .set({ ...pessoaisFicha, ...contratoFicha, filialId: c.filialId, ativo: true, dataDesligamento: null, motivoDesligamento: null })
          .where(eq(F.id, funcionarioId));
      }

      await tx.insert(schema.funcionarioDocumento).values({
        id: docId,
        funcionarioId,
        filialId: c.filialId,
        momento: 'admissao',
        tipo: 'contrato_trabalho',
        descricao: `${tituloContrato(termos.modelo)} — assinado pelo link do WhatsApp`,
        arquivoPath: contratoPath,
        arquivoNome: `contrato-${soDig(c.cpf)}.html`,
        usuarioId: c.criadoPor,
        dados: { origem: 'sistema', conviteId: c.id, hash },
      });
      for (const d of docs) {
        const tipo = DOCS_PEDIDOS.find((x) => x.chave === d.chave);
        await tx.insert(schema.funcionarioDocumento).values({
          funcionarioId,
          filialId: c.filialId,
          momento: 'admissao',
          tipo: tipo?.tipoFicha ?? 'outro_admissao',
          descricao: `${tipo?.rotulo ?? 'Documento'} (enviado pela pessoa no link)`,
          arquivoPath: d.path,
          arquivoNome: d.nome.slice(0, 200),
          usuarioId: c.criadoPor,
          dados: { origem: 'admissao_link', conviteId: c.id, chave: d.chave },
        });
      }
      await tx.insert(schema.funcionarioAssinatura).values({
        id: assinaturaId,
        funcionarioId,
        filialId: c.filialId,
        documentoId: docId,
        token: novoTokenAssinatura(),
        status: 'assinado',
        hashDocumento: hash,
        hashNoAceite: hash,
        enviadoPor: c.criadoPor,
        enviadoEm: c.criadoEm,
        expiraEm: c.expiraEm,
        abertoEm: c.abertoEm ?? agora,
        assinadoEm: agora,
        assinadoIp: ip,
        assinadoAparelho: aparelho,
        cpfInformado: c.cpf,
        selfiePath,
        faceDistancia,
        textoAceite: texto,
      });
      // Escala escolhida pelo RH no convite (não mexe em quem já está ativo em outra casa).
      if (termos.jornadaId && !lotacaoExtra) {
        await tx
          .insert(schema.funcionarioJornada)
          .values({ funcionarioId, jornadaId: termos.jornadaId, vigenteDesde: termos.admissao, usuarioId: c.criadoPor })
          .onConflictDoUpdate({
            target: [schema.funcionarioJornada.funcionarioId, schema.funcionarioJornada.vigenteDesde],
            set: { jornadaId: termos.jornadaId },
          });
      }
      if (p.valeTransporte === 'nao_quer') {
        await tx
          .insert(schema.vtPessoa)
          .values({ funcionarioId, ativo: false, valorDia: '0' })
          .onConflictDoUpdate({ target: schema.vtPessoa.funcionarioId, set: { ativo: false, atualizadoEm: agora } });
      }
      const C = schema.admissaoConvite;
      const feito = await tx
        .update(C)
        .set({
          status: 'assinado',
          funcionarioId,
          pessoais: p,
          assinadoEm: agora,
          assinadoIp: ip,
          assinadoAparelho: aparelho,
          selfiePath,
          rubricaPath,
          faceDistancia,
          textoAceite: texto,
          hashContrato: hash,
          documentoContratoId: docId,
          assinaturaId,
        })
        .where(and(eq(C.id, c.id), inArray(C.status, ['enviado', 'aberto'])))
        .returning({ id: C.id });
      if (!feito.length) throw new Error('JA_ASSINADO');
    });
  } catch (e) {
    if ((e as Error).message === 'JA_ASSINADO') return erro('Este contrato já foi assinado. Obrigado!', 409);
    if (((e as Error).message ?? '').includes('uq_funcionario_cpf')) return erro('Seu CPF já tem cadastro. Fale com o RH.', 409);
    throw e;
  }

  // Fornecedor (pra pagar) + cliente na loja; falha aqui não desfaz a assinatura.
  let fornecedorPrincipal: string | null = null;
  try {
    const papeis = await garantirPapeisDaPessoa(funcionarioId, { criadoPor: c.criadoPor ?? undefined, enfileirarNaLoja: true });
    fornecedorPrincipal = papeis?.fornecedorId ?? null;
  } catch {
    /* o RH garante de novo ao definir o pagamento */
  }

  // As contas que ela digitou no link vão pro cadastro (dono 06/11/2026: "a conta
  // do Inter, para receber a folha, e a conta da Caixa para receber os 10%").
  try {
    await gravarContasDoLink(c.cpf, nome, p, termos.empregadorCnpj, fornecedorPrincipal);
  } catch {
    /* o RH digita em RH → Funcionários */
  }

  // Já trabalha antes do registro: até a véspera recebe por diária na folha
  // semanal; do registro em diante é funcionário (mesmo "Diarista até" da ficha).
  if (termos.diariaAntes) {
    try {
      const papeis = await garantirPapeisDaPessoa(funcionarioId, { criadoPor: c.criadoPor ?? undefined, filialId: c.filialId });
      if (papeis) {
        const FF = schema.fornecedorFolha;
        const ate = vesperaDoRegistro(termos.admissao);
        await db
          .insert(FF)
          .values({ fornecedorId: papeis.fornecedorId, papel: 'funcionario', diaristaAte: ate })
          .onConflictDoUpdate({
            target: FF.fornecedorId,
            set: {
              diaristaAte: ate,
              papel: sql`case when ${FF.papel} = 'diarista' then 'funcionario' else ${FF.papel} end`,
              ativo: true,
              atualizadoEm: new Date(),
            },
          });
      }
    } catch {
      /* o RH ajusta em RH → Funcionários (Diarista até) */
    }
  }

  return NextResponse.json({ ok: true, assinadoEm: agora.toISOString() });
}

/**
 * Contas do link → cadastro de pagamento. Só preenche o que está VAZIO (conta
 * que o RH já digitou fica como está):
 *  - Pix e Caixa (10%) no fornecedor da pessoa — o da lotação e os das outras
 *    casas onde ela já está na folha (mesmo CPF);
 *  - Inter (folha) em conta_inter_folha pelo CPF, que é de onde o arquivo do
 *    Inter lê. E.B. sempre (é quem paga hoje); Prainha também se é ela quem registra.
 */
async function gravarContasDoLink(
  cpf: string,
  nome: string,
  p: PessoaisAdmissao,
  empregadorCnpj: string,
  fornecedorPrincipal: string | null,
) {
  const cpfDig = soDig(cpf);
  if (cpfDig.length !== 11) return;
  const Fo = schema.fornecedor;
  const daPessoa = and(
    sql`${Fo.dataDelete} is null`,
    sql`regexp_replace(coalesce(${Fo.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${cpfDig}`,
    fornecedorPrincipal
      ? sql`(${Fo.id} = ${fornecedorPrincipal} or exists (select 1 from fornecedor_folha ff where ff.fornecedor_id = ${Fo.id}))`
      : sql`exists (select 1 from fornecedor_folha ff where ff.fornecedor_id = ${Fo.id})`,
  );

  const pix = p.pixChave?.trim();
  if (pix) {
    await db
      .update(Fo)
      .set({ chavePix: pix.slice(0, 100) })
      .where(and(daPessoa, sql`nullif(trim(${Fo.chavePix}), '') is null`));
  }

  const caixa = contaCaixaDoLink(p);
  if (caixa) {
    await db
      .update(Fo)
      .set({ bancoNome: 'CAIXA', bancoAgencia: caixa.agencia.slice(0, 20), bancoConta: caixa.conta.slice(0, 30) })
      .where(and(daPessoa, sql`nullif(trim(${Fo.bancoConta}), '') is null`, sql`nullif(trim(${Fo.bancoAgencia}), '') is null`));
  }

  const inter = contaInterDoLink(p);
  if (inter) {
    const empresas: ('EB' | 'PRAINHA')[] = ['EB'];
    if (soDig(empregadorCnpj).startsWith('33159574')) empresas.push('PRAINHA');
    for (const empresa of empresas) {
      await db
        .insert(schema.contaInterFolha)
        .values({ empresa, cpf: cpfDig, nome: nome.toUpperCase().slice(0, 120), conta: inter, fonte: 'admissao' })
        .onConflictDoNothing();
    }
  }
}
