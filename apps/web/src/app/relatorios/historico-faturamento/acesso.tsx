'use client';

// Senha da aba Histórico de faturamento (VGV): o cadeado (criar, digitar,
// esqueci), a barra de quem já entrou (trancar, trocar) e o cofre, que tira os
// números da tela quando o tempo do passe acaba.
//
// Os campos da senha da aba levam autoComplete="one-time-code" de propósito:
// com "new-password"/"current-password" o navegador oferece guardar essa senha
// por cima da senha de LOGIN do app (é o mesmo site).

import { useLayoutEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BOTAO, BOTAO_PEQUENO, BOTAO_SECUNDARIO, CAMPO, CARTAO, LINK } from './estilos';
import { chamar, telaVelha, type Resposta } from './cliente';

/** Avisa as outras abas do navegador que esta trancou. */
const SINAL_TRANCOU = 'hf_trancou';
/** Guarda de qual passe o cofre já recarregou a página (pra não entrar em laço). */
const SINAL_RECARREGOU = 'hf_recarregou';

function horaBr(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/** Erro pronto pra mostrar; no bloqueio por tentativas, diz até que horas. */
function mensagem(r: Resposta): string {
  const ate = r.dados?.bloqueadoAte;
  if (r.status === 429 && typeof ate === 'number') {
    return `Muitas senhas erradas. Dá pra tentar de novo às ${horaBr(ate)}.`;
  }
  return r.erro;
}

function CampoSenha({
  rotulo,
  valor,
  onChange,
  mostrar,
  ajuda,
  autoFocus,
  autoComplete = 'one-time-code',
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  mostrar: boolean;
  ajuda?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {rotulo}
      <input
        type={mostrar ? 'text' : 'password'}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={200}
        className={`mt-1 block w-full ${CAMPO}`}
      />
      {ajuda && <span className="mt-1 block text-[11px] font-normal text-slate-500">{ajuda}</span>}
    </label>
  );
}

function Mostrar({ valor, onChange }: { valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      Mostrar o que eu digito
    </label>
  );
}

// ---------- Cadeado (aba trancada) ----------

export function Cadeado({
  organizacaoId,
  orgNome,
  temSenha,
  dono,
  bloqueadaAte,
  emailLogin,
  senhaMin,
  horasAberta,
}: {
  organizacaoId: string;
  orgNome: string;
  /** O dono já criou a senha? */
  temSenha: boolean;
  dono: boolean;
  /** 'HH:MM' se a aba está trancada por tentativas erradas. */
  bloqueadaAte: string | null;
  emailLogin: string;
  senhaMin: number;
  horasAberta: number;
}) {
  const [esqueci, setEsqueci] = useState(false);
  const [senha, setSenha] = useState('');
  const [senhaLogin, setSenhaLogin] = useState('');
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState('');

  const tela: 'criar' | 'entrar' | 'esqueci' = !temSenha ? 'criar' : esqueci ? 'esqueci' : 'entrar';

  if (tela === 'criar' && !dono) {
    return (
      <div className={`mx-auto mt-6 max-w-md p-6 ${CARTAO}`}>
        <p className="text-2xl">🔒</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">Aba trancada</h2>
        <p className="mt-2 text-sm text-slate-600">
          O histórico de faturamento de {orgNome} tem senha própria, e o dono ainda não criou essa
          senha. Só ele pode criar.
        </p>
      </div>
    );
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setMsg('');
    let corpo: Record<string, unknown>;
    if (tela === 'entrar') {
      if (!senha) {
        setMsg('Digite a senha.');
        return;
      }
      corpo = { acao: 'entrar', senha };
    } else {
      if (tela === 'esqueci' && !senhaLogin) {
        setMsg('Digite a sua senha de login.');
        return;
      }
      if (nova.length < senhaMin) {
        setMsg(`A senha precisa de pelo menos ${senhaMin} caracteres.`);
        return;
      }
      if (nova !== repetir) {
        setMsg('As duas senhas não são iguais.');
        return;
      }
      corpo =
        tela === 'criar'
          ? { acao: 'definir', senhaNova: nova }
          : { acao: 'redefinir', senhaLogin, senhaNova: nova };
    }
    setEnviando(true);
    const r = await chamar('acesso', { organizacaoId, ...corpo });
    // Abriu — ou a tela ficou velha (a senha foi criada ou trocada em outro
    // aparelho, o login caiu): recarrega inteiro e o servidor desenha o certo.
    if (r.ok || r.status === 409 || telaVelha(r)) {
      window.location.reload();
      return;
    }
    setEnviando(false);
    setMsg(mensagem(r));
    if (tela === 'entrar') setSenha('');
  }

  const titulo =
    tela === 'criar'
      ? 'Crie a senha desta aba'
      : tela === 'esqueci'
        ? 'Criar uma senha nova'
        : 'Aba trancada';

  return (
    <div className={`mx-auto mt-6 max-w-md p-6 ${CARTAO}`}>
      <p className="text-2xl">🔒</p>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">{titulo}</h2>

      {tela === 'criar' && (
        <p className="mt-2 text-sm text-slate-600">
          O histórico de faturamento de {orgNome} fica atrás de uma senha só sua, separada da senha
          de login. Só abre a aba quem souber essa senha.
        </p>
      )}
      {tela === 'entrar' && (
        <p className="mt-2 text-sm text-slate-600">
          Digite a senha do histórico de faturamento de {orgNome}.
        </p>
      )}
      {tela === 'esqueci' && (
        <p className="mt-2 text-sm text-slate-600">
          Confirme que é você com a senha do seu login no app e escolha a senha nova da aba. A senha
          antiga deixa de valer.
        </p>
      )}

      {bloqueadaAte && tela !== 'criar' && !msg && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          Muitas tentativas erradas. A aba fica trancada até {bloqueadaAte}.
        </p>
      )}

      <form onSubmit={enviar} className="mt-4 space-y-3">
        {tela === 'entrar' && (
          <CampoSenha rotulo="Senha da aba" valor={senha} onChange={setSenha} mostrar={mostrar} autoFocus />
        )}
        {tela === 'esqueci' && (
          <>
            <label className="block text-xs font-medium text-slate-700">
              Seu login
              <input
                type="email"
                value={emailLogin}
                readOnly
                autoComplete="username"
                className={`mt-1 block w-full bg-slate-100 text-slate-500 ${CAMPO}`}
              />
            </label>
            <CampoSenha
              rotulo="Sua senha de login no app"
              valor={senhaLogin}
              onChange={setSenhaLogin}
              mostrar={mostrar}
              autoComplete="current-password"
              autoFocus
            />
          </>
        )}
        {tela !== 'entrar' && (
          <>
            <CampoSenha
              rotulo={tela === 'criar' ? 'Senha da aba' : 'Senha nova da aba'}
              valor={nova}
              onChange={setNova}
              mostrar={mostrar}
              ajuda={`Pelo menos ${senhaMin} caracteres.`}
              autoFocus={tela === 'criar'}
            />
            <CampoSenha rotulo="Repita a senha" valor={repetir} onChange={setRepetir} mostrar={mostrar} />
          </>
        )}
        <Mostrar valor={mostrar} onChange={setMostrar} />

        {msg && (
          <p role="alert" className="text-xs text-rose-700">
            {msg}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" disabled={enviando} className={BOTAO}>
            {enviando
              ? 'Abrindo…'
              : tela === 'criar'
                ? 'Criar senha e abrir'
                : tela === 'esqueci'
                  ? 'Trocar senha e abrir'
                  : 'Abrir'}
          </button>
          {tela === 'entrar' && dono && (
            <button
              type="button"
              className={LINK}
              disabled={enviando}
              onClick={() => {
                setEsqueci(true);
                setMsg('');
              }}
            >
              Esqueci a senha
            </button>
          )}
          {tela === 'esqueci' && (
            <button
              type="button"
              className={LINK}
              disabled={enviando}
              onClick={() => {
                setEsqueci(false);
                setMsg('');
              }}
            >
              Voltar
            </button>
          )}
        </div>
      </form>

      <p className="mt-5 text-[11px] leading-relaxed text-slate-400">
        {tela === 'criar'
          ? `O sistema não guarda a senha, só uma conferência dela — ninguém consegue ler. Depois de digitar, a aba fica aberta por ${horasAberta} horas neste aparelho; dá pra trancar antes, trocar a senha e, se esquecer, criar outra com a senha de login.`
          : dono
            ? `Depois de digitar, a aba fica aberta por ${horasAberta} horas neste aparelho. Cinco senhas erradas trancam a aba por alguns minutos.`
            : `Depois de digitar, a aba fica aberta por ${horasAberta} horas neste aparelho. Esqueceu a senha? Só o dono cria outra.`}
      </p>
    </div>
  );
}

// ---------- Barra de quem já entrou ----------

export function BarraAcesso({
  organizacaoId,
  abertaAteRotulo,
  dono,
  senhaMin,
}: {
  organizacaoId: string;
  /** 'HH:MM' (Brasília) em que a aba tranca sozinha. */
  abertaAteRotulo: string;
  dono: boolean;
  senhaMin: number;
}) {
  const router = useRouter();
  const [trocando, setTrocando] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetir, setRepetir] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function trancar() {
    if (enviando) return;
    setEnviando(true);
    setMsg(null);
    const r = await chamar('acesso', { organizacaoId, acao: 'trancar' });
    if (r.ok || telaVelha(r)) {
      try {
        localStorage.setItem(SINAL_TRANCOU, String(Date.now()));
      } catch {
        // sem localStorage: as outras abas trancam no próximo clique
      }
      window.location.reload();
      return;
    }
    setEnviando(false);
    setMsg({ ok: false, texto: r.erro });
  }

  async function trocar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setMsg(null);
    if (!atual) {
      setMsg({ ok: false, texto: 'Digite a senha atual.' });
      return;
    }
    if (nova.length < senhaMin) {
      setMsg({ ok: false, texto: `A senha nova precisa de pelo menos ${senhaMin} caracteres.` });
      return;
    }
    if (nova !== repetir) {
      setMsg({ ok: false, texto: 'As duas senhas novas não são iguais.' });
      return;
    }
    setEnviando(true);
    const r = await chamar('acesso', { organizacaoId, acao: 'trocar', senha: atual, senhaNova: nova });
    if (telaVelha(r) || r.status === 409) {
      window.location.reload();
      return;
    }
    setEnviando(false);
    if (!r.ok) {
      setMsg({ ok: false, texto: mensagem(r) });
      setAtual('');
      return;
    }
    setAtual('');
    setNova('');
    setRepetir('');
    setTrocando(false);
    setMsg({ ok: true, texto: 'Senha trocada. Nos outros aparelhos a aba passa a pedir a senha nova.' });
    router.refresh();
  }

  return (
    <div className="text-right">
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-600">
        <span>🔓 Aberta até {abertaAteRotulo}</span>
        <button
          type="button"
          onClick={trancar}
          disabled={enviando}
          className={BOTAO_PEQUENO}
        >
          Trancar agora
        </button>
        {dono && !trocando && (
          <button
            type="button"
            onClick={() => {
              setTrocando(true);
              setMsg(null);
            }}
            disabled={enviando}
            className={BOTAO_PEQUENO}
          >
            Trocar senha
          </button>
        )}
      </div>

      {trocando && (
        <form onSubmit={trocar} className={`ml-auto mt-2 w-72 space-y-2 p-3 text-left ${CARTAO}`}>
          <CampoSenha rotulo="Senha atual da aba" valor={atual} onChange={setAtual} mostrar={mostrar} autoFocus />
          <CampoSenha
            rotulo="Senha nova"
            valor={nova}
            onChange={setNova}
            mostrar={mostrar}
            ajuda={`Pelo menos ${senhaMin} caracteres.`}
          />
          <CampoSenha rotulo="Repita a senha nova" valor={repetir} onChange={setRepetir} mostrar={mostrar} />
          <Mostrar valor={mostrar} onChange={setMostrar} />
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={enviando} className={BOTAO}>
              {enviando ? 'Trocando…' : 'Trocar'}
            </button>
            <button
              type="button"
              disabled={enviando}
              className={BOTAO_SECUNDARIO}
              onClick={() => {
                setTrocando(false);
                setAtual('');
                setNova('');
                setRepetir('');
                setMsg(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {msg && (
        <p role="status" className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}

// ---------- Cofre ----------

/**
 * Embrulha tudo que só aparece com a aba aberta. Quando o tempo do passe acaba
 * (aba esquecida aberta, computador que voltou do descanso, "voltar" do
 * navegador) tira os números da tela e recarrega — o servidor mostra o cadeado.
 * Também tranca quando outra aba do navegador clicou em "Trancar agora".
 */
export function Cofre({ abertaAte, children }: { abertaAte: number; children: ReactNode }) {
  const [trancando, setTrancando] = useState(false);

  useLayoutEffect(() => {
    const trancar = () => {
      setTrancando(true);
      window.location.reload();
    };
    const conferir = () => {
      if (Date.now() < abertaAte) return;
      // Uma recarga por passe: se o servidor devolveu a aba aberta de novo com o
      // mesmo prazo, é o relógio deste aparelho que está adiantado — quem manda
      // é o servidor, e ele confere o passe a cada gravação.
      let jaRecarregou = true;
      try {
        jaRecarregou = sessionStorage.getItem(SINAL_RECARREGOU) === String(abertaAte);
        if (!jaRecarregou) sessionStorage.setItem(SINAL_RECARREGOU, String(abertaAte));
      } catch {
        // sem sessionStorage não dá pra saber se já recarregou: não arrisca laço
      }
      if (!jaRecarregou) trancar();
    };
    const outraAba = (e: StorageEvent) => {
      if (e.key === SINAL_TRANCOU && e.newValue) trancar();
    };
    conferir();
    const relogio = setInterval(conferir, 15_000);
    document.addEventListener('visibilitychange', conferir);
    window.addEventListener('pageshow', conferir);
    window.addEventListener('storage', outraAba);
    return () => {
      clearInterval(relogio);
      document.removeEventListener('visibilitychange', conferir);
      window.removeEventListener('pageshow', conferir);
      window.removeEventListener('storage', outraAba);
    };
  }, [abertaAte]);

  if (trancando) {
    return <p className="py-16 text-center text-sm text-slate-500">🔒 Trancando a aba…</p>;
  }
  return <>{children}</>;
}
