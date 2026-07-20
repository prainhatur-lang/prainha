// POST /api/reservar/[token]/confirmar — valida o OTP e cria a reserva.
// Publico. Body: { telefone, codigo, nome, espaco, data, hora, pessoas, observacao }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { twilioConfigurado, twilioCheck } from '@/lib/twilio-verify';
import { enviarConfirmacaoReserva, enviarAvisoTolerancia, enviarLembreteReserva, lembreteReservaConfigurado } from '@/lib/whatsapp-otp';
import { hojeBr, horaAgoraBr } from '@/lib/datas';
import { mesasOcupadas } from '@/lib/reservas/mesa-disponivel';
import { foraDaJanelaAtendimento } from '@/lib/reservas/atendimento';
import { createCieloPixPayment } from '@/lib/cielo';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normTelefone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;
  if (d.length <= 11) d = '55' + d;
  return d;
}

function ehFimDeSemana(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({
      id: schema.filial.id,
      nome: schema.filial.nome,
      reservaConfig: schema.filial.reservaConfig,
    })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const b = await request.json().catch(() => null);
  const telefone = normTelefone(b?.telefone);
  const codigo = typeof b?.codigo === 'string' ? b.codigo.replace(/\D/g, '') : '';
  const nome = typeof b?.nome === 'string' ? b.nome.trim().slice(0, 200) : '';
  const espaco = typeof b?.espaco === 'string' ? b.espaco.trim().slice(0, 100) : '';
  const data = typeof b?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : null;
  const hora = typeof b?.hora === 'string' && /^\d{2}:\d{2}$/.test(b.hora) ? b.hora : null;
  const pessoas = Number.isInteger(b?.pessoas) && b.pessoas > 0 ? Math.min(b.pessoas, 99) : 0;
  const bebida = typeof b?.bebida === 'string' && b.bebida.trim() ? b.bebida.trim().slice(0, 100) : null;
  const bebidaComboQtd = Number.isInteger(b?.bebidaComboQtd) && b.bebidaComboQtd > 0 ? b.bebidaComboQtd : null;
  const bebidaCodigoPdv = Number.isInteger(b?.bebidaCodigoPdv) && b.bebidaCodigoPdv > 0 ? b.bebidaCodigoPdv : null;
  const placa = typeof b?.placa === 'string' && b.placa.trim() ? b.placa.trim().toUpperCase().slice(0, 10) : null;
  // Mesa escolhida pelo cliente no mapa clicável (opcional — sem isso, cai
  // na alocação automática de sempre).
  const mesaEscolhida = typeof b?.mesa === 'string' && b.mesa.trim() ? b.mesa.trim().slice(0, 20) : null;
  const cpfDigitos = typeof b?.cpf === 'string' ? b.cpf.replace(/\D/g, '') : '';

  const cfg = filial.reservaConfig;
  const semOtp = !!cfg?.semOtp;
  // Bebida pode vir do catálogo real do Consumer (Cerveja/Espumante/Vinho,
  // via /bebidas) ou da lista curta manual (cfg.bebidas) — informativo pra
  // equipe se preparar, não é dado crítico/financeiro, aceita como veio.
  const bebidaValida = bebida;

  if (!telefone || !nome || !data || !hora || !pessoas || (!semOtp && !codigo)) {
    return NextResponse.json({ error: 'preencha todos os campos' }, { status: 400 });
  }

  // Data no passado: o <input type="date" min={hoje}> do formulário já
  // bloqueia isso, mas só no navegador — sem checar aqui, dá pra burlar
  // direto na API (curl, devtools) e reservar mesa pra ontem.
  if (data < hojeBr()) {
    return NextResponse.json({ error: 'Não é possível reservar para uma data que já passou.' }, { status: 400 });
  }

  // Hora no passado (reserva pra HOJE numa hora que já bateu): mesma lógica
  // do dropdown do formulário, checada aqui pra quem burlar o front.
  if (data === hojeBr() && hora < horaAgoraBr()) {
    return NextResponse.json({ error: 'Não é possível reservar para uma hora que já passou.' }, { status: 400 });
  }

  // Pausa por dia: exceção de calendário com fechado=true pra essa data
  // específica (ex: "hoje lotou") — não bloqueia outros dias.
  if (cfg?.excecoes?.some((e) => e.data === data && e.fechado)) {
    return NextResponse.json(
      { error: 'Estamos sem vaga pra essa data. Escolha outra data ou fale direto com a gente.' },
      { status: 403 },
    );
  }

  // Janela de atendimento do restaurante (a HORA PEDIDA precisa estar dentro
  // dela; fim de semana/feriado tem corte extra pra pedido do MESMO DIA).
  const janela = await foraDaJanelaAtendimento(cfg, data, hora);
  if (janela.bloqueado) {
    return NextResponse.json({ error: janela.motivo }, { status: 403 });
  }

  // Valida espaco + hora limite
  const areaCfg = cfg?.areas?.find((a) => a.nome === espaco);
  if (!areaCfg || !areaCfg.ativo || areaCfg.somenteEventos) {
    return NextResponse.json({ error: 'espaço indisponível para reserva' }, { status: 400 });
  }
  if (areaCfg.horaLimite && hora > areaCfg.horaLimite) {
    return NextResponse.json(
      { error: `${espaco} aceita reserva só até ${areaCfg.horaLimite}` },
      { status: 400 },
    );
  }

  // Modo confianca (semOtp): pula a validacao de codigo — confia no numero.
  // Senao, valida via Twilio Verify (se configurado) OU pela tabela reserva_otp.
  if (semOtp) {
    // sem validacao de codigo
  } else if (twilioConfigurado()) {
    const ok = await twilioCheck(telefone, codigo);
    if (!ok) return NextResponse.json({ error: 'código incorreto ou expirado' }, { status: 400 });
  } else {
    const [otp] = await db
      .select()
      .from(schema.reservaOtp)
      .where(
        and(
          eq(schema.reservaOtp.filialId, filial.id),
          eq(schema.reservaOtp.telefone, telefone),
          isNull(schema.reservaOtp.verificadoEm),
        ),
      )
      .orderBy(desc(schema.reservaOtp.criadoEm))
      .limit(1);

    if (!otp) return NextResponse.json({ error: 'peça um código primeiro' }, { status: 400 });
    if (otp.tentativas >= 5) return NextResponse.json({ error: 'muitas tentativas. Peça um novo código.' }, { status: 429 });
    if (new Date(otp.expiraEm).getTime() < Date.now()) {
      return NextResponse.json({ error: 'código expirado. Peça um novo.' }, { status: 400 });
    }
    if (otp.codigo !== codigo) {
      await db.update(schema.reservaOtp).set({ tentativas: otp.tentativas + 1 }).where(eq(schema.reservaOtp.id, otp.id));
      return NextResponse.json({ error: 'código incorreto' }, { status: 400 });
    }
    await db.update(schema.reservaOtp).set({ verificadoEm: new Date() }).where(eq(schema.reservaOtp.id, otp.id));
  }

  // ALOCAÇÃO DE MESA — a mesa é a unidade: reservar = tirar a mesa INTEIRA do
  // estoque (mesmo que 1 pessoa numa mesa de 4). Pega a MENOR mesa livre do
  // espaço que comporta o grupo. Sem mesa livre → lotado (bloqueia).
  // Se o espaço não tem mesas cadastradas, segue sem mesa (fallback).
  let mesaAlocada: string | null = null;
  const mesasDoEspaco = (areaCfg.mesas ?? []) as Array<{ numero: string | number; lugares: number }>;
  if (mesasDoEspaco.length > 0) {
    const ocupadas = await mesasOcupadas({ filialId: filial.id, data, area: espaco });

    // Teto de overbook: % do total de mesas liberado pra reserva antecipada
    // (conta reserva ativa + ocupação real do Consumer, se hoje). Ausente =
    // sem teto, usa a capacidade física inteira.
    const limiteMesas =
      typeof areaCfg.percentualReserva === 'number'
        ? Math.floor((mesasDoEspaco.length * areaCfg.percentualReserva) / 100)
        : mesasDoEspaco.length;
    if (ocupadas.size >= limiteMesas) {
      return NextResponse.json(
        { error: `${espaco} já está lotado para ${data.split('-').reverse().join('/')}. Escolha outro espaço ou dia. 🙏` },
        { status: 409 },
      );
    }

    if (mesaEscolhida) {
      // Cliente escolheu no mapa — revalida no servidor (nunca confia no
      // client): existe, cabe o grupo, e ainda está livre (pode ter sido
      // reservada por outra pessoa entre o cliente ver o mapa e confirmar).
      const escolhida = mesasDoEspaco.find((m) => String(m.numero) === mesaEscolhida);
      if (!escolhida) {
        return NextResponse.json({ error: `Mesa ${mesaEscolhida} não existe em ${espaco}.` }, { status: 400 });
      }
      if (escolhida.lugares < pessoas) {
        return NextResponse.json(
          { error: `A mesa ${mesaEscolhida} tem só ${escolhida.lugares} lugares — não cabe ${pessoas} pessoa(s).` },
          { status: 400 },
        );
      }
      if (ocupadas.has(mesaEscolhida)) {
        return NextResponse.json(
          { error: `A mesa ${mesaEscolhida} acabou de ser reservada por outra pessoa. Escolha outra mesa. 🙏` },
          { status: 409 },
        );
      }
      mesaAlocada = mesaEscolhida;
    } else {
      const ordenadas = mesasDoEspaco.slice().sort((a, b) => a.lugares - b.lugares);
      const cabem = ordenadas.filter((m) => m.lugares >= pessoas);
      if (cabem.length === 0) {
        return NextResponse.json(
          { error: `Não temos mesa para ${pessoas} pessoa(s) em ${espaco}. Tente outro espaço.` },
          { status: 409 },
        );
      }
      const livre = cabem.find((m) => !ocupadas.has(String(m.numero)));
      if (!livre) {
        return NextResponse.json(
          { error: `${espaco} já está lotado para ${data.split('-').reverse().join('/')}. Escolha outro espaço ou dia. 🙏` },
          { status: 409 },
        );
      }
      mesaAlocada = String(livre.numero);
    }
  }

  const valorAtual = typeof cfg?.valorAtual === 'number' ? cfg.valorAtual : 0;
  const cancelToken = randomBytes(24).toString('hex');

  // Espaço com taxa de reserva obrigatória (ex: Lounge): a reserva nasce
  // "aguardando pagamento" e só vira de fato válida quando o Pix cair —
  // recepção enxerga esse estado (não confunde com reserva confirmada).
  const taxaEspaco = areaCfg.taxaReserva;
  const valorTaxa = taxaEspaco ? (ehFimDeSemana(data) ? taxaEspaco.sabDom : taxaEspaco.diasUteis) : null;

  const [nova] = await db
    .insert(schema.reserva)
    .values({
      filialId: filial.id,
      clienteNome: nome,
      clienteTelefone: telefone,
      pessoas,
      data,
      hora,
      // Nasce "feita" (pendente). Vira "confirmada" só quando o cliente
      // confirmar a presença pelo lembrete da véspera.
      status: 'pendente',
      area: espaco,
      mesa: mesaAlocada,
      canal: 'site',
      observacao: typeof b?.observacao === 'string' && b.observacao.trim() ? b.observacao.trim().slice(0, 2000) : null,
      preferencias: typeof b?.preferencias === 'string' && b.preferencias.trim() ? b.preferencias.trim().slice(0, 500) : null,
      bebidaPedido: bebidaValida,
      bebidaComboQtd,
      bebidaCodigoPdv,
      placaVeiculo: placa,
      valor: valorTaxa != null ? String(valorTaxa.toFixed(2)) : String(valorAtual.toFixed(2)),
      pagamentoStatus: valorTaxa != null ? 'aguardando' : null,
      pagamentoValor: valorTaxa != null ? String(valorTaxa.toFixed(2)) : null,
      cancelToken,
    })
    .returning({ id: schema.reserva.id });

  // Cliente já cadastrado no Consumer sem CPF na ficha, preencheu agora:
  // atualiza o cadastro lá (mesmo write-back já usado no admin de clientes/
  // fornecedores) — best-effort, nunca bloqueia a reserva.
  if (cpfDigitos.length === 11 || cpfDigitos.length === 14) {
    try {
      const local = telefone.slice(-11);
      const [cli] = await db
        .select({ codigoExterno: schema.cliente.codigoExterno, cpfOuCnpj: schema.cliente.cpfOuCnpj })
        .from(schema.cliente)
        .where(
          and(
            eq(schema.cliente.filialId, filial.id),
            isNull(schema.cliente.dataDelete),
            sql`regexp_replace(${schema.cliente.telefone}, '\\D', '', 'g') LIKE ${'%' + local}`,
          ),
        )
        .limit(1);
      if (cli && !cli.cpfOuCnpj?.trim()) {
        await db.insert(schema.agenteComando).values({
          filialId: filial.id,
          tipo: 'atualizar_cliente',
          payload: { codigoExterno: cli.codigoExterno, campos: { cnpjOuCpf: cpfDigitos } },
        });
      }
    } catch (e) {
      console.error('Erro enfileirando atualização de CPF do cliente:', (e as Error).message);
    }
  }

  // Espaço com taxa: gera o Pix e devolve pro cliente pagar — reserva já
  // existe (segura a mesa) mas fica "aguardando" até o pagamento confirmar.
  // WhatsApp de confirmação e lembrete do dia só disparam depois de pago
  // (rota de status/webhook), não aqui.
  if (valorTaxa != null && nova?.id) {
    try {
      const pix = await createCieloPixPayment({
        orderId: nova.id,
        amount: Math.round(valorTaxa * 100),
        customerName: nome,
      });
      await db
        .update(schema.reserva)
        .set({ pagamentoId: pix.paymentId, pagamentoQrcode: pix.qrCodeString })
        .where(eq(schema.reserva.id, nova.id));
      return NextResponse.json({
        ok: true,
        pagamentoPendente: true,
        reservaId: nova.id,
        valor: valorTaxa,
        qrCodeBase64: pix.qrCodeBase64,
        qrCodeString: pix.qrCodeString,
      });
    } catch (e) {
      // Falhou gerar o Pix: desfaz a reserva (não deixa mesa presa sem
      // forma de pagar) e avisa o cliente.
      await db.delete(schema.reserva).where(eq(schema.reserva.id, nova.id));
      console.error('Cielo Pix erro na reserva do Lounge:', (e as Error).message);
      return NextResponse.json(
        { error: 'Não consegui gerar o Pix agora. Tente de novo em instantes.' },
        { status: 502 },
      );
    }
  }

  // Mensagem de confirmacao rica no WhatsApp (best-effort; so envia se houver
  // remetente/template configurado). confirmacaoZap diz se realmente foi enviada.
  let confirmacaoZap = false;
  try {
    const origin = new URL(request.url).origin;
    const [a, mes, d] = data.split('-');
    confirmacaoZap = await enviarConfirmacaoReserva(telefone, {
      nome,
      data: `${d}/${mes}/${a}`,
      hora,
      local: espaco,
      pessoas: String(pessoas),
      linkCancelar: `${origin}/reservar/cancelar/${cancelToken}`,
    });
    if (confirmacaoZap) await enviarAvisoTolerancia(telefone, nome);
  } catch {
    // nao bloqueia a reserva se a confirmacao falhar
  }

  // Reserva pro MESMO dia: o lembrete da vespera (cron 17h) nao alcanca, entao
  // ja pede a confirmacao de presenca na hora. Marca lembreteConfirmacaoEm pra
  // o cron nao mandar de novo. Best-effort, env-gated.
  try {
    if (data === hojeBr() && lembreteReservaConfigurado()) {
      const [a, mes, d] = data.split('-');
      await enviarLembreteReserva(telefone, {
        nome: nome.split(' ')[0] || 'tudo bem',
        data: `${d}/${mes}/${a}`,
        hora,
        local: `${filial.nome}${espaco ? ' · ' + espaco : ''}`,
        token: cancelToken,
      });
      if (nova?.id) {
        await db
          .update(schema.reserva)
          .set({ lembreteConfirmacaoEm: new Date() })
          .where(eq(schema.reserva.id, nova.id));
      }
    }
  } catch {
    // nao bloqueia a reserva se o lembrete do mesmo dia falhar
  }

  return NextResponse.json({
    ok: true,
    confirmacaoZap,
    telefone,
    valorCheio: typeof cfg?.valorCheio === 'number' ? cfg.valorCheio : null,
    valorAtual,
  });
}
