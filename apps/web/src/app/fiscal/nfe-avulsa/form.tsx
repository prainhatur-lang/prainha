'use client';

// Formulário da NF-e avulsa (venda de bem do ativo imobilizado — o carro da
// empresa, um equipamento) + ações da nota já emitida.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DestForm {
  documento: string;
  nome: string;
  ie: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoMunicipio: string;
  fone: string;
}

const VAZIO: DestForm = {
  documento: '', nome: '', ie: '', email: '', cep: '', logradouro: '', numero: '', complemento: '',
  bairro: '', municipio: '', uf: '', codigoMunicipio: '', fone: '',
};

interface BemForm {
  ehVeiculo: boolean;
  marcaModelo: string;
  ano: string;
  cor: string;
  placa: string;
  chassi: string;
  renavam: string;
  descricaoLivre: string;
  detalheLivre: string;
  ncm: string;
  valor: string;
}

const BEM_VAZIO: BemForm = {
  ehVeiculo: true, marcaModelo: '', ano: '', cor: '', placa: '', chassi: '', renavam: '',
  descricaoLivre: '', detalheLivre: '', ncm: '', valor: '',
};

const so = (s: string) => s.replace(/\D/g, '');
const campo = 'mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900';
const rotulo = 'block text-xs font-medium text-slate-600';
const novoId = () => crypto.randomUUID();

/** "45.000,00" / "45000" / "45000.50" → 45000.5 */
function valorDigitado(s: string): number {
  const t = s.trim().replace(/[^\d.,]/g, '');
  if (!t) return 0;
  const n = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function FormNfeAvulsa({
  filialId,
  casa,
  ufCasa,
  regimeNormal,
  infoPadrao,
  formas,
}: {
  filialId: string;
  casa: string;
  ufCasa: string;
  regimeNormal: boolean;
  infoPadrao: string;
  formas: Record<string, string>;
}) {
  const router = useRouter();
  const [f, setF] = useState<DestForm>(VAZIO);
  const [b, setB] = useState<BemForm>(BEM_VAZIO);
  const [formaPagamento, setFormaPagamento] = useState('18');
  const [revenda, setRevenda] = useState(false);
  const [info, setInfo] = useState(infoPadrao);
  const [fiscal, setFiscal] = useState({ cfop: '', cst: '41', cstPisCofins: '08', cstIbsCbs: '000', classTrib: '000001' });
  // um id por nota e por ambiente: repetir o clique cai na MESMA nota (não duplica)
  const [ids, setIds] = useState(() => ({ prod: novoId(), teste: novoId() }));
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [outros, setOutros] = useState<Record<string, string>[]>([]);
  const usarCadastro = (dados: Record<string, string>) =>
    setF((a) => ({ ...a, ...Object.fromEntries(Object.entries(dados).filter(([k]) => k in a)) }) as DestForm);
  const set = (k: keyof DestForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((a) => ({ ...a, [k]: e.target.value }));
  const setBem = (k: keyof BemForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setB((a) => ({ ...a, [k]: e.target.value }));
  const setFis = (k: keyof typeof fiscal) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFiscal((a) => ({ ...a, [k]: e.target.value }));

  // cepNovo: o CEP acabou de ser trocado — busca por ele e o endereço antigo sai
  async function buscar(tipo: 'cnpj' | 'cep', cepNovo?: string) {
    const v = so(cepNovo ?? (tipo === 'cnpj' ? f.documento : f.cep));
    const ehCpf = tipo === 'cnpj' && v.length === 11;
    if (tipo === 'cnpj' && v.length !== 14 && !ehCpf) return;
    if (tipo === 'cep' && v.length !== 8) return;
    setOcupado(tipo);
    setErro(null);
    setAviso(null);
    try {
      // CPF não tem consulta na Receita: procura no cadastro da casa (vai no corpo, não na URL)
      const r = ehCpf
        ? await fetch('/api/nfe/consulta-destinatario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf: v }),
          })
        : await fetch(`/api/nfe/consulta-destinatario?${tipo}=${v}`);
      const j = await r.json();
      if (!r.ok) {
        setAviso(j.error ?? 'não achei — preencha na mão');
        return;
      }
      // só preenche o que veio; não apaga o que já foi digitado
      setF((a) => {
        const n: Record<string, string> = { ...a };
        if (cepNovo) {
          const d = j.dados as Record<string, string>;
          if ((d.logradouro ?? '') !== a.logradouro) {
            n.numero = '';
            n.complemento = '';
          }
          n.logradouro = d.logradouro ?? '';
          n.bairro = d.bairro ?? '';
        }
        for (const [k, val] of Object.entries(j.dados as Record<string, string>)) {
          if (val && k in n) n[k] = val;
        }
        return n as unknown as DestForm;
      });
      if (tipo === 'cnpj') setOutros(ehCpf && Array.isArray(j.outros) ? j.outros : []);
      if (cepNovo) setAviso('Endereço atualizado pelo CEP — confira o número e o complemento.');
      if (ehCpf) setAviso(`Dados puxados do ${j.origem ?? 'cadastro'} — confira antes de emitir.`);
      if (j.situacao && j.situacao !== 'ATIVA') setAviso(`Atenção: na Receita este CNPJ está ${j.situacao}.`);
    } catch {
      setAviso('consulta fora do ar — preencha na mão');
    } finally {
      setOcupado(null);
    }
  }

  const valor = valorDigitado(b.valor);
  const descricao = b.ehVeiculo
    ? ['VEICULO USADO', b.marcaModelo.trim(), b.ano.trim() ? `ANO ${b.ano.trim()}` : '', b.placa.trim() ? `PLACA ${b.placa.trim()}` : '']
        .filter(Boolean)
        .join(' ')
        .toUpperCase()
    : b.descricaoLivre.trim().toUpperCase();
  const detalhe = b.ehVeiculo
    ? [
        b.chassi.trim() ? `Chassi ${b.chassi.trim().toUpperCase()}` : '',
        b.renavam.trim() ? `Renavam ${so(b.renavam)}` : '',
        b.cor.trim() ? `Cor ${b.cor.trim()}` : '',
        b.placa.trim() ? `Placa ${b.placa.trim().toUpperCase()}` : '',
      ]
        .filter(Boolean)
        .join(' - ')
    : b.detalheLivre.trim();
  const outraUf = !!f.uf && !!ufCasa && f.uf.toUpperCase() !== ufCasa.toUpperCase();
  const cfopPadrao = outraUf ? '6551' : '5551';

  function faltando(): string | null {
    if (b.ehVeiculo) {
      if (!b.marcaModelo.trim()) return 'informe a marca e o modelo do veículo';
      if (!b.placa.trim()) return 'informe a placa';
      if (!b.chassi.trim()) return 'informe o chassi (está no documento do carro)';
      if (!b.renavam.trim()) return 'informe o Renavam (está no documento do carro)';
    } else if (descricao.length < 2) return 'descreva o bem vendido';
    if (so(b.ncm).length !== 8) return 'o NCM tem 8 dígitos — está na nota de compra do bem';
    if (!(valor > 0)) return 'informe o valor da venda';
    if (!so(f.documento)) return 'informe o CPF ou CNPJ do comprador';
    return null;
  }

  async function emitir(homologacao: boolean) {
    setErro(null);
    setAviso(null);
    const falta = faltando();
    if (falta) {
      setErro(falta);
      return;
    }
    if (
      !homologacao &&
      !window.confirm(
        `Emitir a NF-e DE VERDADE (produção)?\n\n${casa} vende para ${f.nome || 'o comprador'}\n${descricao}\n${brl(valor)}\n\n` +
          'Depois de autorizada só dá pra cancelar em 24 h.',
      )
    ) {
      return;
    }
    setOcupado(homologacao ? 'teste' : 'emitir');
    try {
      const r = await fetch('/api/nfe/avulsa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: homologacao ? ids.teste : ids.prod,
          filialId,
          homologacao,
          destinatario: f,
          item: { descricao: descricao.slice(0, 120), detalhe: detalhe.slice(0, 500), ncm: so(b.ncm), valor },
          formaPagamento,
          revenda,
          fiscal: { ...fiscal, cfop: so(fiscal.cfop) },
          infoExtra: info,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErro(j.error ?? 'falhou');
        router.refresh();
        return;
      }
      // a próxima nota (ou o próximo teste) é outra: id novo
      setIds((a) => (homologacao ? { ...a, teste: novoId() } : { ...a, prod: novoId() }));
      if (j.aviso) window.alert(j.aviso);
      setAviso(
        homologacao
          ? 'Teste AUTORIZADO pela SEFAZ (sem valor fiscal) — a nota de teste está logo abaixo. Se estiver tudo certo, clique em Emitir NF-e.'
          : `NF-e nº ${j.nota.numero} AUTORIZADA — está logo abaixo pra imprimir e baixar o XML.`,
      );
      router.push(`/fiscal/nfe-avulsa?filialId=${filialId}&nfeId=${j.nota.id}#nota`);
      router.refresh();
    } catch {
      setErro('sem resposta do servidor — tente de novo (o sistema confere antes de reenviar)');
    } finally {
      setOcupado(null);
    }
  }

  const ehCnpj = so(f.documento).length === 14;
  const ehCpfDigitado = so(f.documento).length === 11;

  return (
    <div className="no-print w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">1. O que foi vendido</h2>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={!b.ehVeiculo} onChange={(e) => setB((a) => ({ ...a, ehVeiculo: !e.target.checked }))} />
        não é veículo (outro bem da empresa: equipamento, móvel, máquina)
      </label>
      {b.ehVeiculo ? (
        <div className="mt-3 grid grid-cols-6 gap-3">
          <label className={`${rotulo} col-span-6 sm:col-span-4`}>
            Marca e modelo <span className="font-normal text-slate-400">(como está no documento)</span>
            <input className={campo} value={b.marcaModelo} onChange={setBem('marcaModelo')} maxLength={60} placeholder="FIAT STRADA FREEDOM 1.3 CD" />
          </label>
          <label className={`${rotulo} col-span-3 sm:col-span-2`}>
            Ano fabricação/modelo
            <input className={campo} value={b.ano} onChange={setBem('ano')} maxLength={9} placeholder="2021/2022" />
          </label>
          <label className={`${rotulo} col-span-3 sm:col-span-2`}>
            Placa
            <input className={campo} value={b.placa} onChange={setBem('placa')} maxLength={8} />
          </label>
          <label className={`${rotulo} col-span-6 sm:col-span-2`}>
            Chassi
            <input className={campo} value={b.chassi} onChange={setBem('chassi')} maxLength={17} />
          </label>
          <label className={`${rotulo} col-span-3 sm:col-span-2`}>
            Renavam
            <input className={campo} value={b.renavam} onChange={setBem('renavam')} maxLength={11} inputMode="numeric" />
          </label>
          <label className={`${rotulo} col-span-3 sm:col-span-2`}>
            Cor <span className="font-normal text-slate-400">(opcional)</span>
            <input className={campo} value={b.cor} onChange={setBem('cor')} maxLength={20} />
          </label>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-6 gap-3">
          <label className={`${rotulo} col-span-6`}>
            Descrição do bem
            <input className={campo} value={b.descricaoLivre} onChange={setBem('descricaoLivre')} maxLength={120} placeholder="FREEZER HORIZONTAL USADO 500 L" />
          </label>
          <label className={`${rotulo} col-span-6`}>
            Detalhes <span className="font-normal text-slate-400">(marca, nº de série — opcional)</span>
            <input className={campo} value={b.detalheLivre} onChange={setBem('detalheLivre')} maxLength={300} />
          </label>
        </div>
      )}
      <div className="mt-3 grid grid-cols-6 gap-3">
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          NCM <span className="font-normal text-slate-400">(8 dígitos)</span>
          <input className={campo} value={b.ncm} onChange={setBem('ncm')} maxLength={10} inputMode="numeric" placeholder="da nota de compra" />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Valor da venda (R$)
          <input className={campo} value={b.valor} onChange={setBem('valor')} inputMode="decimal" placeholder="45.000,00" />
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-2`}>
          Como o comprador pagou
          <select className={campo} value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
            {Object.entries(formas).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        O NCM é o mesmo da nota fiscal de quando a empresa comprou o bem (carro de passeio começa com 8703, picape/utilitário
        de carga com 8704, moto com 8711). Na nota sai: <b>{descricao || '—'}</b>
        {detalhe ? ` · ${detalhe}` : ''} {valor > 0 ? `· ${brl(valor)}` : ''}
      </p>

      <h2 className="mt-5 text-sm font-semibold text-slate-900">2. Quem comprou</h2>
      <div className="mt-3 grid grid-cols-6 gap-3">
        <label className={`${rotulo} col-span-6 sm:col-span-2`}>
          CNPJ ou CPF
          <div className="flex gap-1">
            <input
              className={campo}
              value={f.documento}
              onChange={set('documento')}
              onBlur={() => !f.nome && buscar('cnpj')}
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => buscar('cnpj')}
              disabled={(!ehCnpj && !ehCpfDigitado) || !!ocupado}
              className="mt-0.5 rounded-md border border-slate-300 px-2 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              title="CNPJ: puxa razão social e endereço da Receita. CPF: procura no cadastro de clientes da casa"
            >
              {ocupado === 'cnpj' ? '…' : 'buscar'}
            </button>
          </div>
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-4`}>
          Nome / razão social
          <input className={campo} value={f.nome} onChange={set('nome')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Inscrição estadual <span className="font-normal text-slate-400">(se tiver)</span>
          <input className={campo} value={f.ie} onChange={set('ie')} inputMode="numeric" />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Telefone <span className="font-normal text-slate-400">(opcional)</span>
          <input className={campo} value={f.fone} onChange={set('fone')} inputMode="numeric" />
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-2`}>
          E-mail <span className="font-normal text-slate-400">(opcional)</span>
          <input className={campo} value={f.email} onChange={set('email')} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          CEP
          <input
            className={campo}
            value={f.cep}
            onChange={(e) => {
              set('cep')(e);
              const novo = so(e.target.value);
              if (novo.length === 8 && novo !== so(f.cep)) void buscar('cep', novo);
            }}
            onBlur={() => (!f.logradouro || !f.codigoMunicipio) && buscar('cep')}
            inputMode="numeric"
          />
        </label>
        <label className={`${rotulo} col-span-6 sm:col-span-3`}>
          Rua / avenida
          <input className={campo} value={f.logradouro} onChange={set('logradouro')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-1`}>
          Número
          <input className={campo} value={f.numero} onChange={set('numero')} placeholder="SN" />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Complemento
          <input className={campo} value={f.complemento} onChange={set('complemento')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Bairro
          <input className={campo} value={f.bairro} onChange={set('bairro')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-4 sm:col-span-2`}>
          Cidade
          <input className={campo} value={f.municipio} onChange={set('municipio')} maxLength={60} />
        </label>
        <label className={`${rotulo} col-span-2 sm:col-span-1`}>
          UF
          <input className={campo} value={f.uf} onChange={set('uf')} maxLength={2} />
        </label>
        <label className={`${rotulo} col-span-3 sm:col-span-2`}>
          Código IBGE da cidade
          <input
            className={campo}
            value={f.codigoMunicipio}
            onChange={set('codigoMunicipio')}
            inputMode="numeric"
            placeholder="vem do CEP"
          />
        </label>
      </div>
      {so(f.ie) && (
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={revenda} onChange={(e) => setRevenda(e.target.checked)} />
          o comprador é revenda (loja de veículos/usados) e vai revender o bem
        </label>
      )}
      {outros.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          Outros cadastros com esse CPF:
          {outros.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => usarCadastro(o)}
              className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100"
              title={[o.logradouro, o.numero, o.bairro, o.municipio].filter(Boolean).join(', ') || 'sem endereço'}
            >
              {o.nome}
            </button>
          ))}
        </div>
      )}

      <h2 className="mt-5 text-sm font-semibold text-slate-900">3. Texto que vai no rodapé da nota</h2>
      <textarea
        className={`${campo} h-20`}
        value={info}
        onChange={(e) => setInfo(e.target.value)}
        maxLength={2000}
      />

      <details className="mt-3 rounded-md border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          Ajustes fiscais (só mexa se o contador pedir) — CFOP {so(fiscal.cfop) || cfopPadrao}
          {regimeNormal ? ` · ICMS CST ${fiscal.cst} · PIS/COFINS CST ${fiscal.cstPisCofins}` : ' · Simples (CSOSN 400)'}
        </summary>
        <div className="mt-3 grid grid-cols-6 gap-3">
          <label className={`${rotulo} col-span-3 sm:col-span-2`}>
            CFOP
            <input className={campo} value={fiscal.cfop} onChange={setFis('cfop')} maxLength={4} inputMode="numeric" placeholder={cfopPadrao} />
          </label>
          {regimeNormal && (
            <label className={`${rotulo} col-span-3 sm:col-span-2`}>
              CST do ICMS <span className="font-normal text-slate-400">(40 ou 41)</span>
              <input className={campo} value={fiscal.cst} onChange={setFis('cst')} maxLength={2} inputMode="numeric" />
            </label>
          )}
          <label className={`${rotulo} col-span-3 sm:col-span-2`}>
            CST PIS/COFINS
            <input className={campo} value={fiscal.cstPisCofins} onChange={setFis('cstPisCofins')} maxLength={2} inputMode="numeric" />
          </label>
          {regimeNormal && (
            <>
              <label className={`${rotulo} col-span-3 sm:col-span-2`}>
                IBS/CBS — CST
                <input className={campo} value={fiscal.cstIbsCbs} onChange={setFis('cstIbsCbs')} maxLength={3} inputMode="numeric" />
              </label>
              <label className={`${rotulo} col-span-3 sm:col-span-2`}>
                IBS/CBS — cClassTrib
                <input className={campo} value={fiscal.classTrib} onChange={setFis('classTrib')} maxLength={6} inputMode="numeric" />
              </label>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Padrão: venda de bem do imobilizado com mais de 12 meses de uso — CFOP 5551 (comprador do mesmo estado) ou 6551
          (de outro estado), sem ICMS, PIS/COFINS sem incidência (CST 08)
          {regimeNormal
            ? ' e IBS/CBS com as alíquotas de teste de 2026 (0,1% + 0,9%, só informativas — não entram no valor da nota).'
            : '.'}{' '}
          Bem com menos de 12 meses na empresa tem ICMS: essa nota é com o contador.
        </p>
      </details>

      {aviso && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p>}
      {erro && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => emitir(false)}
          disabled={!!ocupado}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {ocupado === 'emitir' ? 'Enviando pra SEFAZ…' : '🧾 Emitir NF-e'}
        </button>
        <button
          type="button"
          onClick={() => emitir(true)}
          disabled={!!ocupado}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          title="Manda pro ambiente de teste da SEFAZ — não vale como nota, serve pra conferir antes"
        >
          {ocupado === 'teste' ? 'Testando…' : 'Testar antes (sem valor fiscal)'}
        </button>
      </div>
    </div>
  );
}

export function AcoesNfeAvulsa({
  nfeId,
  temXml,
  podeCancelar,
}: {
  nfeId: string;
  temXml: boolean;
  podeCancelar: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function cancelar() {
    const justificativa = window.prompt(
      'Cancelar a NF-e — a SEFAZ só aceita até 24 HORAS depois da autorização.\n\nJustificativa (mín. 15 caracteres):',
      'Erro nos dados da nota fiscal',
    );
    if (!justificativa) return;
    setOcupado(true);
    try {
      const r = await fetch(`/api/nfe/avulsa/${nfeId}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa }),
      });
      const j = await r.json();
      if (!r.ok) window.alert(j.error ?? 'falhou');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        onClick={() => window.print()}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        🖨 Imprimir / salvar PDF
      </button>
      {temXml && (
        <a
          href={`/api/nfe/avulsa/${nfeId}/xml`}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Baixar XML
        </a>
      )}
      {podeCancelar && (
        <button
          onClick={cancelar}
          disabled={ocupado}
          className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          Cancelar NF-e
        </button>
      )}
    </>
  );
}
