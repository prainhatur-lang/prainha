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
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
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
      livres = disponiveis === 0
        ? 'LOTADA'
        : `${disponiveis} mesa(s) disponível(is), maior mesa comporta ${maiorMesa} pessoas`;
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

  // Alocação de mesa — mesma regra do site: menor mesa livre que cabe o grupo.
  let mesaAlocada: string | null = null;
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
    const cabem = ordenadas.filter((m) => m.lugares >= pessoas);
    if (cabem.length === 0) {
      return `Não há mesa pra ${pessoas} pessoas em ${areaCfg.nome} (grupos grandes: transfira pra equipe avaliar juntar mesas).`;
    }
    const livre = cabem.find((m) => !ocupadas.has(String(m.numero)));
    if (!livre) {
      return `${areaCfg.nome} lotada pra ${dataBr(p.data)}. Ofereça outra área ou outro dia.`;
    }
    mesaAlocada = String(livre.numero);
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

  return `RESERVA CRIADA: ${dataBr(p.data)} às ${p.hora}, ${pessoas} pessoa(s), ${areaCfg.nome}${mesaAlocada ? ` (mesa ${mesaAlocada})` : ''}, em nome de ${nome}. Gratuita. Confirme ao cliente em uma frase e avise que a mesa fica guardada por 15 minutos após o horário.`;
}
