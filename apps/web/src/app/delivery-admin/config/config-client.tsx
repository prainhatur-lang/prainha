'use client';

// Editor da configuração do delivery. Salva o jsonb inteiro de uma vez
// (PUT /api/delivery-admin/config), que sanitiza campo a campo no servidor.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DeliveryConfig, DeliveryFaixa } from '@concilia/db/schema';

interface Props {
  filialId: string;
  filialNome: string;
  filiais: Array<{ id: string; nome: string }>;
  configInicial: DeliveryConfig | null;
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:py-2 sm:text-sm';
const lblCls = 'text-xs font-medium text-slate-600';
const cardCls = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';

/** '' vira null (campo desligado); número inválido também. */
function numOuNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ConfigDeliveryClient({ filialId, filialNome, filiais, configInicial }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const c = configInicial ?? {};

  const [ativo, setAtivo] = useState(c.ativo === true);
  const [pausado, setPausado] = useState(c.pausado === true);
  const [slug, setSlug] = useState(c.slug ?? '');
  const [titulo, setTitulo] = useState(c.titulo ?? '');
  const [subtitulo, setSubtitulo] = useState(c.subtitulo ?? '');
  const [avisoTopo, setAvisoTopo] = useState(c.avisoTopo ?? '');
  const [whatsapp, setWhatsapp] = useState(c.whatsapp ?? '');

  const [cep, setCep] = useState(c.endereco?.cep ?? '');
  const [rua, setRua] = useState(c.endereco?.rua ?? '');
  const [numeroEnd, setNumeroEnd] = useState(c.endereco?.numero ?? '');
  const [bairro, setBairro] = useState(c.endereco?.bairro ?? '');
  const [cidade, setCidade] = useState(c.endereco?.cidade ?? 'Aracaju');
  const [uf, setUf] = useState(c.endereco?.uf ?? 'SE');
  const [lat, setLat] = useState(c.endereco?.lat != null ? String(c.endereco.lat) : '');
  const [lng, setLng] = useState(c.endereco?.lng != null ? String(c.endereco.lng) : '');

  const [entregaAtiva, setEntregaAtiva] = useState(c.entregaAtiva !== false);
  const [retiradaAtiva, setRetiradaAtiva] = useState(c.retiradaAtiva !== false);
  const [pedidoMinimo, setPedidoMinimo] = useState(
    c.pedidoMinimo != null ? String(c.pedidoMinimo) : '',
  );
  const [faixas, setFaixas] = useState<DeliveryFaixa[]>(
    c.faixasEntrega?.length ? c.faixasEntrega : [{ ateKm: 3, taxa: 8 }],
  );
  const [gratisAteKm, setGratisAteKm] = useState(
    c.gratisAteKm != null ? String(c.gratisAteKm) : '',
  );
  const [gratisAcimaDe, setGratisAcimaDe] = useState(
    c.gratisAcimaDe != null ? String(c.gratisAcimaDe) : '',
  );
  const [gratisPrimeiraCompra, setGratisPrimeiraCompra] = useState(
    c.gratisPrimeiraCompra === true,
  );

  const [horarios, setHorarios] = useState<Record<number, Array<{ abre: string; fecha: string }>>>(
    c.horarios ?? {},
  );
  const [slotMinutos, setSlotMinutos] = useState(String(c.slotMinutos ?? 30));
  const [antecedencia, setAntecedencia] = useState(String(c.antecedenciaMinutos ?? 45));
  const [diasFuturos, setDiasFuturos] = useState(String(c.diasFuturos ?? 7));
  const [diasFechados, setDiasFechados] = useState<string[]>(c.diasFechados ?? []);
  const [novoDiaFechado, setNovoDiaFechado] = useState('');
  const [preparoMin, setPreparoMin] = useState(
    c.tempoPreparoMin != null ? String(c.tempoPreparoMin) : '40',
  );
  const [preparoMax, setPreparoMax] = useState(
    c.tempoPreparoMax != null ? String(c.tempoPreparoMax) : '60',
  );
  const [pixAtivo, setPixAtivo] = useState(c.pixAtivo !== false);
  const [cartaoAtivo, setCartaoAtivo] = useState(c.cartaoAtivo !== false);
  const [naEntregaAtivo, setNaEntregaAtivo] = useState(c.naEntregaAtivo === true);

  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function setJanela(dia: number, idx: number, campo: 'abre' | 'fecha', valor: string) {
    setHorarios((prev) => {
      const lista = [...(prev[dia] ?? [])];
      lista[idx] = { ...lista[idx], [campo]: valor };
      return { ...prev, [dia]: lista };
    });
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setMsg(null);
    try {
      const r = await fetch('/api/delivery-admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          ativo,
          pausado,
          slug,
          titulo,
          subtitulo,
          avisoTopo,
          whatsapp,
          endereco: {
            cep,
            rua,
            numero: numeroEnd,
            bairro,
            cidade,
            uf,
            lat: lat ? Number(lat.replace(',', '.')) : undefined,
            lng: lng ? Number(lng.replace(',', '.')) : undefined,
          },
          entregaAtiva,
          retiradaAtiva,
          pedidoMinimo: numOuNull(pedidoMinimo),
          faixasEntrega: faixas,
          gratisAteKm: numOuNull(gratisAteKm),
          gratisAcimaDe: numOuNull(gratisAcimaDe),
          gratisPrimeiraCompra,
          horarios,
          slotMinutos: Number(slotMinutos) || 30,
          antecedenciaMinutos: Number(antecedencia) || 45,
          diasFuturos: Number(diasFuturos) || 7,
          diasFechados,
          tempoPreparoMin: numOuNull(preparoMin),
          tempoPreparoMax: numOuNull(preparoMax),
          pixAtivo,
          cartaoAtivo,
          naEntregaAtivo,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      const coord = d.config?.endereco;
      setMsg(
        coord?.lat
          ? `Configuração salva. Loja localizada em ${Number(coord.lat).toFixed(4)}, ${Number(coord.lng).toFixed(4)} — a distância do cliente é medida a partir daí.`
          : 'Configuração salva. Atenção: não consegui localizar o endereço da loja no mapa — sem coordenada, todo pedido paga a taxa da última faixa. Preencha lat/lng manualmente.',
      );
      if (coord?.lat) {
        setLat(String(coord.lat));
        setLng(String(coord.lng));
      }
      start(() => router.refresh());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-6 pb-24 sm:px-6">
      <div>
        <Link href="/delivery-admin" className="text-sm text-sky-700">
          ◂ Pedidos
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Configuração do delivery</h1>
        <p className="text-sm text-slate-500">{filialNome}</p>
      </div>

      {filiais.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {filiais.map((f) => (
            <Link
              key={f.id}
              href={`/delivery-admin/config?filialId=${f.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                f.id === filialId
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.nome}
            </Link>
          ))}
        </div>
      ) : null}

      {msg ? (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{msg}</p>
      ) : null}
      {erro ? (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>
      ) : null}

      <div className="mt-4 space-y-4">
        {/* status */}
        <div className={cardCls}>
          <h2 className="text-sm font-semibold text-slate-900">Status</h2>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-4 w-4"
            />
            Delivery ligado no site
          </label>
          <label className="mt-1.5 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={pausado}
              onChange={(e) => setPausado(e.target.checked)}
              className="h-4 w-4"
            />
            Pausado agora (loja aparece, mas não aceita pedido)
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lblCls}>Endereço da loja no site (slug)</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="prainha"
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Fica em app.prainhabar.com/delivery/{slug || '...'}
              </p>
            </div>
            <div>
              <label className={lblCls}>WhatsApp de contato (só números, com DDD)</label>
              <input
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))}
                placeholder="5579996007289"
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lblCls}>Título</label>
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={lblCls}>Subtítulo</label>
              <input
                value={subtitulo}
                onChange={(e) => setSubtitulo(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className={lblCls}>Aviso no topo do cardápio (opcional)</label>
            <input
              value={avisoTopo}
              onChange={(e) => setAvisoTopo(e.target.value)}
              placeholder="Ex: hoje o camarão está saindo em 1h"
              className={inputCls}
            />
          </div>
        </div>

        {/* endereço */}
        <div className={cardCls}>
          <h2 className="text-sm font-semibold text-slate-900">Endereço da loja</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            É daqui que a distância até o cliente é medida (linha reta).
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={lblCls}>CEP</label>
              <input value={cep} onChange={(e) => setCep(e.target.value)} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={lblCls}>Rua</label>
              <input value={rua} onChange={(e) => setRua(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={lblCls}>Número</label>
              <input
                value={numeroEnd}
                onChange={(e) => setNumeroEnd(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Bairro</label>
              <input value={bairro} onChange={(e) => setBairro(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lblCls}>Cidade</label>
                <input
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={lblCls}>UF</label>
                <input
                  value={uf}
                  onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lblCls}>Latitude (opcional — sobrepõe o mapa)</label>
              <input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-11.0450"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Longitude</label>
              <input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-37.1200"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* entrega */}
        <div className={cardCls}>
          <h2 className="text-sm font-semibold text-slate-900">Entrega e retirada</h2>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={entregaAtiva}
                onChange={(e) => setEntregaAtiva(e.target.checked)}
                className="h-4 w-4"
              />
              Aceita entrega
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={retiradaAtiva}
                onChange={(e) => setRetiradaAtiva(e.target.checked)}
                className="h-4 w-4"
              />
              Aceita retirada no balcão
            </label>
          </div>

          <div className="mt-3">
            <label className={lblCls}>Faixas de taxa por distância</label>
            <div className="mt-1 space-y-2">
              {faixas.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">até</span>
                  <input
                    value={String(f.ateKm)}
                    onChange={(e) =>
                      setFaixas((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, ateKm: Number(e.target.value.replace(',', '.')) || 0 } : x,
                        ),
                      )
                    }
                    inputMode="decimal"
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <span className="text-xs text-slate-500">km · R$</span>
                  <input
                    value={String(f.taxa)}
                    onChange={(e) =>
                      setFaixas((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, taxa: Number(e.target.value.replace(',', '.')) || 0 } : x,
                        ),
                      )
                    }
                    inputMode="decimal"
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => setFaixas((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-xs text-rose-600"
                  >
                    remover
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setFaixas((prev) => [
                  ...prev,
                  { ateKm: (prev[prev.length - 1]?.ateKm ?? 0) + 3, taxa: 0 },
                ])
              }
              className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              + Faixa
            </button>
            <p className="mt-1 text-[11px] text-slate-400">
              Endereço além da última faixa fica fora da área de entrega.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={lblCls}>Pedido mínimo (R$)</label>
              <input
                value={pedidoMinimo}
                onChange={(e) => setPedidoMinimo(e.target.value)}
                placeholder="sem mínimo"
                inputMode="decimal"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Entrega grátis até (km)</label>
              <input
                value={gratisAteKm}
                onChange={(e) => setGratisAteKm(e.target.value)}
                placeholder="desligado"
                inputMode="decimal"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Entrega grátis acima de (R$)</label>
              <input
                value={gratisAcimaDe}
                onChange={(e) => setGratisAcimaDe(e.target.value)}
                placeholder="desligado"
                inputMode="decimal"
                className={inputCls}
              />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={gratisPrimeiraCompra}
              onChange={(e) => setGratisPrimeiraCompra(e.target.checked)}
              className="h-4 w-4"
            />
            🎉 Entrega grátis na primeira compra do cliente
          </label>
        </div>

        {/* horários */}
        <div className={cardCls}>
          <h2 className="text-sm font-semibold text-slate-900">Horários de funcionamento</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Dia sem janela = fechado. O cliente escolhe dia e hora dentro dessas janelas.
          </p>
          <div className="mt-2 space-y-2">
            {DIAS.map((nome, dia) => {
              const janelas = horarios[dia] ?? [];
              return (
                <div key={dia} className="flex flex-wrap items-center gap-2">
                  <span className="w-20 text-xs font-medium text-slate-600">{nome}</span>
                  {janelas.length === 0 ? (
                    <span className="text-xs text-slate-400">fechado</span>
                  ) : (
                    janelas.map((j, idx) => (
                      <span key={idx} className="flex items-center gap-1">
                        <input
                          type="time"
                          value={j.abre}
                          onChange={(e) => setJanela(dia, idx, 'abre', e.target.value)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                        <span className="text-xs text-slate-400">às</span>
                        <input
                          type="time"
                          value={j.fecha}
                          onChange={(e) => setJanela(dia, idx, 'fecha', e.target.value)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() =>
                            setHorarios((prev) => ({
                              ...prev,
                              [dia]: (prev[dia] ?? []).filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-xs text-rose-600"
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  )}
                  <button
                    onClick={() =>
                      setHorarios((prev) => ({
                        ...prev,
                        [dia]: [...(prev[dia] ?? []), { abre: '11:00', fecha: '17:00' }],
                      }))
                    }
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + janela
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={lblCls}>Intervalo entre horários (min)</label>
              <input
                value={slotMinutos}
                onChange={(e) => setSlotMinutos(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Antecedência mínima (min)</label>
              <input
                value={antecedencia}
                onChange={(e) => setAntecedencia(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Agenda aberta por (dias)</label>
              <input
                value={diasFuturos}
                onChange={(e) => setDiasFuturos(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className={inputCls}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className={lblCls}>Dias fechados (feriado, evento)</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {diasFechados.map((d) => (
                <span
                  key={d}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                >
                  {d.split('-').reverse().join('/')}
                  <button
                    onClick={() => setDiasFechados((prev) => prev.filter((x) => x !== d))}
                    className="text-rose-600"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                type="date"
                value={novoDiaFechado}
                onChange={(e) => setNovoDiaFechado(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                onClick={() => {
                  if (novoDiaFechado && !diasFechados.includes(novoDiaFechado)) {
                    setDiasFechados((prev) => [...prev, novoDiaFechado].sort());
                    setNovoDiaFechado('');
                  }
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                + fechar dia
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lblCls}>Preparo estimado — mínimo (min)</label>
              <input
                value={preparoMin}
                onChange={(e) => setPreparoMin(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className={inputCls}
              />
            </div>
            <div>
              <label className={lblCls}>Preparo estimado — máximo (min)</label>
              <input
                value={preparoMax}
                onChange={(e) => setPreparoMax(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* pagamento */}
        <div className={cardCls}>
          <h2 className="text-sm font-semibold text-slate-900">Pagamento</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Pré-pago online (Pix/cartão) e, se você ligar, pagamento na entrega: o entregador
            recebe na porta pela maquininha (cartão/Pix) ou em dinheiro, e a nota sai na hora.
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={pixAtivo}
                onChange={(e) => setPixAtivo(e.target.checked)}
                className="h-4 w-4"
              />
              Pix
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={cartaoAtivo}
                onChange={(e) => setCartaoAtivo(e.target.checked)}
                className="h-4 w-4"
              />
              Cartão (crédito/débito com 3DS)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={naEntregaAtivo}
                onChange={(e) => setNaEntregaAtivo(e.target.checked)}
                className="h-4 w-4"
              />
              Na entrega (maquininha do entregador ou dinheiro) — só pra entrega
            </label>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl justify-end gap-2 px-4">
          <button
            onClick={() => void salvar()}
            disabled={salvando}
            className="rounded-md bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar configuração'}
          </button>
        </div>
      </div>
    </section>
  );
}
