// POST /api/lelis/buscar-sefaz — puxa da SEFAZ as notas destinadas à Lelis (01/11/2026):
// fila DF-e (últimos 90 dias), ciência nos resumos, XML pela chave, CST/CFOP das
// notas antigas pelo XML e, no fim, atualiza a tela de preço/tributação.
import { NextResponse } from 'next/server';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { buscarXmlPorChave, consultarEProcessar, reprocessarTribPorChave } from '@/lib/nfe-distribuicao';
import { manifestarPendentes } from '@/lib/nfe-manifestar';
import { sincronizarProdutosDasNotas } from '@/lib/lelis/sincronizar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const inicio = Date.now();
  const sobra = () => 50_000 - (Date.now() - inicio);
  const r = { lotes: 0, docs: 0, completas: 0, resumos: 0, upgrades: 0, ciencias: 0, xmlPorChave: 0, tribAtualizadas: 0, semXml: [] as { chave: string; motivo: string }[], bloqueio: null as string | null, aviso: null as string | null, produtos: 0 };
  try {
    for (let i = 0; i < 5 && sobra() > 20_000; i++) {
      const c = await consultarEProcessar({ filialId: a.filialId, uf: 'SE' });
      r.lotes++;
      r.docs += c.docsRecebidos;
      r.completas += c.nfesCompletasInseridas;
      r.resumos += c.nfesResumoInseridas;
      r.upgrades += c.nfesUpgradeResumoParaCompleta;
      if (c.cStat === '656') { r.bloqueio = `${c.cStat} ${c.xMotivo}`; break; }
      if (!c.temMais || c.cStat !== '138') break;
    }
    if (sobra() > 15_000) {
      const m = await manifestarPendentes({ filialId: a.filialId, limite: 50 });
      r.ciencias = m.chavesManifestadas.length;
    }
    if (!r.bloqueio && sobra() > 12_000) {
      const b = await buscarXmlPorChave({ filialId: a.filialId, limite: 8 });
      r.xmlPorChave = b.completas.length;
      r.semXml.push(...b.semXml);
      r.bloqueio = b.bloqueio;
    }
    if (!r.bloqueio && sobra() > 10_000) {
      const t = await reprocessarTribPorChave({ filialId: a.filialId, limite: 6 });
      r.tribAtualizadas = t.atualizadas.length;
      r.semXml.push(...t.semXml);
      r.bloqueio = t.bloqueio;
    }
  } catch (e) {
    r.aviso = (e as Error).message.slice(0, 300);
  }
  const s = await sincronizarProdutosDasNotas(a.filialId, a.email);
  r.produtos = s.produtos;
  return NextResponse.json({ ok: !r.aviso, ...r });
}
