'use client';

// Link de admissão pelo celular (04/11/2026): CPF → dados → documentos →
// contrato → aceites → selfie + rubrica → assinar. O que ela digita é salvo
// sozinho (pode fechar e voltar pelo mesmo link). Selfie e rubrica seguem o
// mesmo jeito da tela /op/assinar.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { abrirCameraFrontal, carregarImagem, pararStream, useCameraLigada } from '@/lib/camera-celular';

const FACELIB = '/agente-release/facelib/';

type Pessoais = Record<string, string>;
interface DocPedido {
  chave: string;
  rotulo: string;
  obrigatorio: boolean;
  dica?: string;
  quem?: 'homem';
}
interface DocSubido {
  chave: string;
  path: string;
  nome: string;
  em: string;
}
interface Dados {
  casa: string;
  pessoais: Pessoais;
  docs: DocSubido[];
  titulo: string;
  resumo: string;
  empregador: string;
  modelo: string;
  docsPedidos: DocPedido[];
  aceites: { chave: string; texto: string }[];
  textoAceite: string;
  aso?: {
    clinica: string;
    endereco: string;
    telefone: string;
    quando: string;
    observacao: string;
    registro: string;
    guia: string;
  } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    faceapi?: any;
  }
}
let motorPronto: Promise<any> | null = null;
function carregarMotor(): Promise<any> {
  if (motorPronto) return motorPronto;
  motorPronto = (async () => {
    if (!window.faceapi) {
      await new Promise<void>((ok, erro) => {
        const s = document.createElement('script');
        s.src = FACELIB + 'face-api.js';
        s.onload = () => ok();
        s.onerror = () => erro(new Error('não carregou o reconhecimento facial'));
        document.head.appendChild(s);
      });
    }
    const faceapi = window.faceapi;
    let ok = false;
    try {
      try {
        faceapi.tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
      } catch {}
      faceapi.tf.setWasmPaths(FACELIB);
      ok = await faceapi.tf.setBackend('wasm');
    } catch {}
    if (!ok) {
      try {
        await faceapi.tf.setBackend('cpu');
      } catch {}
    }
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACELIB + 'models'),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACELIB + 'models'),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACELIB + 'models'),
    ]);
    return faceapi;
  })();
  motorPronto.catch(() => {
    motorPronto = null;
  });
  return motorPronto;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function dataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Foto grande do celular → JPEG de até 1600 px. PDF/HEIC que o navegador não abre vai como veio. */
async function comprimir(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 400_000) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    cv.getContext('2d')?.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/jpeg', 0.8));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return f;
  }
}

const CAMPO = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base';

function faltando(p: Pessoais, docs: DocSubido[], pedidos: DocPedido[]): string[] {
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
  for (const d of pedidos.filter((x) => x.obrigatorio)) if (!docs.some((s) => s.chave === d.chave)) f.push(d.rotulo);
  return f;
}

export function AdmissaoPublicaCliente({ token }: { token: string }) {
  const [inicio, setInicio] = useState<{ primeiroNome: string; casa: string; status: string; assinadoEm: string | null; bloqueio: string | null } | null>(null);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const [dados, setDados] = useState<Dados | null>(null);
  const [p, setP] = useState<Pessoais>({});
  const [docs, setDocs] = useState<DocSubido[]>([]);
  const [salvo, setSalvo] = useState<'' | 'salvando' | 'salvo' | 'erro'>('');
  const [subindo, setSubindo] = useState<string | null>(null);
  const [contrato, setContrato] = useState<string | null>(null);
  const [leuContrato, setLeuContrato] = useState(false);
  const [aceites, setAceites] = useState<Record<string, boolean>>({});
  const [fase, setFase] = useState<'form' | 'camera' | 'enviando' | 'feito'>('form');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [rubrica, setRubrica] = useState<string | null>(null);
  const [descritor, setDescritor] = useState<number[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [assinadoEm, setAssinadoEm] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pRef = useRef<Pessoais>({});
  const camera = useCameraLigada(fase === 'camera', video, stream);

  const post = useCallback(
    async (corpo: Record<string, unknown>) => {
      const r = await fetch('/api/admissao-publica', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, cpf, ...corpo }),
      });
      const j = await r.json().catch(() => ({ ok: false, erro: 'Sem resposta. Tente de novo.' }));
      return j as { ok: boolean; erro?: string } & Record<string, unknown>;
    },
    [token, cpf],
  );

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/admissao-publica?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return setErroLink(j.erro ?? 'Link inválido.');
      if (j.bloqueio) return setErroLink(j.bloqueio);
      setInicio(j);
      if (j.status === 'assinado') {
        setAssinadoEm(j.assinadoEm);
        setFase('feito');
      }
    })();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [token]);

  async function entrar() {
    setAviso(null);
    const j = await post({ acao: 'abrir' });
    if (!j.ok) return setAviso(j.erro ?? 'Não deu certo.');
    const d = j as unknown as Dados;
    setDados(d);
    setP(d.pessoais);
    pRef.current = d.pessoais;
    setDocs(d.docs);
  }

  function mudar(k: string, v: string) {
    const novo = { ...pRef.current, [k]: v };
    pRef.current = novo;
    setP(novo);
    setContrato(null);
    setLeuContrato(false);
    setSalvo('salvando');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const j = await post({ acao: 'salvar', pessoais: pRef.current });
      setSalvo(j.ok ? 'salvo' : 'erro');
    }, 900);
  }

  async function subir(chave: string, arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setAviso(null);
    setSubindo(chave);
    try {
      for (const original of Array.from(arquivos)) {
        const f = await comprimir(original);
        const u = await post({ acao: 'upload_url', chave, nome: f.name });
        if (!u.ok) throw new Error(u.erro);
        const sb = createClient();
        const { error } = await sb.storage
          .from(String(u.bucket))
          .uploadToSignedUrl(String(u.path), String(u.token), f, { contentType: f.type || undefined });
        if (error) throw new Error('O arquivo não subiu. Tente de novo.');
        const reg = await post({ acao: 'registrar_doc', chave, path: u.path, nome: original.name });
        if (!reg.ok) throw new Error(reg.erro);
        setDocs(reg.docs as DocSubido[]);
      }
    } catch (e) {
      setAviso((e as Error).message || 'Não deu certo. Tente de novo.');
    } finally {
      setSubindo(null);
    }
  }

  async function remover(path: string) {
    const j = await post({ acao: 'remover_doc', path });
    if (j.ok) setDocs(j.docs as DocSubido[]);
  }

  async function verContrato() {
    setAviso(null);
    const j = await post({ acao: 'contrato', pessoais: pRef.current });
    if (!j.ok) return setAviso(j.erro ?? 'Não consegui abrir o contrato.');
    setContrato(String(j.html));
  }

  function pararCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function abrirCamera() {
    setAviso(null);
    carregarMotor().catch(() => {});
    try {
      pararStream(stream.current);
      stream.current = await abrirCameraFrontal();
      // o vídeo liga no useCameraLigada, depois do <video> montado (iPhone ficava preto)
      setFase('camera');
    } catch {
      setAviso('Não consegui abrir a câmera. Libere a câmera para o navegador e tente de novo.');
    }
  }

  async function tirarFoto() {
    const v = video.current;
    if (!v || !v.videoWidth) {
      setAviso('A câmera ainda não abriu. Toque em “Tentar de novo” ou tire pela câmera do celular.');
      return;
    }
    await guardarFoto(v, v.videoWidth, v.videoHeight, true);
  }

  // Câmera do próprio celular (quando a do navegador fica preta no iPhone).
  async function fotoDoCelular(arquivos: FileList | null) {
    const f = arquivos?.[0];
    if (!f) return;
    setAviso(null);
    try {
      const img = await carregarImagem(f);
      await guardarFoto(img, img.naturalWidth, img.naturalHeight, false);
    } catch (e) {
      setStatus('');
      setAviso((e as Error).message || 'Não consegui ler a foto. Tente de novo.');
    }
  }

  async function guardarFoto(fonte: HTMLVideoElement | HTMLImageElement, fw: number, fh: number, espelhar: boolean) {
    if (!fw || !fh) return;
    setStatus('Conferindo o rosto…');
    let descr: number[] | null = null;
    try {
      const faceapi = await carregarMotor();
      let det = null;
      for (let i = 0; i < (espelhar ? 6 : 1) && !det; i++) {
        det = await faceapi
          .detectSingleFace(fonte, new faceapi.TinyFaceDetectorOptions({ inputSize: espelhar ? 224 : 416, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det && espelhar) await new Promise((r) => setTimeout(r, 300));
      }
      if (!det) {
        setStatus('');
        setAviso('Não achei seu rosto. Fique de frente, com luz no rosto, e tente de novo.');
        return;
      }
      descr = Array.from(det.descriptor as Float32Array);
    } catch {
      descr = null; // celular antigo: a selfie vale do mesmo jeito
    }
    const w = 480;
    const h = Math.round((fh / fw) * w);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (espelhar) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(fonte, 0, 0, w, h);
    setSelfie(cv.toDataURL('image/jpeg', 0.75));
    setDescritor(descr);
    setStatus('');
    setAviso(null);
    pararCamera();
    setFase('form');
  }

  async function assinar() {
    setAviso(null);
    setFase('enviando');
    try {
      const j = await post({ acao: 'assinar', pessoais: pRef.current, aceites, selfie, rubrica, descriptor: descritor });
      if (j.ok) {
        setAssinadoEm(String(j.assinadoEm ?? new Date().toISOString()));
        setFase('feito');
        window.scrollTo({ top: 0 });
      } else {
        setFase('form');
        setAviso(j.erro ?? 'Não deu certo. Tente de novo.');
      }
    } catch {
      setFase('form');
      setAviso('Sem conexão. Tente de novo.');
    }
  }

  if (erroLink) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="max-w-sm text-center text-slate-700">{erroLink}</p>
      </main>
    );
  }
  if (!inicio) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">Carregando…</p>
      </main>
    );
  }

  if (fase === 'feito') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
          <p className="text-lg font-semibold text-emerald-800">✅ Contrato assinado</p>
          {assinadoEm ? <p className="mt-1 text-sm text-emerald-700">em {dataHora(assinadoEm)}</p> : null}
          <p className="mt-2 text-sm text-emerald-700">
            Pronto, {inicio.primeiroNome}! O RH do {inicio.casa} já recebeu os seus dados, os documentos e a assinatura. Seja bem-vindo(a)!
          </p>
        </div>
      </main>
    );
  }

  if (!dados) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-md space-y-4">
          <header>
            <p className="text-xs uppercase tracking-wide text-slate-500">{inicio.casa}</p>
            <h1 className="text-xl font-semibold text-slate-900">Olá, {inicio.primeiroNome}! Vamos fazer o seu registro</h1>
            <p className="mt-1 text-sm text-slate-600">
              Leva uns 10 minutos. Tenha em mãos o RG (ou CNH), o comprovante de residência e a Carteira de Trabalho Digital. O que você
              digitar fica salvo: pode parar e voltar por este mesmo link.
            </p>
          </header>
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <label className="mb-1 block text-sm font-medium text-slate-800" htmlFor="cpf">
              Para começar, digite o seu CPF
            </label>
            <input
              id="cpf"
              inputMode="numeric"
              autoComplete="off"
              value={mascaraCpf(cpf)}
              onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="000.000.000-00"
              className={CAMPO}
            />
            <button
              type="button"
              disabled={cpf.length !== 11}
              onClick={entrar}
              className="mt-3 w-full rounded-md bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Começar
            </button>
          </section>
          {aviso ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{aviso}</p> : null}
        </div>
      </main>
    );
  }

  const homem = p.sexo === 'H';
  const pedidos = dados.docsPedidos.filter((d) => d.quem !== 'homem' || homem || !p.sexo);
  const falta = faltando(p, docs, dados.docsPedidos);
  const todosAceites = dados.aceites.every((a) => aceites[a.chave]);
  const faltaTudo = [
    ...falta,
    ...(!leuContrato ? ['ler o contrato'] : []),
    ...(!todosAceites ? ['marcar os aceites'] : []),
    ...(!selfie ? ['selfie'] : []),
    ...(!rubrica ? ['rubrica'] : []),
  ];
  const pode = faltaTudo.length === 0 && fase === 'form';

  const texto = (k: string, rotulo: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="block text-sm text-slate-700">
      {rotulo}
      <input value={p[k] ?? ''} onChange={(e) => mudar(k, e.target.value)} className={CAMPO + ' mt-0.5'} {...extra} />
    </label>
  );
  const escolha = (k: string, rotulo: string, ops: [string, string][]) => (
    <label className="block text-sm text-slate-700">
      {rotulo}
      <select value={p[k] ?? ''} onChange={(e) => mudar(k, e.target.value)} className={CAMPO + ' mt-0.5'}>
        <option value="">— escolha —</option>
        {ops.map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <header>
          <p className="text-xs uppercase tracking-wide text-slate-500">{dados.casa}</p>
          <h1 className="text-xl font-semibold text-slate-900">Seu registro</h1>
          <p className="mt-1 rounded-md bg-sky-50 p-2 text-sm text-sky-900">
            <b>Combinado:</b> {dados.resumo}
            {dados.empregador ? <span className="block text-xs text-sky-700">Empregador: {dados.empregador}</span> : null}
          </p>
          {dados.aso ? (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              <b>🩺 Exame admissional (ASO)</b>
              <span className="block">
                Apresente-se na <b>{dados.aso.clinica}</b>
                {dados.aso.endereco ? ` (${dados.aso.endereco})` : ''} em <b>{dados.aso.quando}</b>, com documento com foto.
              </span>
              {dados.aso.telefone ? <span className="block text-xs">Telefone da clínica: {dados.aso.telefone}</span> : null}
              {dados.aso.observacao ? <span className="block text-xs">Obs.: {dados.aso.observacao}</span> : null}
              <span className="mt-1 block">
                Seu registro começa em <b>{dados.aso.registro}</b>.
              </span>
              <a className="mt-1 inline-block font-medium underline" href={dados.aso.guia} target="_blank" rel="noreferrer">
                Abrir a guia pra mostrar na clínica
              </a>
            </div>
          ) : null}
          <p className="mt-1 text-right text-xs text-slate-400">
            {salvo === 'salvando' ? 'salvando…' : salvo === 'salvo' ? '✓ salvo' : salvo === 'erro' ? 'não salvou — confira a internet' : ''}
          </p>
        </header>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">1. Seus dados</p>
          {texto('nome', 'Nome completo')}
          <div className="grid grid-cols-2 gap-2">
            {texto('nascimento', 'Nascimento', { type: 'date' })}
            {escolha('sexo', 'Sexo', [
              ['M', 'Feminino'],
              ['H', 'Masculino'],
            ])}
          </div>
          {texto('mae', 'Nome da mãe')}
          {texto('pai', 'Nome do pai (se tiver)')}
          <div className="grid grid-cols-2 gap-2">
            {escolha('estadoCivil', 'Estado civil', [
              ['solteiro(a)', 'Solteiro(a)'],
              ['casado(a)', 'Casado(a)'],
              ['união estável', 'União estável'],
              ['divorciado(a)', 'Divorciado(a)'],
              ['viúvo(a)', 'Viúvo(a)'],
            ])}
            {escolha('escolaridade', 'Escolaridade', [
              ['fundamental incompleto', 'Fundamental incompleto'],
              ['fundamental completo', 'Fundamental completo'],
              ['médio incompleto', 'Médio incompleto'],
              ['médio completo', 'Médio completo'],
              ['superior incompleto', 'Superior incompleto'],
              ['superior completo', 'Superior completo'],
            ])}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {texto('naturalidade', 'Cidade onde nasceu')}
            {texto('nacionalidade', 'Nacionalidade')}
          </div>
          {texto('email', 'E-mail', { type: 'email', inputMode: 'email' })}
          {texto('contatoEmergencia', 'Contato de emergência (nome e telefone)')}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">2. Documentos (números)</p>
          <div className="grid grid-cols-2 gap-2">
            {texto('rg', 'RG')}
            {texto('rgOrgao', 'Órgão (ex.: SSP/SE)')}
          </div>
          {texto('rgData', 'Data de emissão do RG', { type: 'date' })}
          {texto('pis', 'PIS/PASEP/NIS', { inputMode: 'numeric' })}
          <div className="grid grid-cols-2 gap-2">
            {texto('ctps', 'Carteira de trabalho (nº)', { inputMode: 'numeric' })}
            {texto('ctpsSerie', 'Série')}
          </div>
          <p className="-mt-2 text-xs text-slate-500">Na carteira digital o número costuma ser o CPF — pode deixar em branco.</p>
          {texto('titulo', 'Título de eleitor', { inputMode: 'numeric' })}
          {homem ? texto('reservista', 'Reservista') : null}
          <label className="block text-sm text-slate-700">
            Filhos ou dependentes (nome e nascimento de cada um)
            <textarea value={p.dependentes ?? ''} onChange={(e) => mudar('dependentes', e.target.value)} rows={2} className={CAMPO + ' mt-0.5'} />
          </label>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">3. Endereço</p>
          {texto('cep', 'CEP', { inputMode: 'numeric' })}
          {texto('logradouro', 'Rua / avenida')}
          <div className="grid grid-cols-2 gap-2">
            {texto('numero', 'Número')}
            {texto('complemento', 'Complemento')}
          </div>
          {texto('bairro', 'Bairro')}
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            {texto('municipio', 'Cidade')}
            {texto('uf', 'UF', { maxLength: 2 })}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">4. Pagamento e vale-transporte</p>
          <div className="grid grid-cols-[8rem_1fr] gap-2">
            {escolha('pixTipo', 'Tipo da chave', [
              ['cpf', 'CPF'],
              ['telefone', 'Telefone'],
              ['email', 'E-mail'],
              ['aleatoria', 'Aleatória'],
            ])}
            {texto('pixChave', 'Chave Pix (no seu nome)')}
          </div>
          {escolha('valeTransporte', 'Vale-transporte', [
            ['quer', 'Quero vale-transporte'],
            ['nao_quer', 'Não quero vale-transporte'],
          ])}
        </section>

        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">5. Fotos dos documentos</p>
          <p className="text-xs text-slate-500">Foto nítida, com o documento inteiro e sem reflexo. Pode ser PDF também.</p>
          {pedidos.map((d) => {
            const meus = docs.filter((s) => s.chave === d.chave);
            return (
              <div key={d.chave} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-slate-800">
                      {meus.length ? '✅ ' : d.obrigatorio ? '🔴 ' : '⚪ '}
                      {d.rotulo}
                      {d.obrigatorio ? '' : <span className="text-xs text-slate-400"> (se tiver)</span>}
                    </p>
                    {d.dica ? <p className="text-xs text-slate-500">{d.dica}</p> : null}
                  </div>
                  <label className="shrink-0 cursor-pointer rounded-md border border-sky-600 px-3 py-1.5 text-xs font-medium text-sky-700">
                    {subindo === d.chave ? 'enviando…' : meus.length ? '+ outra' : '📎 Enviar'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      className="hidden"
                      disabled={!!subindo}
                      onChange={(e) => {
                        subir(d.chave, e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {meus.map((s) => (
                  <p key={s.path} className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
                    <span className="truncate">{s.nome}</span>
                    <button type="button" onClick={() => remover(s.path)} className="text-red-600 underline">
                      tirar
                    </button>
                  </p>
                ))}
              </div>
            );
          })}
        </section>

        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">6. Leia o contrato</p>
          {contrato ? (
            <>
              <iframe srcDoc={contrato} sandbox="" title={dados.titulo} className="h-[70vh] w-full rounded border border-slate-200 bg-white" />
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={leuContrato} onChange={(e) => setLeuContrato(e.target.checked)} className="mt-1 h-5 w-5" />
                <span>Li o contrato até o fim.</span>
              </label>
            </>
          ) : (
            <button type="button" onClick={verContrato} className="w-full rounded-md bg-slate-800 px-4 py-3 text-sm font-medium text-white">
              📄 Abrir o {dados.titulo.toLowerCase()}
            </button>
          )}
          <p className="text-xs text-slate-500">O contrato já sai com os dados que você preencheu acima. Mudou algum dado? Abra de novo.</p>
        </section>

        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">7. Aceites</p>
          {dados.aceites.map((a) => (
            <label key={a.chave} className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!aceites[a.chave]}
                onChange={(e) => setAceites((x) => ({ ...x, [a.chave]: e.target.checked }))}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>{a.texto}</span>
            </label>
          ))}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">8. Sua foto (selfie)</p>
          {fase === 'camera' ? (
            <div className="space-y-2">
              <video ref={video} playsInline muted autoPlay className="w-full rounded-md bg-black" style={{ transform: 'scaleX(-1)' }} />
              {camera.preta ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  A câmera ficou preta. Toque em “Tentar de novo” ou tire pela câmera do celular.
                </p>
              ) : null}
              <button type="button" onClick={tirarFoto} className="w-full rounded-md bg-sky-600 px-4 py-3 text-sm font-medium text-white">
                📸 Tirar a foto
              </button>
              {status ? <p className="text-center text-xs text-slate-500">{status}</p> : null}
              <div className="flex items-center justify-between gap-2 text-sm">
                <button type="button" onClick={() => camera.tentarDeNovo()} className="text-sky-700 underline">
                  🔄 Tentar de novo
                </button>
                <label className="cursor-pointer text-sky-700 underline">
                  📱 Tirar pela câmera do celular
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={(e) => {
                      fotoDoCelular(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          ) : selfie ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selfie} alt="Sua selfie" className="h-20 w-20 rounded-md object-cover" />
              <button type="button" onClick={abrirCamera} className="text-sm text-sky-700 underline">
                tirar de novo
              </button>
            </div>
          ) : (
            <button type="button" onClick={abrirCamera} className="w-full rounded-md border border-sky-600 px-4 py-3 text-sm font-medium text-sky-700">
              📷 Abrir a câmera
            </button>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">9. Sua rubrica (assine com o dedo)</p>
          <QuadroRubrica onChange={setRubrica} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-100 p-3 text-xs text-slate-600">{dados.textoAceite}</section>

        {aviso ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{aviso}</p> : null}

        <button
          type="button"
          disabled={!pode}
          onClick={assinar}
          className="w-full rounded-md bg-emerald-600 px-4 py-4 text-base font-semibold text-white disabled:opacity-40"
        >
          {fase === 'enviando' ? 'Assinando…' : '✍️ Assinar o contrato'}
        </button>
        {!pode && fase === 'form' ? <p className="text-center text-xs text-slate-500">Falta: {faltaTudo.join(', ')}</p> : null}
      </div>
    </main>
  );
}

/** Quadro pra rubrica com o dedo (ou mouse). Devolve PNG em data URL, ou null se vazio. */
function QuadroRubrica({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const tracos = useRef(0);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="h-40 w-full touch-none rounded-md border border-dashed border-slate-400 bg-slate-50"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const pt = ponto(e);
          desenhando.current = true;
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
        }}
        onPointerMove={(e) => {
          if (!desenhando.current) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const pt = ponto(e);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
          tracos.current += 1;
        }}
        onPointerUp={(e) => {
          if (!desenhando.current) return;
          desenhando.current = false;
          onChange(tracos.current >= 8 ? e.currentTarget.toDataURL('image/png') : null);
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>Assine dentro do quadro.</span>
        <button
          type="button"
          className="text-sky-700 underline"
          onClick={() => {
            const cv = ref.current;
            const ctx = cv?.getContext('2d');
            if (cv && ctx) {
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.clearRect(0, 0, cv.width, cv.height);
              ctx.restore();
            }
            tracos.current = 0;
            onChange(null);
          }}
        >
          limpar
        </button>
      </div>
    </div>
  );
}
