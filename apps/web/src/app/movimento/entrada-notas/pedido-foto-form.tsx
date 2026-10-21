'use client';

// Pedido SEM NOTA: fotografa (ou anexa) o pedido/romaneio do fornecedor. A IA
// lê, grava como entrada e — se reconheceu fornecedor, todos os insumos e a
// soma bate — já lança no estoque e no contas a pagar. Se ficou dúvida, abre a
// tela da entrada pra conferir e confirmar na mão (mesma tela da NF-e).

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Filial {
  id: string;
  nome: string;
}

interface Resultado {
  arquivo: string;
  ok: boolean;
  titulo: string;
  detalhes: string[];
  notaId?: string;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Reduz a foto pra caber no limite de envio (lado maior 2200px, JPEG). */
async function reduzirFoto(file: File, lado = 2200, qualidade = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    if (escala === 1 && file.size < 1_500_000 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', qualidade));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // navegador não abriu a imagem — o servidor diz se o tipo serve
  }
}

export function PedidoFotoForm({ filialId, filiais }: { filialId: string; filiais: Filial[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const paginaScanRef = useRef<HTMLInputElement>(null);
  const paginaArqRef = useRef<HTMLInputElement>(null);
  // Um pedido em várias fotos (hortifruti que entrega em 3 notinhas)
  const [paginas, setPaginas] = useState<File[]>([]);
  const [selecionada, setSelecionada] = useState(filialId);
  const [lancarDireto, setLancarDireto] = useState(true);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function enviarUm(f: File): Promise<Resultado> {
    return enviar([f]);
  }

  /** Uma foto = um pedido (como sempre); várias = UM pedido com os itens de todas. */
  async function enviar(fs: File[]): Promise<Resultado> {
    const f = fs.length === 1 ? fs[0]! : new File([], fs.map((x) => x.name).join(' + '));
    let fotos: File[];
    if (fs.length === 1) {
      fotos = [await reduzirFoto(fs[0]!)];
    } else {
      // Várias fotos têm que caber juntas nos 4 MB: reduz mais e, se ainda passar, mais um pouco.
      fotos = await Promise.all(fs.map((x) => reduzirFoto(x, 1800, 0.8)));
      if (fotos.reduce((s, x) => s + x.size, 0) > 3_800_000) {
        fotos = await Promise.all(fs.map((x) => reduzirFoto(x, 1400, 0.7)));
      }
    }
    const form = new FormData();
    form.set('filialId', selecionada);
    for (const foto of fotos) form.append('arquivo', foto);
    const r = await fetch('/api/notas/pedido-foto', { method: 'POST', body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        arquivo: f.name,
        ok: false,
        titulo: r.status === 413 ? 'arquivo grande demais (máx. 4 MB)' : (d.error ?? `HTTP ${r.status}`),
        detalhes: [],
      };
    }
    if (d.duplicada && d.servico) {
      // Mesmo serviço (prestador + número, ou valor + data) já estava lançado.
      return {
        arquivo: f.name,
        ok: true,
        titulo: `Este serviço já tinha sido lançado${d.lancadoEm ? ` em ${d.lancadoEm}` : ''}${d.emitNome ? ` — ${d.emitNome}` : ''}`,
        detalhes: ['não foi criada outra conta a pagar — abra a nota pra conferir'],
        notaId: d.id,
      };
    }
    if (d.duplicada) {
      return { arquivo: f.name, ok: true, titulo: 'Este pedido já tinha sido enviado', detalhes: [], notaId: d.id };
    }
    if (d.danfe) {
      // É NF-e (DANFE): a nota de verdade já veio da SEFAZ — nada de pedido sem nota.
      const dt = (s: string) => s.split('-').reverse().join('/');
      const det: string[] = [];
      if (d.jaLancada) det.push('essa NF-e já foi lançada no estoque/contas a pagar — não lance de novo');
      else if (d.resumo) det.push('a SEFAZ só mandou o resumo até agora — os itens chegam sozinhos; abra a nota depois pra lançar');
      else det.push('abra a nota e clique em "Lançar" pra dar entrada no estoque');
      const gravados = (d.vencimentosGravados ?? []) as Array<{ data: string; valor: number }>;
      const lidos = (d.vencimentosLidos ?? []) as Array<{ data: string; valor: number }>;
      if (gravados.length) {
        det.push(`vencimento do boleto gravado na nota: ${gravados.map((v) => `${dt(v.data)} — ${brl(v.valor)}`).join(', ')}`);
      } else if (lidos.length && !d.jaLancada) {
        det.push(`vencimento lido no papel: ${lidos.map((v) => `${dt(v.data)} — ${brl(v.valor)}`).join(', ')} — confira na conta a pagar`);
      }
      return {
        arquivo: f.name,
        ok: true,
        titulo: `É NF-e — abrindo a nota${d.numero ? ` nº ${d.numero}` : ''} de ${d.emitNome ?? 'fornecedor'} · ${brl(Number(d.valorTotal ?? 0))}`,
        detalhes: det,
        notaId: d.id,
      };
    }
    if (d.servico) {
      // Nota de serviço: não tem estoque — as parcelas já foram pro contas a pagar.
      const parcelas = (d.parcelas ?? []) as Array<{ data: string; valor: number }>;
      const det = parcelas.map(
        (p, i) => `parcela ${i + 1}/${parcelas.length}: ${p.data.split('-').reverse().join('/')} — ${brl(p.valor)}`,
      );
      det.push(`${d.contasCriadas} conta(s) a pagar criada(s), em aberto — dê baixa no que já foi pago (sinal)`);
      if (d.contasAproveitadas > 0) {
        det.push(`${d.contasAproveitadas} conta(s) a pagar já existia(m) com esse valor — não foi criada outra`);
      }
      if (d.semPrazo) det.push('a nota não traz parcelas que fechem com o total — ficou uma conta só; ajuste no financeiro');
      if (d.fornecedorNovo) det.push(`${d.emitNome ?? 'prestador'} não estava no cadastro desta casa — cadastrado agora`);
      if (d.categoriaNome) det.push(`categoria: ${d.categoriaNome}`);
      if (d.chavePix) det.push(`chave Pix do recibo: ${d.chavePix} (guardada no fornecedor e na conta)`);
      if (!d.categoriaId) det.push('conta a pagar ficou sem categoria (fornecedor ainda não tem histórico)');
      det.push('serviço não tem produto pra vincular — não mexe no estoque');
      return {
        arquivo: f.name,
        ok: true,
        titulo: `Nota de serviço lançada no contas a pagar — ${d.emitNome ?? 'fornecedor'} · ${brl(d.valorTotal)}`,
        detalhes: det,
        notaId: d.id,
      };
    }
    const cab = `${d.emitNome ?? 'fornecedor não identificado'} · ${brl(d.valorTotal)} · ${d.qtdItens} item(ns)`;
    if (!d.pronto || !lancarDireto) {
      return {
        arquivo: f.name,
        ok: true,
        titulo: d.pronto ? `Lido, aguardando você confirmar — ${cab}` : `Lido, precisa conferir — ${cab}`,
        detalhes: d.pendencias ?? [],
        notaId: d.id,
      };
    }
    // Tudo reconhecido: estoque + contas a pagar pela rota de sempre.
    const l = await fetch(`/api/nota-compra/${d.id}/lancar-estoque`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoriaId: d.categoriaId ?? null }),
    });
    const ld = await l.json().catch(() => ({}));
    if (!l.ok) {
      return {
        arquivo: f.name,
        ok: false,
        titulo: `Lido, mas o lançamento falhou — ${cab}`,
        detalhes: [ld.error ?? `HTTP ${l.status}`],
        notaId: d.id,
      };
    }
    const det = [`${ld.lancados} insumo(s) no estoque`, `${ld.contasPagarCriadas} conta(s) a pagar`];
    if (ld.contasPagarAproveitadas > 0) {
      det.push(`${ld.contasPagarAproveitadas} conta(s) a pagar já existia(m) com esse valor — não foi criada outra`);
    }
    if (ld.pulados > 0) det.push(`${ld.pulados} item(ns) não entraram — abra pra ver`);
    if (!d.categoriaId) det.push('conta a pagar ficou sem categoria (fornecedor ainda não tem histórico)');
    return { arquivo: f.name, ok: true, titulo: `Lançado — ${cab}`, detalhes: det, notaId: d.id };
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const res: Resultado[] = [];
    for (let i = 0; i < files.length; i++) {
      setAndamento(`Lendo pedido ${i + 1} de ${files.length}… (leva até 1 minuto)`);
      try {
        res.push(await enviarUm(files[i]));
      } catch (err) {
        res.push({ arquivo: files[i].name, ok: false, titulo: (err as Error).message, detalhes: [] });
      }
      setResultados([...res]);
    }
    setAndamento(null);
    if (inputRef.current) inputRef.current.value = '';
    if (scanRef.current) scanRef.current.value = '';
    router.refresh();
  }

  async function enviarPaginas() {
    if (!paginas.length) return;
    setAndamento(`Lendo as ${paginas.length} fotos como um pedido só… (leva até 2 minutos)`);
    let r: Resultado;
    try {
      r = await enviar(paginas);
    } catch (err) {
      r = { arquivo: paginas.map((x) => x.name).join(' + '), ok: false, titulo: (err as Error).message, detalhes: [] };
    }
    setResultados((ant) => [...ant, r]);
    if (r.ok) setPaginas([]);
    setAndamento(null);
    router.refresh();
  }

  function addPaginas(e: React.ChangeEvent<HTMLInputElement>) {
    const novos = Array.from(e.target.files ?? []);
    if (novos.length) setPaginas((ant) => [...ant, ...novos]);
    if (paginaScanRef.current) paginaScanRef.current.value = '';
    if (paginaArqRef.current) paginaArqRef.current.value = '';
  }

  const enviando = andamento !== null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">📸 Pedido sem nota</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Fotografe o pedido ou romaneio do fornecedor. O sistema lê os itens e os valores, dá entrada dos insumos no
        estoque e cria a conta a pagar.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        🛠 <strong>Serviço também entra aqui</strong> — recibo ou nota de aluguel de espaço, locação de andaime ou
        equipamento, conserto e manutenção (computador, ar, freezer), mão de obra, frete. Não tem produto pra vincular:
        vira direto conta a pagar, com a chave Pix do recibo e o prestador cadastrado se ainda não existir.
      </p>

      <div className="mt-4 space-y-3">
        {filiais.length > 1 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Filial</label>
            <select
              value={selecionada}
              onChange={(e) => setSelecionada(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={enviando}
            >
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Escanear: no celular/tablet abre a câmera traseira direto, sem passar pela galeria */}
        <label className="block">
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={enviando}
            onChange={onChange}
            className="hidden"
          />
          <div
            className={`cursor-pointer rounded-lg px-4 py-4 text-center text-sm font-semibold ${
              enviando ? 'bg-slate-200 text-slate-500' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {andamento ?? '📷 Escanear pedido agora'}
          </div>
        </label>

        <label className="block">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={enviando}
            onChange={onChange}
            className="hidden"
          />
          <div
            className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-3 text-center text-xs ${
              enviando
                ? 'border-slate-200 bg-slate-50 text-slate-400'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            {enviando ? 'aguarde…' : 'ou escolher arquivo já escaneado (foto ou PDF)'}
          </div>
        </label>

        {/* Um pedido que veio em vários papéis: junta as fotos e manda como UMA entrada */}
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
          <div className="text-xs font-semibold text-sky-900">📑 Um pedido em várias notas/fotos</div>
          <p className="mt-0.5 text-[11px] text-sky-800">
            Quando o fornecedor entrega uma compra em mais de um papel (ex.: hortifruti com 3 notinhas): fotografe um
            por um e envie tudo junto — vira UMA entrada com os itens de todos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="cursor-pointer">
              <input
                ref={paginaScanRef}
                type="file"
                accept="image/*"
                capture="environment"
                disabled={enviando}
                onChange={addPaginas}
                className="hidden"
              />
              <span className="inline-block rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">
                📷 {paginas.length ? 'Fotografar mais uma' : 'Fotografar a 1ª'}
              </span>
            </label>
            <label className="cursor-pointer">
              <input
                ref={paginaArqRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                disabled={enviando}
                onChange={addPaginas}
                className="hidden"
              />
              <span className="inline-block rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs text-sky-800 hover:bg-sky-100">
                escolher arquivos
              </span>
            </label>
          </div>
          {paginas.length > 0 && (
            <>
              <ul className="mt-2 space-y-1">
                {paginas.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-[11px] text-sky-900">
                    <span className="truncate">
                      Foto {i + 1}: {p.name}
                    </span>
                    <button
                      type="button"
                      disabled={enviando}
                      onClick={() => setPaginas((ant) => ant.filter((_, j) => j !== i))}
                      className="shrink-0 text-rose-700 underline"
                    >
                      tirar
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={enviando}
                onClick={enviarPaginas}
                className={`mt-2 w-full rounded-md px-3 py-2 text-xs font-semibold ${
                  enviando ? 'bg-slate-200 text-slate-500' : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {enviando
                  ? 'aguarde…'
                  : paginas.length === 1
                    ? 'Enviar esta foto'
                    : `Enviar as ${paginas.length} fotos como um pedido só`}
              </button>
            </>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={lancarDireto}
            onChange={(e) => setLancarDireto(e.target.checked)}
            disabled={enviando}
            className="mt-0.5"
          />
          <span>
            Lançar direto quando reconhecer tudo (fornecedor, todos os insumos e a soma batendo). Se ficar dúvida, o
            pedido fica aguardando conferência.
          </span>
        </label>

        {resultados.length > 0 && (
          <ul className="space-y-2">
            {resultados.map((r, i) => (
              <li
                key={i}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  !r.ok
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : r.titulo.startsWith('Lançado')
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="font-medium">{r.titulo}</div>
                <div className="truncate text-[10px] opacity-70">{r.arquivo}</div>
                {r.detalhes.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {r.detalhes.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
                {r.notaId && (
                  <Link href={`/movimento/entrada-notas/${r.notaId}`} className="mt-1 inline-block underline">
                    {r.titulo.startsWith('Lançado') ? 'abrir a entrada' : 'abrir pra conferir'}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
