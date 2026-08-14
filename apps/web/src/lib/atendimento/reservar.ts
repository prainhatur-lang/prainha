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
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { registrarAlteracoesReserva } from '@/lib/reservas/alteracoes';
import { mesasOcupadas } from '@/lib/reservas/mesa-disponivel';
import { foraDaJanelaAtendimento } from '@/lib/reservas/atendimento';
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
  const jan = cfg.atendimento ? `Horários aceitos: ${cfg.atendimento.inicio} às ${cfg.atendimento.fim}. ` : '';
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

/** Cancela reserva ativa (pendente/confirmada, de hoje em diante) do MESMO
 *  telefone da conversa — a mesma garantia do botão "cancelar" do lembrete
 *  (só quem tem o zap da reserva cancela). data desambigua se houver várias. */
export async function cancelarReservaWhatsApp(p: {
  filialId: string;
  telefone: string;
  data?: string | null;
}): Promise<string> {
  const suf = p.telefone.replace(/\D/g, '').slice(-8);
  if (suf.length < 8) return 'Telefone da conversa inválido — transfira pra equipe.';

  const ativas = await db
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
    })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, p.filialId),
        sql`right(regexp_replace(${schema.reserva.clienteTelefone}, '\\D', '', 'g'), 8) = ${suf}`,
        sql`${schema.reserva.status} IN ('pendente', 'confirmada')`,
        sql`${schema.reserva.data} >= current_date`,
      ),
    )
    .orderBy(schema.reserva.data, schema.reserva.hora)
    .limit(5);

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

export interface DadosCriarReserva {
  filialId: string;
  filialNome: string;
  telefone: string; // digitos com DDI (from da conversa)
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  pessoas: number;
  area: string;
  nome: string;
  observacao?: string | null;
}

/** Cria a reserva com as MESMAS validações do site. Retorna texto pro modelo
 *  (sucesso com resumo, ou o motivo do bloqueio pra oferecer alternativa). */
export async function criarReservaWhatsApp(p: DadosCriarReserva): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) return 'Data inválida (use YYYY-MM-DD).';
  if (!/^\d{2}:\d{2}$/.test(p.hora)) return 'Hora inválida (use HH:MM).';
  const pessoas = Math.min(Math.max(Math.round(p.pessoas), 1), 99);
  const nome = p.nome.trim().slice(0, 200);
  if (!nome) return 'Falta o nome de quem reserva — pergunte ao cliente.';

  if (p.data < hojeBr()) return 'Essa data já passou. Peça uma data futura.';
  if (p.data === hojeBr() && p.hora < horaAgoraBr()) {
    return 'Essa hora já passou hoje. Peça um horário mais tarde ou outro dia.';
  }

  const [filial] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);
  const cfg = filial?.reservaConfig;
  if (!cfg?.areas?.length) return 'Reservas indisponíveis no momento — transfira pra equipe.';

  if (cfg.excecoes?.some((e) => e.data === p.data && e.fechado)) {
    return `Sem vagas pra ${dataBr(p.data)} (data fechada). Ofereça outro dia.`;
  }
  const janela = await foraDaJanelaAtendimento(cfg, p.data, p.hora);
  if (janela.bloqueado) return `Bloqueado: ${janela.motivo}`;

  const areaCfg = cfg.areas.find((a) => a.nome.toLowerCase() === p.area.trim().toLowerCase());
  if (!areaCfg || !areaCfg.ativo || areaCfg.somenteEventos) {
    const validas = cfg.areas.filter((a) => a.ativo && !a.somenteEventos).map((a) => a.nome).join(', ');
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
  let mesaAlocada: string | null = null;
  let mesaJuntadaAlocada: string | null = null;
  const mesas = (areaCfg.mesas ?? []) as Array<{ numero: string | number; lugares: number }>;
  if (mesas.length > 0) {
    const ocupadas = await mesasOcupadas({
      filialId: p.filialId,
      data: p.data,
      area: areaCfg.nome,
      mesasValidas: mesas.map((m) => String(m.numero)),
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
    const unica = livres.find((m) => m.lugares >= pessoas);
    if (unica) {
      mesaAlocada = String(unica.numero);
    } else {
      // Tenta juntar DUAS mesas livres (par de menor capacidade que atende).
      let par: [typeof livres[number], typeof livres[number]] | null = null;
      if (limite - ocupadas.size >= 2) {
        for (let i = 0; i < livres.length; i++) {
          for (let j = i + 1; j < livres.length; j++) {
            const soma = livres[i].lugares + livres[j].lugares;
            if (soma >= pessoas && (!par || soma < par[0].lugares + par[1].lugares)) {
              par = [livres[i], livres[j]];
            }
          }
        }
      }
      if (par) {
        mesaAlocada = String(par[0].numero);
        mesaJuntadaAlocada = String(par[1].numero);
      } else {
        const duasMaiores = ordenadas.slice(-2).reduce((s, m) => s + m.lugares, 0);
        if (pessoas > duasMaiores) {
          return `Grupo de ${pessoas} não cabe em ${areaCfg.nome} nem juntando 2 mesas (máximo juntando duas: ${duasMaiores}). Ofereça outra área com mesas maiores ou transfira pra equipe (3 mesas ou mais é com humanos).`;
        }
        return `${areaCfg.nome} sem mesas suficientes livres pra ${pessoas} pessoas em ${dataBr(p.data)}. Ofereça outra área ou outro dia.`;
      }
    }
  }

  const valorAtual = typeof cfg.valorAtual === 'number' ? cfg.valorAtual : 0;
  const cancelToken = randomBytes(24).toString('hex');

  await db.insert(schema.reserva).values({
    filialId: p.filialId,
    clienteNome: nome,
    clienteTelefone: p.telefone,
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

  const mesaTxt = mesaJuntadaAlocada
    ? ` (mesas ${mesaAlocada} + ${mesaJuntadaAlocada} juntadas pro grupo)`
    : mesaAlocada
      ? ` (mesa ${mesaAlocada})`
      : '';
  return `RESERVA CRIADA: ${dataBr(p.data)} às ${p.hora}, ${pessoas} pessoa(s), ${areaCfg.nome}${mesaTxt}, em nome de ${nome}. Gratuita. Confirme ao cliente em uma frase e avise que a mesa fica guardada por 15 minutos após o horário.`;
}
