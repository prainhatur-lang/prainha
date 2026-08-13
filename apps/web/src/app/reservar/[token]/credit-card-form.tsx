'use client';

import { useEffect, useRef, useState } from 'react';

interface ThreeDSResult {
  Cavv: string;
  Eci: string;
  Xid?: string;
  Version?: string;
  ReferenceID?: string;
}

type BpmpiResult = {
  Cavv?: string; cavv?: string;
  Eci?: string; eci?: string;
  Xid?: string; xid?: string;
  Version?: string; version?: string;
  ReferenceId?: string; referenceId?: string;
};

declare global {
  interface Window {
    bpmpi_config?: () => unknown;
    bpmpi_authenticate?: () => void;
    bpmpi_load?: () => void;
    Bpmpi?: unknown;
  }
}

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function formatCPF(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function detectBrand(number: string): string {
  const n = number.replace(/\s/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'Master';
  if (/^636368|636369|438935|504175|451416|636297|5067|4576|4011|506699/.test(n)) return 'Elo';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^606282|3841/.test(n)) return 'Hipercard';
  return 'Visa';
}

interface Props {
  token: string;
  reservaId: string;
  totalCents: number;
  onPago: () => void;
  /** Onde postar o cartao. Default: a rota da reserva. A cobranca de MESA
   *  (cliente pagando a conta pelo QR) usa a mesma tela com outro endpoint. */
  endpointPagamento?: string;
  /** Onde buscar o token do MPI 3DS. Default: a rota da reserva. */
  endpointMpiToken?: string;
  /** Campos a mais no corpo do POST (ex.: os parametros assinados da mesa). */
  extraPayload?: Record<string, unknown>;
}

const inp =
  'mt-1.5 w-full rounded-xl border border-[#e2c9a0] bg-white px-3.5 py-2.5 text-sm text-[#1d130c] outline-none transition-colors placeholder:text-[#b7a888] focus:border-[#e7723a] focus:ring-2 focus:ring-[#e7723a]/20';
const lbl = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a7a64]';
const btn =
  'mt-5 w-full rounded-full bg-[#e7723a] px-4 py-3.5 text-sm font-semibold text-[#fbf6ec] shadow-[0_14px_30px_-12px_rgba(231,114,58,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#df5a35] disabled:translate-y-0 disabled:opacity-50';

export function CreditCardForm({
  token,
  reservaId,
  totalCents,
  onPago,
  endpointPagamento,
  endpointMpiToken,
  extraPayload,
}: Props) {
  const urlPagamento = endpointPagamento ?? `/api/reservar/${token}/pagamento-cartao`;
  const urlMpiToken = endpointMpiToken ?? `/api/reservar/${token}/mpi-token`;
  const [cardNumber, setCardNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cpf, setCpf] = useState('');
  // O 3DS 2.0 manda telefone e e-mail do titular na analise de risco do
  // emissor. Iam vazios, e o SDK devolvia onError sem autenticar nada.
  const [fone, setFone] = useState('');
  const [email, setEmail] = useState('');
  const [cardType, setCardType] = useState<'CreditCard' | 'DebitCard'>('CreditCard');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('SE');
  const [cep, setCep] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [authenticating3DS, setAuthenticating3DS] = useState(false);
  const [mpiReady, setMpiReady] = useState(false);
  const mpiConfigRef = useRef<{ accessToken: string } | null>(null);
  // O SDK lê o access token do DOM UMA única vez, no parse do script, e cada
  // sessão vale UM authenticate (token expira em ~20min). Estes refs decidem
  // quando remontar o SDK do zero.
  const sdkBornRef = useRef(0);
  const sdkUsadoRef = useRef(false);
  const threeDsResolverRef = useRef<((v: ThreeDSResult | null) => void) | null>(null);
  // Qual callback do SDK disparou. Sem isto, "cartão não participa do 3DS" e
  // "emissor negou" viram a mesma mensagem e não dá pra diagnosticar nada.
  const motivoRef = useRef<string | null>(null);
  const detalheRef = useRef<string | null>(null);

  const cleanNumber = cardNumber.replace(/\s/g, '');
  const brand = cleanNumber.length >= 4 ? detectBrand(cleanNumber) : '';

  /** Monta (ou REMONTA) o SDK da Braspag do zero. O script auto-executa
   *  bpmpi_load() no PARSE e lê o token do input `.bpmpi_accesstoken` uma
   *  única vez ali (removendo o nó); depois disso o bpmpi_load() público é
   *  no-op ("Resources already loaded"). Então: token fresco no input ANTES
   *  de injetar o script, e recarregar = trocar o <script> inteiro. Era isso
   *  que causava o 401/MPI900: o script entrava antes do input existir e a
   *  sessão ficava pra sempre com Bearer vazio. */
  async function montarSdk(): Promise<boolean> {
    try {
      const res = await fetch(urlMpiToken);
      if (!res.ok) return false;
      const data = await res.json();
      mpiConfigRef.current = { accessToken: data.accessToken };

      // Input imperativo, fora do JSX: o SDK REMOVE o nó no parse e o React
      // não pode dar diff num filho que sumiu por baixo dele.
      let input = document.querySelector<HTMLInputElement>('input.bpmpi_accesstoken');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.className = 'bpmpi_accesstoken';
        document.body.appendChild(input);
      }
      input.value = data.accessToken;

      document.querySelector('script[data-bpmpi]')?.remove();
      const ok = await new Promise<boolean>((resolve) => {
        const script = document.createElement('script');
        script.src = data.scriptUrl;
        script.async = true;
        script.dataset.bpmpi = 'true';
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      });
      if (!ok) return false;
      sdkBornRef.current = Date.now();
      sdkUsadoRef.current = false;
      return true;
    } catch {
      return false;
    }
  }

  // window.bpmpi_config PRECISA existir ANTES do script BP.Mpi carregar — o
  // SDK registra os callbacks de notificação no parse. Definir depois do
  // onload faz o pagamento travar em "Autenticando..." mesmo com o banco
  // aprovando.
  useEffect(() => {
    if (mpiReady) return;
    let cancelled = false;
    const resolverRef = threeDsResolverRef;

    window.bpmpi_config = function () {
      const cfg = mpiConfigRef.current;
      return {
        Environment: 'PRD',
        environment: 'PRD',
        AccessToken: cfg?.accessToken || '',
        accessToken: cfg?.accessToken || '',
        onSuccess: function (result: BpmpiResult) {
          resolverRef.current?.({
            Cavv: result?.Cavv || result?.cavv || '',
            Eci: result?.Eci || result?.eci || '',
            Xid: result?.Xid || result?.xid,
            Version: result?.Version || result?.version || '2',
            ReferenceID: result?.ReferenceId || result?.referenceId,
          });
          resolverRef.current = null;
        },
        onFailure: function () {
          motivoRef.current = 'failure'; // 3DS rodou e o emissor NEGOU
          resolverRef.current?.(null);
          resolverRef.current = null;
        },
        onUnenrolled: function (result: BpmpiResult) {
          // Cartão/emissor não participa do 3DS. É caso NORMAL: a regra permite
          // seguir com ECI 07 e a Cielo decide. Marcado pra não ser confundido
          // com uma negativa de verdade.
          motivoRef.current = 'unenrolled';
          resolverRef.current?.({
            Cavv: result?.Cavv || '',
            Eci: result?.Eci || '07',
            Xid: result?.Xid,
            Version: result?.Version || '2',
            ReferenceID: result?.ReferenceId,
          });
          resolverRef.current = null;
        },
        onDisabled: function () {
          motivoRef.current = 'disabled';
          resolverRef.current?.(null);
          resolverRef.current = null;
        },
        onError: function (err: unknown) {
          motivoRef.current = 'error';
          try {
            const e = err as Record<string, unknown> | undefined;
            detalheRef.current = String(
              (e?.ReturnMessage as string) || (e?.returnMessage as string) ||
              (e?.Message as string) || (e?.message as string) ||
              (e ? JSON.stringify(e) : ''),
            ).slice(0, 160);
          } catch { detalheRef.current = null; }
          console.error('[bpmpi] error', err);
          resolverRef.current?.(null);
          resolverRef.current = null;
        },
        onUnsupportedBrand: function () {
          motivoRef.current = 'unsupported_brand';
          resolverRef.current?.(null);
          resolverRef.current = null;
        },
      };
    };

    (async () => {
      const ok = await montarSdk();
      if (cancelled) return;
      if (ok) setMpiReady(true);
      else setError('Falha ao inicializar autenticação do cartão');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpiReady]);

  /** CEP completo preenche rua, bairro, cidade e UF. Digitar endereco inteiro
   *  no celular, na mesa, e' onde a pessoa desiste de pagar. Se o ViaCEP nao
   *  responder, os campos continuam editaveis — nunca trava o pagamento. */
  async function buscarCep(valor: string) {
    const d = valor.replace(/\D/g, '');
    if (d.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      if (!r.ok) return;
      const j = (await r.json()) as {
        logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean | string;
      };
      if (j.erro) return;
      if (j.logradouro) setStreet(j.logradouro);
      if (j.bairro) setNeighborhood(j.bairro);
      if (j.localidade) setCity(j.localidade);
      if (j.uf) setState(j.uf.toUpperCase().slice(0, 2));
    } catch {
      /* sem internet ou ViaCEP fora: segue com os campos em branco */
    } finally {
      setBuscandoCep(false);
    }
  }

  async function authenticate3DS(): Promise<ThreeDSResult | null> {
    if (typeof window === 'undefined') return null;

    // Sessão do MPI vale UM authenticate e o token expira em ~20min. Se já
    // gastou (retry) ou envelheceu (a pessoa demorou digitando), remonta o
    // SDK — bpmpi_load() de novo NÃO serve, é no-op depois do primeiro parse.
    const envelheceu = Date.now() - sdkBornRef.current > 15 * 60_000;
    if (sdkUsadoRef.current || envelheceu) {
      const ok = await montarSdk();
      if (!ok) {
        motivoRef.current = 'error';
        detalheRef.current = 'remontagem do SDK falhou';
        return null;
      }
      // o parse já disparou o /v2/3ds/init; respiro pro Cardinal se armar
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!window.bpmpi_authenticate) return null;
    sdkUsadoRef.current = true;

    return new Promise((resolve) => {
      threeDsResolverRef.current = resolve;
      try {
        window.bpmpi_authenticate!();
      } catch (err) {
        console.error('[bpmpi_authenticate]', err);
        resolve(null);
        threeDsResolverRef.current = null;
      }
      // Challenge do banco (SMS/app) facilmente leva 1-3min.
      setTimeout(() => {
        if (threeDsResolverRef.current === resolve) {
          threeDsResolverRef.current = null;
          resolve(null);
        }
      }, 300_000);
    });
  }

  async function handleSubmit() {
    setError(null);

    if (cleanNumber.length < 13) return setError('Número do cartão inválido.');
    if (!holder.trim()) return setError('Digite o nome impresso no cartão.');
    const expiryDigits = expiry.replace(/\D/g, '');
    if (expiryDigits.length !== 4) return setError('Validade inválida.');
    if (cvv.length < 3) return setError('Código de segurança inválido.');
    if (cpf.replace(/\D/g, '').length < 11) return setError('CPF inválido.');
    if (!street || !number || !neighborhood) return setError('Preencha o endereço de cobrança do cartão.');

    setProcessing(true);

    const month = expiryDigits.slice(0, 2);
    const year = `20${expiryDigits.slice(2)}`;

    if (!mpiReady) {
      setError('Carregando autenticação segura... aguarde alguns segundos e tente de novo.');
      setProcessing(false);
      return;
    }
    setAuthenticating3DS(true);
    const auth = await authenticate3DS();
    setAuthenticating3DS(false);
    // Só UM motivo significa "esse cartão não deve passar": 'failure', que é o
    // emissor tendo rodado o 3DS e NEGADO.
    //
    // Os demais são o autenticador indisponível, não um problema do cartão:
    //   unenrolled        cartão/emissor não participa do 3DS (caso normal)
    //   error             SDK da Braspag falhou (hoje: 401, produto não ativado)
    //   disabled          3DS desligado no merchant
    //   unsupported_brand bandeira fora do 3DS
    // Nesses, seguimos sem autenticação — e quem limita o risco é o TETO de
    // valor conferido no servidor. Barrar tudo aqui deixava a casa sem receber
    // por uma falha que não é do cliente.
    const semAutenticacao = !auth || !auth.Cavv;
    const motivo = motivoRef.current;
    const detalhe = detalheRef.current;
    motivoRef.current = null;
    detalheRef.current = null;
    if (semAutenticacao && motivo === 'failure') {
      setError('O banco não autorizou esse cartão. Tente outro cartão ou pague via Pix.');
      setProcessing(false);
      return;
    }
    if (semAutenticacao) {
      // segue, mas registra o porquê — o servidor ainda pode recusar pelo teto
      console.warn('[3ds] seguindo sem autenticação:', motivo, detalhe);
    }

    try {
      const r = await fetch(urlPagamento, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(extraPayload ?? {}),
          reservaId,
          cardNumber: cleanNumber,
          cardHolder: holder.trim().toUpperCase(),
          cardExpiration: `${month}/${year}`,
          cardCvv: cvv,
          brand,
          cpf,
          paymentType: cardType,
          billingAddress: { street, number, neighborhood, city, state, cep },
          threeDS: auth,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.pago) {
        setError(d.error ?? 'Pagamento recusado. Tente outro cartão ou pague via Pix.');
        setProcessing(false);
        return;
      }
      onPago();
    } catch (err) {
      setError((err as Error).message || 'Erro ao processar cartão.');
      setProcessing(false);
    }
  }

  const isProcessing = processing || authenticating3DS;

  const amountForMpi = String(totalCents);
  const orderIdForMpi = reservaId;
  const expDigitsForMpi = expiry.replace(/\D/g, '');
  const expMonthForMpi = expDigitsForMpi.length === 4 ? expDigitsForMpi.slice(0, 2) : '';
  const expYearForMpi = expDigitsForMpi.length === 4 ? `20${expDigitsForMpi.slice(2)}` : '';

  return (
    <div className="space-y-3.5 text-left">
      {error && (
        <div className="rounded-xl border border-[#e6a08a] bg-[#fdecec] px-3.5 py-2.5 text-xs text-[#b3411c]">
          {error}
        </div>
      )}

      {/* Inputs ocultos lidos pelo SDK Braspag MPI 3DS via document.querySelector
          — não vem do retorno de bpmpi_config, esses campos são obrigatórios aqui.
          O bpmpi_accesstoken NÃO está aqui de propósito: o SDK remove esse nó do
          DOM no parse, então ele é criado imperativamente em montarSdk(). */}
      {mpiReady && (
        <div style={{ display: 'none' }} aria-hidden="true">
          <input className="bpmpi_auth" value="true" readOnly />
          <input className="bpmpi_cardnumber" value={cleanNumber} readOnly />
          <input className="bpmpi_cardexpirationmonth" value={expMonthForMpi} readOnly />
          <input className="bpmpi_cardexpirationyear" value={expYearForMpi} readOnly />
          <input className="bpmpi_ordernumber" value={orderIdForMpi} readOnly />
          <input className="bpmpi_currency" value="BRL" readOnly />
          <input className="bpmpi_totalamount" value={amountForMpi} readOnly />
          <input className="bpmpi_installments" value="1" readOnly />
          <input className="bpmpi_paymentmethod" value={cardType === 'DebitCard' ? 'Debit' : 'Credit'} readOnly />
          <input className="bpmpi_orderdate" value={new Date().toISOString().slice(0, 10).replace(/-/g, '')} readOnly />
          <input className="bpmpi_order_productcode" value="PHY" readOnly />
          <input
            className="bpmpi_merchant_url"
            value={typeof window !== 'undefined' ? window.location.origin : 'https://app.prainhabar.com'}
            readOnly
          />
          <input className="bpmpi_billto_contactname" value={holder.trim().toUpperCase() || 'CLIENTE'} readOnly />
          <input className="bpmpi_billto_phonenumber" value={fone.replace(/\D/g, '')} readOnly />
          <input className="bpmpi_billto_email" value={email.trim()} readOnly />
          <input className="bpmpi_billto_street1" value={street} readOnly />
          <input className="bpmpi_billto_city" value={city} readOnly />
          <input className="bpmpi_billto_state" value={state} readOnly />
          <input className="bpmpi_billto_zipcode" value={cep.replace(/\D/g, '')} readOnly />
          <input className="bpmpi_billto_country" value="BR" readOnly />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCardType('CreditCard')}
          className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${cardType === 'CreditCard' ? 'border-[#e7723a] bg-[#f6ecd9] text-[#b3411c]' : 'border-[#e2c9a0] text-[#8a7a64]'}`}
        >
          Crédito
        </button>
        <button
          type="button"
          onClick={() => setCardType('DebitCard')}
          className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${cardType === 'DebitCard' ? 'border-[#e7723a] bg-[#f6ecd9] text-[#b3411c]' : 'border-[#e2c9a0] text-[#8a7a64]'}`}
        >
          Débito
        </button>
      </div>

      <div>
        <label className={lbl}>Número do cartão</label>
        <div className="relative">
          <input
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            placeholder="0000 0000 0000 0000"
            inputMode="numeric"
            autoComplete="cc-number"
            className={inp}
          />
          {brand && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#8a7a64]">{brand}</span>}
        </div>
      </div>

      <div>
        <label className={lbl}>Nome no cartão</label>
        <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Como está no cartão" autoComplete="cc-name" className={inp} />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={lbl}>Validade</label>
          <input value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" className={inp} />
        </div>
        <div className="flex-1">
          <label className={lbl}>CVV</label>
          <input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="123" inputMode="numeric" autoComplete="cc-csc" className={inp} />
        </div>
      </div>

      {/* Celular e e-mail vao pro 3DS: o emissor usa na analise de risco e,
          sem eles, a autenticacao nem chega a rodar. */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={lbl}>Celular</label>
          <input
            value={fone}
            onChange={(e) => setFone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="79900000000"
            inputMode="numeric"
            autoComplete="tel"
            className={inp}
          />
        </div>
        <div className="flex-1">
          <label className={lbl}>E-mail</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value.slice(0, 120))}
            placeholder="voce@email.com"
            inputMode="email"
            autoComplete="email"
            className={inp}
          />
        </div>
      </div>

      <div>
        <label className={lbl}>CPF do titular</label>
        <input value={cpf} onChange={(e) => setCpf(formatCPF(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" className={inp} />
      </div>

      <div>
        <label className={lbl}>Endereço de cobrança do cartão</label>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <input
            value={cep}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 8);
              setCep(v);
              if (v.length === 8) void buscarCep(v);
            }}
            placeholder={buscandoCep ? 'buscando…' : 'CEP'}
            inputMode="numeric"
            autoComplete="postal-code"
            className={`${inp} mt-0`}
          />
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Número" className={`${inp} mt-0`} />
          <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua" className={`${inp} col-span-2 mt-0`} />
          <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Bairro" className={`${inp} mt-0`} />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" className={`${inp} mt-0`} />
          <input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} placeholder="UF" className={`${inp} col-span-2 mt-0`} />
        </div>
      </div>

      <button onClick={handleSubmit} disabled={isProcessing} className={btn}>
        {isProcessing ? (authenticating3DS ? 'Autenticando com o banco…' : 'Processando…') : `Pagar com ${cardType === 'CreditCard' ? 'crédito' : 'débito'}`}
      </button>

      <p className="text-center text-[10px] text-[#8a7a64]">Pagamento seguro processado pela Cielo (3DS)</p>
    </div>
  );
}
