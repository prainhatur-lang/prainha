// Pedido de DELIVERY (iFood ou site) consultado AO VIVO na loja — regra do
// Elison, 14/10/2026 (caso Cíntya, iFood #2576): a Nina respondeu "não consigo
// falar com o entregador" quando o pedido já tinha saído com o nosso motoboy.
// Agora ela olha o sistema antes de responder: recebido, em preparo (KDS),
// pronto, saiu, chegou, entregue, cancelado.
//
// E compara a HORA QUE SAIU com a hora que o cliente reclamou (agora): rota
// longa demais, ou motoboy que marcou "cheguei" e o cliente diz que não
// recebeu (não está achando a casa), vira transferência pra equipe.
//
// Fonte: GET /api/ifood da loja (vendas-local, pelo Funnel) — é onde o pedido
// mora; a nuvem não tem o despacho (o puxador do iFood é a loja). NUNCA puxar
// eventos do iFood daqui: divide a fila e some pedido.
//
// Os horários (saiu_em, chegou_em, despachado_em...) vêm da loja a partir da
// versão que os expõe; loja antiga manda só os booleanos e a ferramenta cai
// na conta pela hora do pedido.

import { caixaUrlDaFilial } from '@/lib/caixa-loja';

export interface CasaDelivery {
  filialId: string;
  filialNome: string;
}

interface PedidoLoja {
  id: string;
  display_id: string | null;
  status: string | null;
  tipo: string | null;
  modo_entrega: string | null;
  origem?: string | null;
  cliente: string | null;
  fone: string | null;
  endereco: string | null;
  itens?: number;
  recebido_em: string | null;
  agendado_para: string | null;
  confirmado?: boolean;
  despachado?: boolean;
  concluido?: boolean;
  cancelado?: boolean;
  cancel_pedido?: boolean;
  // loja nova
  confirmado_em?: string | null;
  despachado_em?: string | null;
  saiu_em?: string | null;
  chegou_em?: string | null;
  concluido_em?: string | null;
  cancelado_em?: string | null;
  entregador?: string | null;
  previsto_em?: string | null;
}

interface Achado {
  casa: CasaDelivery;
  p: PedidoLoja;
}

/** Rota normal do nosso motoboy. Passou disso desde a saída = problema. */
const ROTA_NORMAL_MIN = 30;
/** Folga depois da previsão de entrega que o iFood deu ao cliente. */
const FOLGA_PREVISTO_MIN = 10;
/** Pedido parado sem aceite. */
const SEM_ACEITE_MAX_MIN = 10;
/** Do pedido até sair, sem ter saído. */
const PREPARO_MAX_MIN = 60;
/** Sem horário de saída (loja antiga): do pedido até agora, já saído. */
const TOTAL_SEM_SAIDA_MAX_MIN = 75;
/** Janela de busca por nome/telefone. */
const JANELA_HORAS = 12;

const minDesde = (iso: string | null | undefined, agora: number) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((agora - t) / 60000)) : null;
};

/** HH:MM em Brasília (BRT, sem horário de verão). */
const horaBr = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t - 3 * 3600 * 1000).toISOString().slice(11, 16) : null;
};

const normNome = (s: string | null | undefined) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normNumero = (s: string | null | undefined) => String(s ?? '').toUpperCase().replace(/[#\s.-]/g, '');

const ultimos8 = (s: string | null | undefined) => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
};

async function pedidosDaLoja(filialId: string): Promise<PedidoLoja[] | null> {
  try {
    const base = await caixaUrlDaFilial(filialId);
    if (!base) return null;
    const r = await fetch(`${base}/api/ifood`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { pedidos?: PedidoLoja[] };
    return Array.isArray(j?.pedidos) ? j.pedidos : null;
  } catch (e) {
    console.warn('[nina] pedido delivery: loja não respondeu —', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Itens ainda sem "pronto" no KDS da loja (só praças de verdade: a órfã
 *  nunca marca pronto). null = não deu pra saber. */
async function itensNaCozinha(filialId: string, p: PedidoLoja): Promise<number | null> {
  try {
    const base = await caixaUrlDaFilial(filialId);
    if (!base) return null;
    const ra = await fetch(`${base}/api/areas`, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    if (!ra.ok) return null;
    const ja = (await ra.json()) as { areas?: Array<{ codigo: number | string; orfa?: boolean }> };
    const areas = (ja.areas ?? []).filter((a) => !a.orfa);
    if (!areas.length) return null;
    const rotulo = ((p.origem === 'site' ? 'SITE ' : 'iFood #') + (p.display_id ?? '')).toUpperCase();
    const kds = await Promise.all(
      areas.map(async (a) => {
        try {
          const r = await fetch(`${base}/api/kds?area=${encodeURIComponent(String(a.codigo))}`, {
            signal: AbortSignal.timeout(4000),
            cache: 'no-store',
          });
          if (!r.ok) return null;
          return (await r.json()) as { comandas?: Array<{ nome?: string; itens?: Array<{ pronto_em?: string | null }> }> };
        } catch {
          return null;
        }
      }),
    );
    if (kds.every((k) => k === null)) return null;
    let pendentes = 0;
    for (const k of kds) {
      for (const c of k?.comandas ?? []) {
        const nome = String(c.nome ?? '').toUpperCase();
        if (nome !== rotulo && !nome.startsWith(rotulo + ' ')) continue;
        pendentes += (c.itens ?? []).filter((i) => !i.pronto_em).length;
      }
    }
    return pendentes;
  } catch {
    return null;
  }
}

function nomeBate(alvo: string, nomeLoja: string | null): boolean {
  const a = normNome(alvo).split(' ').filter((t) => t.length > 1);
  const b = normNome(nomeLoja).split(' ').filter((t) => t.length > 1);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a.slice(1).some((t) => b.slice(1).includes(t));
}

const ativo = (p: PedidoLoja) => !p.concluido && !p.cancelado;

function rotuloPedido(p: PedidoLoja) {
  return (p.origem === 'site' ? 'pedido do site ' : 'iFood #') + (p.display_id ?? '?');
}

function situacaoCurta(p: PedidoLoja): string {
  if (p.cancelado) return 'cancelado';
  if (p.concluido) return 'entregue';
  if (p.chegou_em) return 'motoboy no endereço';
  if (p.despachado || p.saiu_em || p.status === 'DISPATCHED') return 'saiu para entrega';
  if (p.status === 'READY_TO_PICKUP') return 'pronto';
  if (p.confirmado) return 'em preparo';
  return 'aguardando aceite';
}

async function detalhar(achado: Achado, agora: number): Promise<string> {
  const { casa, p } = achado;
  const primeiroNome = String(p.cliente ?? '').trim().split(/\s+/)[0] || 'sem nome';
  const feitoMin = minDesde(p.recebido_em, agora);
  const feito = horaBr(p.recebido_em);
  const quem =
    p.tipo === 'TAKEOUT' || p.modo_entrega === 'CLIENTE'
      ? 'RETIRADA no balcão (o cliente busca)'
      : p.modo_entrega === 'IFOOD'
        ? 'entregador do PRÓPRIO iFood (não é nosso motoboy)'
        : 'NOSSO motoboy';
  const linhas: string[] = [
    `PEDIDO ${rotuloPedido(p)} — ${casa.filialNome} — cliente ${primeiroNome}`,
    `Feito às ${feito ?? '?'}${feitoMin != null ? ` (há ${feitoMin} min)` : ''}. Entrega: ${quem}.`,
  ];
  if (p.agendado_para) linhas.push(`AGENDADO para ${horaBr(p.agendado_para) ?? p.agendado_para}.`);
  if (p.previsto_em) linhas.push(`Previsão de entrega que o iFood mostrou ao cliente: ${horaBr(p.previsto_em)}.`);
  // Endereço e entregador NUNCA vão pro cliente — só pro resumo da equipe.
  const interno = [
    p.endereco ? `endereço: ${p.endereco}` : null,
    p.entregador ? `motoboy: ${p.entregador}` : null,
  ].filter(Boolean);
  const notaInterna = interno.length
    ? `(USO INTERNO — não diga ao cliente; ponha no resumo se transferir: ${interno.join(' · ')})`
    : null;

  const fim = (situacao: string, responder: string, acao: string) =>
    [...linhas, `SITUAÇÃO: ${situacao}`, `COMO RESPONDER: ${responder}`, `AÇÃO: ${acao}`, notaInterna]
      .filter(Boolean)
      .join('\n');

  const transferir = (motivo: string) =>
    `chame transferir_para_humano AGORA (motivo: "${motivo}") com resumo: ${rotuloPedido(p)} do ${casa.filialNome}, cliente ${primeiroNome}, o que o cliente disse e os horários acima.`;

  if (p.cancelado || p.cancel_pedido) {
    const quando = horaBr(p.cancelado_em);
    return fim(
      p.cancelado ? `CANCELADO${quando ? ` às ${quando}` : ''}.` : 'há um PEDIDO DE CANCELAMENTO em andamento.',
      'diga com cuidado que o pedido consta como cancelado (ou em cancelamento) no sistema e que a equipe vai verificar com ele.',
      transferir('pedido de delivery cancelado — cliente perguntando'),
    );
  }

  if (p.concluido) {
    const quando = horaBr(p.concluido_em);
    return fim(
      `ENTREGUE / concluído${quando ? ` às ${quando}` : ''}.`,
      'se o cliente diz que NÃO recebeu, não discuta: diga que no sistema consta como entregue e que você já está chamando a equipe pra resolver agora. Se ele só quer confirmar, confirme.',
      `se o cliente diz que não recebeu, ou que veio errado/faltando: ${transferir('delivery consta entregue e cliente diz que não recebeu')} Se está tudo certo, nenhuma.`,
    );
  }

  const saida = p.saiu_em ?? p.despachado_em ?? null;
  const saiu = !!(saida || p.despachado || p.status === 'DISPATCHED');

  if (p.chegou_em) {
    const min = minDesde(p.chegou_em, agora);
    return fim(
      `o motoboy MARCOU QUE CHEGOU no endereço às ${horaBr(p.chegou_em)}${min != null ? ` (há ${min} min)` : ''}, mas a entrega ainda não foi concluída.`,
      `diga que o motoboy marcou que já chegou ao endereço às ${horaBr(p.chegou_em)} e que você está chamando a equipe pra falar com ele agora; peça um ponto de referência e se o cliente pode ir até a porta/portaria.`,
      transferir('motoboy marcou que chegou e cliente não recebeu — pode não estar achando o endereço'),
    );
  }

  if (saiu) {
    const minRota = minDesde(saida, agora);
    const passouPrevisto =
      p.previsto_em != null && (minDesde(p.previsto_em, agora) ?? 0) > FOLGA_PREVISTO_MIN && new Date(p.previsto_em).getTime() < agora;
    const comIfood = p.modo_entrega === 'IFOOD';
    if (minRota == null) {
      // loja antiga: sem hora de saída — mede pela hora do pedido
      const atrasado = (feitoMin != null && feitoMin > TOTAL_SEM_SAIDA_MAX_MIN) || passouPrevisto;
      return fim(
        `SAIU PARA ENTREGA${comIfood ? ' com o entregador do iFood' : ' com o nosso motoboy'} (a loja não informou o horário da saída).`,
        atrasado
          ? `diga que o pedido já saiu para entrega, mas está demorando mais que o normal, por isso você está chamando a equipe pra falar com o ${comIfood ? 'iFood' : 'motoboy'} agora.`
          : `diga que o pedido já saiu para entrega e está a caminho${comIfood ? ' com o entregador do iFood (o app do iFood mostra o trajeto)' : ''}.`,
        atrasado
          ? transferir(`delivery saiu e já são ${feitoMin} min desde o pedido — possível problema na entrega`)
          : 'nenhuma por enquanto. Se o cliente reclamar de demora mesmo assim, ou disser que o motoboy não acha o endereço, transfira (transferir_para_humano).',
      );
    }
    const atrasado = minRota > ROTA_NORMAL_MIN || passouPrevisto;
    return fim(
      `SAIU PARA ENTREGA às ${horaBr(saida)} (há ${minRota} min)${comIfood ? ' com o entregador do iFood' : ' com o nosso motoboy'}.`,
      atrasado
        ? `diga que o pedido saiu às ${horaBr(saida)} e que já está demorando mais que o normal, por isso você está chamando a equipe pra falar com o ${comIfood ? 'iFood' : 'motoboy'} agora.`
        : `diga que o pedido já saiu às ${horaBr(saida)} (há ${minRota} min) com o ${comIfood ? 'entregador do iFood' : 'nosso motoboy'} e está a caminho${comIfood ? ' (o app do iFood mostra o trajeto)' : ''}.`,
      atrasado
        ? transferir(`delivery em rota há ${minRota} min — possível problema na entrega (motoboy sem achar o endereço?)`)
        : `nenhuma — dentro do normal (até ${ROTA_NORMAL_MIN} min de rota). Se o cliente disser que o motoboy não acha o endereço, quer mandar recado pro motoboy, ou reclamar de novo depois, transfira (transferir_para_humano) com o recado no resumo.`,
    );
  }

  if (p.status === 'READY_TO_PICKUP') {
    return fim(
      p.modo_entrega === 'IFOOD' ? 'PRONTO, aguardando o entregador do iFood buscar.' : 'PRONTO para retirada.',
      p.modo_entrega === 'IFOOD'
        ? 'diga que o pedido já está pronto e aguardando o entregador do iFood passar pra buscar.'
        : 'diga que o pedido já está pronto pra retirada no balcão.',
      feitoMin != null && feitoMin > PREPARO_MAX_MIN
        ? transferir(`delivery pronto há muito tempo sem sair (${feitoMin} min desde o pedido)`)
        : 'nenhuma, a não ser que o cliente reclame de demora — aí transfira.',
    );
  }

  if (p.confirmado) {
    const naCozinha = await itensNaCozinha(casa.filialId, p);
    const preparo =
      naCozinha == null
        ? 'EM PREPARO (aceito pela loja).'
        : naCozinha > 0
          ? `EM PREPARO — a cozinha ainda está fazendo ${naCozinha} ite${naCozinha === 1 ? 'm' : 'ns'}.`
          : 'a cozinha JÁ TERMINOU — aguardando o motoboy sair.';
    const demorou = feitoMin != null && feitoMin > PREPARO_MAX_MIN;
    return fim(
      preparo,
      naCozinha === 0
        ? 'diga que o pedido já está pronto e deve sair pra entrega em instantes.'
        : 'diga que o pedido foi aceito e está sendo preparado agora, e que logo sai pra entrega.',
      demorou
        ? transferir(`delivery há ${feitoMin} min sem sair da loja`)
        : 'nenhuma por enquanto. Se o cliente insistir/reclamar, transfira (transferir_para_humano).',
    );
  }

  // PLACED: chegou e ninguém aceitou
  return fim(
    'RECEBIDO, ainda AGUARDANDO A LOJA ACEITAR.',
    'diga que o pedido chegou e está pra ser aceito pela loja.',
    feitoMin != null && feitoMin > SEM_ACEITE_MAX_MIN
      ? transferir(`delivery há ${feitoMin} min sem a loja aceitar`)
      : 'nenhuma por enquanto; se passar de alguns minutos e o cliente insistir, transfira.',
  );
}

/** A ferramenta: acha o pedido (número → telefone do site → nome) nas casas
 *  do grupo e devolve situação + como responder + ação. */
export async function consultarPedidoDelivery(params: {
  casas: CasaDelivery[];
  numero: string | null;
  nome: string | null;
  nomePerfil: string | null;
  telefoneConversa: string;
}): Promise<string> {
  const agora = Date.now();
  const casas = params.casas.filter((c, i, arr) => c.filialId && arr.findIndex((x) => x.filialId === c.filialId) === i);
  const listas = await Promise.all(casas.map(async (casa) => ({ casa, pedidos: await pedidosDaLoja(casa.filialId) })));
  const responderam = listas.filter((l) => l.pedidos !== null);
  if (!responderam.length) {
    return [
      'NÃO CONSEGUI CONSULTAR o sistema da loja agora (sem resposta).',
      'COMO RESPONDER: diga que vai verificar o pedido com a equipe e já retorna. NÃO diga que não tem como falar com o entregador.',
      'AÇÃO: chame transferir_para_humano (motivo: "cliente perguntando de pedido de delivery — sistema da loja fora do ar") com o número/nome do pedido que o cliente deu.',
    ].join('\n');
  }
  const todos: Achado[] = responderam.flatMap((l) => (l.pedidos ?? []).map((p) => ({ casa: l.casa, p })));

  // 1) pelo número do pedido
  const num = normNumero(params.numero);
  if (num) {
    const soDigitos = num.replace(/\D/g, '');
    const porNumero = todos.filter((a) => {
      const d = normNumero(a.p.display_id);
      return d === num || (!!soDigitos && d.replace(/\D/g, '') === soDigitos);
    });
    if (porNumero.length === 1) return detalhar(porNumero[0], agora);
    if (porNumero.length > 1) {
      // mesmo número em casas diferentes: desempata pelo nome
      const alvo = params.nome || params.nomePerfil;
      const doNome = alvo ? porNumero.filter((a) => nomeBate(alvo, a.p.cliente)) : [];
      if (doNome.length === 1) return detalhar(doNome[0], agora);
      return [
        `ACHEI MAIS DE UM pedido com o número ${params.numero}: ${porNumero.map((a) => `${rotuloPedido(a.p)} no ${a.casa.filialNome}`).join('; ')}.`,
        'COMO RESPONDER: pergunte de qual casa é o pedido (ou o nome que está no pedido) e chame a ferramenta de novo.',
      ].join('\n');
    }
    return [
      `NÃO ACHEI pedido com o número ${params.numero} nos últimos 2 dias.`,
      'COMO RESPONDER: peça pra conferir o número no app do iFood (aparece como "Pedido #1234") e o nome que está no pedido.',
      'AÇÃO: se o cliente confirmar o número e mesmo assim não achar, chame transferir_para_humano (motivo: "pedido de delivery não encontrado no sistema").',
    ].join('\n');
  }

  const recente = (a: Achado) => {
    const m = minDesde(a.p.recebido_em, agora);
    return ativo(a.p) || (m != null && m <= JANELA_HORAS * 60);
  };

  // 2) pelo telefone (só pedido do site tem o telefone de verdade; o do iFood
  // vem mascarado 0800)
  const meu8 = ultimos8(params.telefoneConversa);
  if (meu8) {
    const porFone = todos.filter(
      (a) => recente(a) && !String(a.p.fone ?? '').replace(/\D/g, '').startsWith('0800') && ultimos8(a.p.fone) === meu8,
    );
    const ativosFone = porFone.filter((a) => ativo(a.p));
    if (ativosFone.length === 1) return detalhar(ativosFone[0], agora);
    if (porFone.length === 1) return detalhar(porFone[0], agora);
  }

  // 3) pelo nome (o que o cliente disse ou o do perfil do WhatsApp)
  const nomes = [params.nome, params.nomePerfil].filter((n): n is string => !!n && normNome(n).length > 1);
  for (const alvo of nomes) {
    const porNome = todos.filter((a) => recente(a) && nomeBate(alvo, a.p.cliente));
    if (!porNome.length) continue;
    const ativos = porNome.filter((a) => ativo(a.p));
    if (ativos.length === 1) return detalhar(ativos[0], agora);
    if (porNome.length === 1) return detalhar(porNome[0], agora);
    const lista = (ativos.length ? ativos : porNome)
      .slice(0, 5)
      .map((a) => `${rotuloPedido(a.p)} (${a.casa.filialNome}, feito às ${horaBr(a.p.recebido_em) ?? '?'}, ${situacaoCurta(a.p)})`);
    return [
      `ACHEI MAIS DE UM pedido com esse nome: ${lista.join('; ')}.`,
      'COMO RESPONDER: pergunte o número do pedido (aparece no app do iFood como "Pedido #1234") e chame a ferramenta de novo com ele. Não leia a lista inteira pro cliente.',
    ].join('\n');
  }

  const semResposta = listas.filter((l) => l.pedidos === null).map((l) => l.casa.filialNome);
  return [
    'NÃO ACHEI o pedido pelo nome/telefone desta conversa' +
      (semResposta.length ? ` (a loja do ${semResposta.join(', ')} não respondeu)` : '') +
      '.',
    'COMO RESPONDER: peça o número do pedido (aparece no app do iFood como "Pedido #1234") e o nome que está no pedido, e chame a ferramenta de novo.',
    'AÇÃO: se com o número também não achar, chame transferir_para_humano (motivo: "pedido de delivery não encontrado no sistema").',
  ].join('\n');
}
