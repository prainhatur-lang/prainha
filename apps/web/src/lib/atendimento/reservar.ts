// Reserva de mesa criada PELA NINA na conversa do WhatsApp.
//
// Espelha as regras do fluxo público (api/reservar/[token]/confirmar/route.ts):
// data/hora futuras, exceção de calendário, janela de atendimento, área ativa
// sem somenteEventos, horaLimite, alocação da MENOR mesa livre que cabe o
// grupo, teto percentualReserva. Se mudar regra lá, mudar aqui também.
//
// Diferenças deliberadas:
//  - Área com taxaReserva (Lounge, paga por Pix) NÃO é criada por aqui — a
//    Nina explica a taxa e manda o link do site (pagamento não rola no chat).
//  - Telefone é o do próprio WhatsApp da conversa (semOtp por natureza).
//  - canal: 'whatsapp'.

import { db, schema } from '@concilia/db';
import type { AreaReserva, ReservaConfig } from '@concilia/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { registrarAlteracoesReserva } from '@/lib/reservas/alteracoes';
import { mesasOcupadas } from '@/lib/reservas/mesa-disponivel';
import { foraDaJanelaAtendimento, horaMaximaDoDia } from '@/lib/reservas/atendimento';
import {
  enviarConfirmacaoReserva,
  enviarAvisoTolerancia,
  enviarLembreteReserva,
  lembreteReservaConfigurado,
} from '@/lib/whatsapp-otp';

function ehFimDeSemana(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}

function dataBr(ymd: string): string {
  return ymd.split('-').reverse().join('/');
}

// Nomes que NÃO são nome de gente — o modelo já mandou "[Nome do cliente]" e
// "Cliente" como se fossem (14/08/2026: a reserva da Beatriz foi pro painel
// sem nome nenhum, recepção sem saber quem era). Placeholder vira vazio e o
// nome cai pro cadastro do CPF ou pro perfil do WhatsApp.
const NOMES_PLACEHOLDER = new Set([
  'cliente', 'cliente whatsapp', 'o cliente', 'nome', 'nome do cliente', 'nome cliente',
  'seu nome', 'sem nome', 'não informado', 'nao informado', 'n/a', 'na', 'nd', '-', '--',
  'x', 'xx', 'xxx', 'fulano', 'fulano de tal', 'teste', 'test',
]);

/** Nome utilizável, ou '' se veio vazio/placeholder. */
function nomeReal(valor: string | null | undefined): string {
  const s = (valor ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (/^[[<{(]/.test(s)) return ''; // "[Nome do cliente]", "<nome>", "(nome)"
  if (NOMES_PLACEHOLDER.has(s.toLowerCase())) return '';
  if (s.replace(/[^\p{L}]/gu, '').length < 2) return '';
  return s.slice(0, 200);
}

/** Validação padrão de CPF (dígitos verificadores). */
function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += parseInt(d[i], 10) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== parseInt(d[t], 10)) return false;
  }
  return true;
}

/** Resumo de vagas por área numa data — texto pro modelo falar com o cliente. */
export async function consultarDisponibilidade(filialId: string, data: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Data inválida — use o formato YYYY-MM-DD.';
  if (data < hojeBr()) return 'Essa data já passou — peça uma data futura ao cliente.';

  const [filial] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const cfg = filial?.reservaConfig;
  if (!cfg?.areas?.length) return 'Reservas indisponíveis no momento — transfira pra equipe.';

  if (cfg.excecoes?.some((e) => e.data === data && e.fechado)) {
    return `Sem vagas pra ${dataBr(data)} (data fechada pra reservas). Sugira outro dia.`;
  }
  const janela = await foraDaJanelaAtendimento(cfg, data);
  if (janela.bloqueado) return `Não dá pra reservar pra ${dataBr(data)}: ${janela.motivo}`;

  const linhas: string[] = [];
  for (const area of cfg.areas) {
    if (!area.ativo || area.somenteEventos) continue;
    const mesas = (area.mesas ?? []) as Array<{ numero: string | number; lugares: number }>;
    let livres = '';
    if (mesas.length > 0) {
      const ocupadas = await mesasOcupadas({
        filialId,
        data,
        area: area.nome,
        mesasValidas: mesas.map((m) => String(m.numero)),
      });
      const limite =
        typeof area.percentualReserva === 'number'
          ? Math.floor((mesas.length * area.percentualReserva) / 100)
          : mesas.length;
      const disponiveis = Math.max(0, limite - ocupadas.size);
      const maiorMesa = Math.max(...mesas.map((m) => m.lugares));
      const lug = mesas.map((m) => m.lugares).sort((a, b) => a - b);
      const duasMaiores = lug.slice(-2).reduce((s, x) => s + x, 0);
      livres = disponiveis === 0
        ? 'LOTADA'
        : `${disponiveis} mesa(s) disponível(is); maior mesa: ${maiorMesa} pessoas; juntando 2 mesas atende grupo de até ${duasMaiores}`;
    } else {
      livres = 'disponível';
    }
    const taxa = area.taxaReserva
      ? ` — TEM TAXA (R$ ${area.taxaReserva.diasUteis} dia útil / R$ ${area.taxaReserva.sabDom} sáb-dom): NÃO criar por aqui, mandar o link do site`
      : '';
    const limiteHora = area.horaLimite ? ` (reserva só até ${area.horaLimite})` : '';
    linhas.push(`- ${area.nome}: ${livres}${limiteHora}${taxa}`);
  }
  // A janela do dia muda em sáb/dom/feriado (fecha mais cedo) — o modelo
  // precisa saber ANTES de sugerir horário, senão oferece tarde de sábado que
  // a criação vai recusar.
  const maxDoDia = await horaMaximaDoDia(cfg, data);
  let jan = '';
  if (cfg.atendimento && maxDoDia) {
    jan = `Horários aceitos NESSE DIA: ${cfg.atendimento.inicio} às ${maxDoDia}. `;
    if (maxDoDia !== cfg.atendimento.fim) {
      jan += `(sábado, domingo e feriado a reserva vai só até ${maxDoDia} — depois disso é por ordem de chegada, convide a pessoa a vir direto). `;
    }
  }
  return `Disponibilidade pra ${dataBr(data)}:\n${linhas.join('\n')}\n${jan}Reserva comum é gratuita hoje.`;
}

/** Onde fica uma mesa (área + lugares) — pra "mesa X fica em qual parte?". */
export async function consultarMesa(filialId: string, numeroMesa: string): Promise<string> {
  const num = (numeroMesa ?? '').replace(/\D/g, '');
  if (!num) return 'Número de mesa inválido — pergunte o número ao cliente.';
  const [filial] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const areas = filial?.reservaConfig?.areas ?? [];
  for (const a of areas) {
    const mesas = (a.mesas ?? []) as Array<{ numero: string | number; lugares: number }>;
    const m = mesas.find((x) => String(x.numero) === num);
    if (m) {
      return `Mesa ${num}: fica na área ${a.nome}, com ${m.lugares} lugares.${a.somenteEventos ? ' (área reservada só pra eventos)' : ''}`;
    }
  }
  return `Mesa ${num} não está no mapa de reservas. Áreas e faixas: ${areas
    .filter((a) => (a.mesas ?? []).length > 0)
    .map((a) => `${a.nome} (${(a.mesas ?? [])[0]?.numero}–${(a.mesas ?? []).slice(-1)[0]?.numero})`)
    .join(', ')}. Confirme o número com o cliente ou transfira.`;
}

/** Reservas ativas (pendente/confirmada, de hoje em diante) do MESMO telefone
 *  da conversa — a mesma garantia do botão "cancelar" do lembrete: só quem tem
 *  o zap da reserva mexe nela. Usada por cancelar e remarcar. */
async function reservasAtivasDoTelefone(filialId: string, telefone: string) {
  const suf = telefone.replace(/\D/g, '').slice(-8);
  if (suf.length < 8) return null;
  return db
    .select({
      id: schema.reserva.id,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      area: schema.reserva.area,
      mesa: schema.reserva.mesa,
      mesaJuntada: schema.reserva.mesaJuntada,
      pessoas: schema.reserva.pessoas,
      status: schema.reserva.status,
      nome: schema.reserva.clienteNome,
      cancelToken: schema.reserva.cancelToken,
    })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, filialId),
        sql`right(regexp_replace(${schema.reserva.clienteTelefone}, '\\D', '', 'g'), 8) = ${suf}`,
        sql`${schema.reserva.status} IN ('pendente', 'confirmada')`,
        sql`${schema.reserva.data} >= current_date`,
      ),
    )
    .orderBy(schema.reserva.data, schema.reserva.hora)
    .limit(5);
}

/** Cancela reserva ativa (pendente/confirmada, de hoje em diante) do MESMO
 *  telefone da conversa. data desambigua se houver várias.
 *  ATENÇÃO: pra MUDAR horário/dia/pessoas use remarcarReservaWhatsApp — cancelar
 *  e criar de novo já deixou cliente sem mesa no meio do caminho (15/08). */
export async function cancelarReservaWhatsApp(p: {
  filialId: string;
  telefone: string;
  data?: string | null;
}): Promise<string> {
  const ativas = await reservasAtivasDoTelefone(p.filialId, p.telefone);
  if (ativas === null) return 'Telefone da conversa inválido — transfira pra equipe.';

  if (ativas.length === 0) {
    return 'Nenhuma reserva ativa encontrada neste telefone (pode já ter sido cancelada ou liberada por atraso). Se o cliente garantir que tem, transfira pra equipe.';
  }

  let alvo = ativas[0];
  if (p.data) {
    const daData = ativas.filter((r) => String(r.data) === p.data);
    if (daData.length === 0) {
      return `Não achei reserva ativa em ${dataBr(p.data)}. As ativas são: ${ativas.map((r) => `${dataBr(String(r.data))} às ${r.hora} (${r.area})`).join('; ')}. Pergunte qual o cliente quer cancelar.`;
    }
    alvo = daData[0];
  } else if (ativas.length > 1) {
    return `O cliente tem ${ativas.length} reservas ativas: ${ativas.map((r) => `${dataBr(String(r.data))} às ${r.hora} (${r.area}, ${r.pessoas} pessoas)`).join('; ')}. Pergunte QUAL cancelar e chame de novo com a data.`;
  }

  await db
    .update(schema.reserva)
    .set({ status: 'cancelada', atualizadoEm: sql`now()` })
    .where(eq(schema.reserva.id, alvo.id));
  await registrarAlteracoesReserva(
    alvo.id,
    { status: alvo.status },
    { status: 'cancelada' },
    { tipo: 'cliente', nome: 'cliente via Nina (WhatsApp)' },
  );

  const mesas = alvo.mesaJuntada ? `mesas ${alvo.mesa} + ${alvo.mesaJuntada}` : alvo.mesa ? `mesa ${alvo.mesa}` : 'mesa';
  return `RESERVA CANCELADA: ${dataBr(String(alvo.data))} às ${alvo.hora}, ${alvo.area} (${mesas}), em nome de ${alvo.nome ?? 'cliente'}. A mesa foi liberada. Confirme ao cliente com carinho e diga que quando quiser voltar é só chamar aqui que você reserva na hora.`;
}

interface SlotAlocado {
  areaCfg: AreaReserva;
  mesa: string | null;
  mesaJuntada: string | null;
}

/** Todas as regras de "esse horário/área aceita reserva?" + alocação da mesa,
 *  compartilhadas entre criar e remarcar (o site faz o mesmo em
 *  api/reservar/[token]/confirmar). Devolve string = bloqueio pronto pro
 *  modelo falar; objeto = pode gravar.
 *  `excluirReservaId`: na remarcação, a própria reserva não briga com a mesa
 *  que ela já ocupa. */
async function validarSlotEAlocarMesa(p: {
  filialId: string;
  cfg: ReservaConfig;
  data: string;
  hora: string;
  pessoas: number;
  area: string;
  excluirReservaId?: string;
}): Promise<string | SlotAlocado> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) return 'Data inválida (use YYYY-MM-DD).';
  if (!/^\d{2}:\d{2}$/.test(p.hora)) return 'Hora inválida (use HH:MM).';
  if (p.data < hojeBr()) return 'Essa data já passou. Peça uma data futura.';
  if (p.data === hojeBr()) {
    const agora = horaAgoraBr();
    const [h1, m1] = p.hora.split(':').map(Number);
    const [h0, m0] = agora.split(':').map(Number);
    const minutosAte = h1 * 60 + m1 - (h0 * 60 + m0);
    // Regra da casa (Elison 14/08): em cima da hora não se reserva mais —
    // o cliente vem direto e a recepção acomoda na mesa disponível.
    if (minutosAte < 60) {
      return 'Em cima da hora não fazemos mais reserva pra hoje (mínimo 1 hora de antecedência). Oriente o cliente: é só vir direto — na recepção ele escolhe uma mesa disponível na chegada. Reservar não é obrigatório, e o pôr do sol é por ordem de chegada.';
    }
  }

  if (p.cfg.excecoes?.some((e) => e.data === p.data && e.fechado)) {
    return `Sem vagas pra ${dataBr(p.data)} (data fechada). Ofereça outro dia.`;
  }
  const janela = await foraDaJanelaAtendimento(p.cfg, p.data, p.hora);
  if (janela.bloqueado) {
    return `Bloqueado: ${janela.motivo} Se o pedido era pra HOJE, oriente: pode vir direto — na recepção o cliente escolhe uma mesa disponível na chegada (reservar não é obrigatório).`;
  }

  const areaCfg = p.cfg.areas.find((a) => a.nome.toLowerCase() === p.area.trim().toLowerCase());
  if (!areaCfg || !areaCfg.ativo || areaCfg.somenteEventos) {
    const validas = p.cfg.areas.filter((a) => a.ativo && !a.somenteEventos).map((a) => a.nome).join(', ');
    return `Área "${p.area}" indisponível. Áreas válidas: ${validas}.`;
  }
  if (areaCfg.taxaReserva) {
    const valor = ehFimDeSemana(p.data) ? areaCfg.taxaReserva.sabDom : areaCfg.taxaReserva.diasUteis;
    return `${areaCfg.nome} tem taxa de R$ ${valor} paga por Pix — NÃO dá pra fechar por aqui. Explique a taxa e mande o cliente concluir em reservas.prainhabar.com.`;
  }
  if (areaCfg.horaLimite && p.hora > areaCfg.horaLimite) {
    return `${areaCfg.nome} aceita reserva só até ${areaCfg.horaLimite}. Sugira um horário até essa hora.`;
  }

  // Alocação de mesa — menor mesa livre que cabe o grupo (regra do site).
  // Grupo maior que qualquer mesa: JUNTA DUAS mesas (mesa + mesaJuntada, o
  // mesmo recurso que a recepção usa no admin). 3+ mesas = equipe.
  const mesas = (areaCfg.mesas ?? []) as Array<{ numero: string | number; lugares: number }>;
  if (mesas.length === 0) return { areaCfg, mesa: null, mesaJuntada: null };

  const ocupadas = await mesasOcupadas({
    filialId: p.filialId,
    data: p.data,
    area: areaCfg.nome,
    mesasValidas: mesas.map((m) => String(m.numero)),
    excluirReservaId: p.excluirReservaId,
  });
  const limite =
    typeof areaCfg.percentualReserva === 'number'
      ? Math.floor((mesas.length * areaCfg.percentualReserva) / 100)
      : mesas.length;
  if (ocupadas.size >= limite) {
    return `${areaCfg.nome} lotada pra ${dataBr(p.data)}. Ofereça outra área ou outro dia.`;
  }
  const ordenadas = mesas.slice().sort((a, b) => a.lugares - b.lugares);
  const livres = ordenadas.filter((m) => !ocupadas.has(String(m.numero)));
  const unica = livres.find((m) => m.lugares >= p.pessoas);
  if (unica) return { areaCfg, mesa: String(unica.numero), mesaJuntada: null };

  // Tenta juntar DUAS mesas livres (par de menor capacidade que atende).
  let par: [(typeof livres)[number], (typeof livres)[number]] | null = null;
  if (limite - ocupadas.size >= 2) {
    for (let i = 0; i < livres.length; i++) {
      for (let j = i + 1; j < livres.length; j++) {
        const soma = livres[i].lugares + livres[j].lugares;
        if (soma >= p.pessoas && (!par || soma < par[0].lugares + par[1].lugares)) {
          par = [livres[i], livres[j]];
        }
      }
    }
  }
  if (par) return { areaCfg, mesa: String(par[0].numero), mesaJuntada: String(par[1].numero) };

  const duasMaiores = ordenadas.slice(-2).reduce((s, m) => s + m.lugares, 0);
  if (p.pessoas > duasMaiores) {
    return `Grupo de ${p.pessoas} não cabe em ${areaCfg.nome} nem juntando 2 mesas (máximo juntando duas: ${duasMaiores}). Ofereça outra área com mesas maiores ou transfira pra equipe (3 mesas ou mais é com humanos).`;
  }
  return `${areaCfg.nome} sem mesas suficientes livres pra ${p.pessoas} pessoas em ${dataBr(p.data)}. Ofereça outra área ou outro dia.`;
}

export interface DadosCriarReserva {
  filialId: string;
  filialNome: string;
  telefone: string; // digitos com DDI (from da conversa)
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  pessoas: number;
  area: string;
  /** CPF de quem reserva (preferido — o nome sai do cadastro). */
  cpf?: string | null;
  /** Nome: só quando o cliente não quer dar CPF, ou pra reserva em outro nome. */
  nome?: string | null;
  /** Nome do perfil do WhatsApp (fallback de exibição). */
  nomePerfil?: string | null;
  observacao?: string | null;
}

/** Cria a reserva com as MESMAS validações do site. Retorna texto pro modelo
 *  (sucesso com resumo, ou o motivo do bloqueio pra oferecer alternativa). */
export async function criarReservaWhatsApp(p: DadosCriarReserva): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) return 'Data inválida (use YYYY-MM-DD).';
  if (!/^\d{2}:\d{2}$/.test(p.hora)) return 'Hora inválida (use HH:MM).';
  const pessoas = Math.min(Math.max(Math.round(p.pessoas), 1), 99);

  // Identificação: CPF preferido (nome sai do cadastro do cliente); nome só
  // como fallback. Regra do Elison 14/08 — reserva sem identificação não sai.
  const cpfDigitos = (p.cpf ?? '').replace(/\D/g, '');
  let clienteCpf: string | null = null;
  let nome = nomeReal(p.nome);
  if (cpfDigitos) {
    if (!cpfValido(cpfDigitos)) {
      return 'CPF inválido (dígito verificador não bate) — peça pro cliente conferir os 11 dígitos.';
    }
    clienteCpf = cpfDigitos;
    if (!nome) {
      const [cli] = (await db.execute(sql`
        SELECT nome FROM cliente
        WHERE filial_id = ${p.filialId}
          AND data_delete IS NULL
          AND regexp_replace(coalesce(cpf_ou_cnpj, ''), '\\D', '', 'g') = ${cpfDigitos}
        LIMIT 1
      `)) as unknown as Array<{ nome: string | null }>;
      if (cli?.nome?.trim()) nome = nomeReal(cli.nome);
    }
  }
  // Sem nome dito: usa o nome do perfil do WhatsApp (é de quem está falando).
  if (!nome) nome = nomeReal(p.nomePerfil);
  if (!clienteCpf && !nome) {
    return 'Falta identificar a reserva: peça o CPF do cliente (preferido — o nome sai do cadastro). Se ele não quiser informar, peça o nome DE VERDADE — nunca escreva "Cliente" nem coisa parecida no lugar do nome.';
  }
  if (!nome) nome = 'Cliente WhatsApp';

  const [filial] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);
  const cfg = filial?.reservaConfig;
  if (!cfg?.areas?.length) return 'Reservas indisponíveis no momento — transfira pra equipe.';

  // Já tem mesa nesse dia? (14/08/2026: a Nina criou DUAS reservas com 18s de
  // diferença na mesma conversa, e a cliente já tinha uma feita pelo site —
  // 3 mesas presas pro mesmo grupo de 3 pessoas.) Compara pelos 8 últimos
  // dígitos, então pega também a reserva feita por outro canal.
  const sufTel = p.telefone.replace(/\D/g, '').slice(-8);
  if (sufTel.length === 8) {
    const [jaTem] = await db
      .select({ hora: schema.reserva.hora, area: schema.reserva.area, mesa: schema.reserva.mesa, canal: schema.reserva.canal })
      .from(schema.reserva)
      .where(
        and(
          eq(schema.reserva.filialId, p.filialId),
          eq(schema.reserva.data, p.data),
          sql`right(regexp_replace(${schema.reserva.clienteTelefone}, '\\D', '', 'g'), 8) = ${sufTel}`,
          sql`${schema.reserva.status} IN ('pendente', 'confirmada', 'sentada')`,
        ),
      )
      .limit(1);
    if (jaTem) {
      return `NÃO CRIEI: esse telefone JÁ TEM reserva ativa em ${dataBr(p.data)} às ${String(jaTem.hora).slice(0, 5)} na ${jaTem.area}${jaTem.mesa ? ` (mesa ${jaTem.mesa})` : ''}${jaTem.canal && jaTem.canal !== 'whatsapp' ? ` — feita pelo ${jaTem.canal}` : ''}. Confirme ao cliente que a mesa dele já está garantida. Se ele quer MUDAR horário/pessoas/área, use remarcar_reserva; se quer de verdade uma SEGUNDA mesa pra outro grupo, transfira pra equipe.`;
    }
  }

  const slot = await validarSlotEAlocarMesa({
    filialId: p.filialId,
    cfg,
    data: p.data,
    hora: p.hora,
    pessoas,
    area: p.area,
  });
  if (typeof slot === 'string') return slot;
  const { areaCfg, mesa: mesaAlocada, mesaJuntada: mesaJuntadaAlocada } = slot;

  const valorAtual = typeof cfg.valorAtual === 'number' ? cfg.valorAtual : 0;
  const cancelToken = randomBytes(24).toString('hex');

  await db.insert(schema.reserva).values({
    filialId: p.filialId,
    clienteNome: nome,
    clienteTelefone: p.telefone,
    clienteCpf,
    pessoas,
    data: p.data,
    hora: p.hora,
    status: 'pendente',
    area: areaCfg.nome,
    mesa: mesaAlocada,
    mesaJuntada: mesaJuntadaAlocada,
    canal: 'whatsapp',
    observacao: p.observacao?.trim() ? `${p.observacao.trim().slice(0, 1900)} (via Nina)` : 'Reserva feita pela Nina (WhatsApp)',
    valor: String(valorAtual.toFixed(2)),
    cancelToken,
  });

  // Mesmos disparos do site: confirmação rica + tolerância; se for pra HOJE,
  // o lembrete com botões de confirmar/cancelar (cron da véspera não alcança).
  try {
    const [a, m, d] = p.data.split('-');
    const ok = await enviarConfirmacaoReserva(p.telefone, {
      nome,
      data: `${d}/${m}/${a}`,
      hora: p.hora,
      local: areaCfg.nome,
      pessoas: String(pessoas),
      linkCancelar: `https://app.prainhabar.com/reservar/cancelar/${cancelToken}`,
    });
    if (ok) await enviarAvisoTolerancia(p.telefone, nome);
    if (p.data === hojeBr() && lembreteReservaConfigurado()) {
      await enviarLembreteReserva(p.telefone, {
        nome: nome.split(' ')[0] || 'tudo bem',
        data: `${d}/${m}/${a}`,
        hora: p.hora,
        local: `${p.filialNome} · ${areaCfg.nome}`,
        token: cancelToken,
      });
    }
  } catch {
    // best-effort — a reserva já está criada
  }

  // CPF novo e cadastro do cliente sem CPF: mesmo write-back do site
  // (agente atualiza o Consumer). Best-effort, nunca trava a reserva.
  if (clienteCpf) {
    try {
      const local = p.telefone.slice(-11);
      const [cli] = (await db.execute(sql`
        SELECT codigo_externo, cpf_ou_cnpj FROM cliente
        WHERE filial_id = ${p.filialId} AND data_delete IS NULL
          AND regexp_replace(coalesce(telefone, ''), '\\D', '', 'g') LIKE ${'%' + local}
        LIMIT 1
      `)) as unknown as Array<{ codigo_externo: number | null; cpf_ou_cnpj: string | null }>;
      if (cli && cli.codigo_externo && !cli.cpf_ou_cnpj?.trim()) {
        await db.insert(schema.agenteComando).values({
          filialId: p.filialId,
          tipo: 'atualizar_cliente',
          payload: { codigoExterno: cli.codigo_externo, campos: { cnpjOuCpf: clienteCpf } },
        });
      }
    } catch {
      // write-back é bônus
    }
  }

  const mesaTxt = mesaJuntadaAlocada
    ? ` (mesas ${mesaAlocada} + ${mesaJuntadaAlocada} juntadas pro grupo)`
    : mesaAlocada
      ? ` (mesa ${mesaAlocada})`
      : '';
  const cpfTxt = clienteCpf ? ` (CPF final ${clienteCpf.slice(-3)})` : '';
  return `RESERVA CRIADA: ${dataBr(p.data)} às ${p.hora}, ${pessoas} pessoa(s), ${areaCfg.nome}${mesaTxt}, em nome de ${nome}${cpfTxt}. Gratuita. Confirme ao cliente em uma frase (cite o nome; do CPF, no máximo os 3 últimos dígitos) e avise que a mesa fica guardada por 15 minutos após o horário.`;
}

/** Remarca a reserva EXISTENTE (hora, dia, pessoas e/ou área) — a mesma
 *  reserva muda de lugar, sem passar por "cancela e cria de novo".
 *
 *  Por que existe (15/08/2026): a Nina cancelava e só DEPOIS ia criar a nova;
 *  numa conversa real ela cancelou a de 13h, mandou "me avisa que faço na
 *  hora" e nunca criou — cliente ficou sem mesa e a mesa foi pro estoque.
 *  Aqui, se o horário novo não der, NADA muda: a reserva antiga continua de pé
 *  e a Nina oferece outra opção. */
export async function remarcarReservaWhatsApp(p: {
  filialId: string;
  filialNome: string;
  telefone: string;
  /** Data da reserva ATUAL, pra desambiguar quando o cliente tem várias. */
  dataAtual?: string | null;
  novaData?: string | null;
  novaHora?: string | null;
  novasPessoas?: number | null;
  novaArea?: string | null;
}): Promise<string> {
  const ativas = await reservasAtivasDoTelefone(p.filialId, p.telefone);
  if (ativas === null) return 'Telefone da conversa inválido — transfira pra equipe.';
  if (ativas.length === 0) {
    return 'Nenhuma reserva ativa neste telefone pra remarcar (pode já ter sido cancelada ou liberada por atraso). Se o cliente garantir que tem, transfira pra equipe.';
  }

  let alvo = ativas[0];
  if (p.dataAtual) {
    const daData = ativas.filter((r) => String(r.data) === p.dataAtual);
    if (daData.length === 0) {
      return `Não achei reserva ativa em ${dataBr(p.dataAtual)}. As ativas são: ${ativas.map((r) => `${dataBr(String(r.data))} às ${r.hora} (${r.area})`).join('; ')}. Pergunte qual o cliente quer remarcar.`;
    }
    alvo = daData[0];
  } else if (ativas.length > 1) {
    return `O cliente tem ${ativas.length} reservas ativas: ${ativas.map((r) => `${dataBr(String(r.data))} às ${r.hora} (${r.area}, ${r.pessoas} pessoas)`).join('; ')}. Pergunte QUAL remarcar e chame de novo com a data atual dela.`;
  }

  const data = p.novaData?.trim() || String(alvo.data);
  const hora = (p.novaHora?.trim() || String(alvo.hora)).slice(0, 5);
  const pessoas = p.novasPessoas && p.novasPessoas > 0 ? Math.min(Math.round(p.novasPessoas), 99) : alvo.pessoas;
  const area = p.novaArea?.trim() || alvo.area || '';
  if (!area) return 'Essa reserva está sem área definida no sistema — transfira pra equipe ajustar.';
  const horaAtual = String(alvo.hora).slice(0, 5);
  if (data === String(alvo.data) && hora === horaAtual && pessoas === alvo.pessoas && area === alvo.area) {
    return 'Nada mudou nessa reserva (mesmo dia, hora, pessoas e área). Confirme com o cliente o que ele quer mudar.';
  }

  const [filial] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);
  const cfg = filial?.reservaConfig;
  if (!cfg?.areas?.length) return 'Reservas indisponíveis no momento — transfira pra equipe.';

  const slot = await validarSlotEAlocarMesa({
    filialId: p.filialId,
    cfg,
    data,
    hora,
    pessoas,
    area,
    excluirReservaId: alvo.id,
  });
  if (typeof slot === 'string') {
    // Nada foi alterado — a reserva antiga continua valendo.
    return `NÃO REMARQUEI (a reserva de ${dataBr(String(alvo.data))} às ${horaAtual} CONTINUA DE PÉ): ${slot} Diga isso ao cliente e ofereça alternativa — não deixe ele achar que ficou sem mesa.`;
  }

  await db
    .update(schema.reserva)
    .set({
      data,
      hora,
      pessoas,
      area: slot.areaCfg.nome,
      mesa: slot.mesa,
      mesaJuntada: slot.mesaJuntada,
      atualizadoEm: sql`now()`,
    })
    .where(eq(schema.reserva.id, alvo.id));
  await registrarAlteracoesReserva(
    alvo.id,
    { data: String(alvo.data), hora: horaAtual, pessoas: alvo.pessoas, area: alvo.area, mesa: alvo.mesa, mesaJuntada: alvo.mesaJuntada },
    { data, hora, pessoas, area: slot.areaCfg.nome, mesa: slot.mesa, mesaJuntada: slot.mesaJuntada },
    { tipo: 'cliente', nome: 'cliente via Nina (WhatsApp)' },
  );

  // Confirmação nova (mesmo cancelToken — o link de cancelar continua valendo).
  const nome = alvo.nome ?? 'Cliente';
  try {
    const [a, m, d] = data.split('-');
    await enviarConfirmacaoReserva(p.telefone, {
      nome,
      data: `${d}/${m}/${a}`,
      hora,
      local: slot.areaCfg.nome,
      pessoas: String(pessoas),
      linkCancelar: alvo.cancelToken ? `https://app.prainhabar.com/reservar/cancelar/${alvo.cancelToken}` : '',
    });
    if (data === hojeBr() && alvo.cancelToken && lembreteReservaConfigurado()) {
      await enviarLembreteReserva(p.telefone, {
        nome: nome.split(' ')[0] || 'tudo bem',
        data: `${d}/${m}/${a}`,
        hora,
        local: `${p.filialNome} · ${slot.areaCfg.nome}`,
        token: alvo.cancelToken,
      });
    }
  } catch {
    // best-effort — a remarcação já está gravada
  }

  const mesaTxt = slot.mesaJuntada
    ? ` (mesas ${slot.mesa} + ${slot.mesaJuntada} juntadas)`
    : slot.mesa
      ? ` (mesa ${slot.mesa})`
      : '';
  return `RESERVA REMARCADA: era ${dataBr(String(alvo.data))} às ${horaAtual} (${alvo.area}), agora é ${dataBr(data)} às ${hora}, ${pessoas} pessoa(s), ${slot.areaCfg.nome}${mesaTxt}, em nome de ${nome}. É a MESMA reserva — não precisa criar outra. Confirme ao cliente em uma frase e lembre que a mesa fica guardada por 15 minutos após o horário.`;
}
