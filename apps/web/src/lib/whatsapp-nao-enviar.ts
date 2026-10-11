// Quem NÃO recebe mais mensagem de divulgação pelo WhatsApp — vale pros dois
// envios de marketing: convite de campanha (lib/campanha.ts) e convite do
// Cliente VIP (api/fidelidade/admin).
//
// A Meta NÃO entrega a lista de quem bloqueou o número da casa (11/10, o dono
// perguntou "consigo não enviar mais para os bloqueados?" com a qualidade do
// prainha Zap em "Média"). O que chega, e vira uma regra só aqui:
//  - toque em "Não quero receber" / "Não tenho interesse" no convite
//    (recusado_em em campanha_convite e fidelidade_cartao — já existia);
//  - recibo de falha do convite: 131050 = a pessoa desligou as promoções deste
//    número no WhatsApp; 131026 = a mensagem não chega (sem WhatsApp, app
//    antigo — e é onde cai quem bloqueou, sem a Meta dizer qual dos casos é);
//  - aviso user_preferences da Meta (parou / voltou a aceitar promoções) —
//    só chega se o campo estiver assinado no app da Meta;
//  - a pessoa escrevendo "pare" depois de receber um convite.
// 131049 (teto de marketing por pessoa) e 130472 (experimento da Meta) são
// passageiros e NÃO tiram ninguém. Lembrete e confirmação de reserva não
// passam por aqui.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';

export type MotivoFora = 'recusou' | 'pediu_parar' | 'parou_promocoes' | 'nao_entrega' | 'manual';

const ROTULO: Record<string, string> = {
  recusou: 'tocou em "não quero receber" num convite',
  pediu_parar: 'pediu pra parar de receber',
  parou_promocoes: 'desligou as promoções deste número no WhatsApp',
  nao_entrega: 'a mensagem não chega nesse número (sem WhatsApp ou bloqueou)',
  manual: 'tirado dos envios pela casa',
};
export const rotuloMotivoFora = (motivo: string): string => ROTULO[motivo] ?? motivo;

/** Celular só dígitos, DDD + 9 + 8 (sem o 55). O wa_id do Brasil costuma vir
 *  sem o 9 (55 79 8802-0325) — aqui ele volta. Fixo ou lixo → null. */
export function celular11(fone: string | null | undefined): string | null {
  let d = String(fone ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return /^[1-9][1-9]9\d{8}$/.test(d) ? d : null;
}

/** Erro da Meta que tira o número dos envios. Os passageiros devolvem null. */
export function motivoDoErro(erro: string | null | undefined): MotivoFora | null {
  if (!erro) return null;
  if (/\b131050\b/.test(erro)) return 'parou_promocoes';
  if (/\b131026\b/.test(erro)) return 'nao_entrega';
  return null;
}

// Todo mundo que está fora, de onde quer que venha o sinal: (fone, motivo,
// ordem). ordem menor = motivo mais forte (o que aparece na tela). O "não
// entregue" mora só em whatsapp_nao_enviar (pedido do dono em 11/10: "os não
// entrega coloca como não enviar mais") — os convites do Cliente VIP que já
// tinham voltado com 131026 foram copiados pra lá no mesmo dia.
const CONJUNTO_FORA = sql`(
  SELECT w1.telefone::text AS fone, w1.motivo::text AS motivo,
         CASE w1.motivo WHEN 'pediu_parar' THEN 2 WHEN 'parou_promocoes' THEN 3 WHEN 'manual' THEN 4 ELSE 5 END AS ordem
    FROM whatsapp_nao_enviar w1
  UNION ALL
  SELECT w2.telefone::text, 'recusou', 1
    FROM campanha_convite w2
   WHERE w2.recusado_em IS NOT NULL
  UNION ALL
  SELECT right(regexp_replace(w3.telefone, '\\D', '', 'g'), 11), 'recusou', 1
    FROM fidelidade_cartao w3
   WHERE w3.recusado_em IS NOT NULL
)`;

/** Condição SQL: o telefone (expressão de 11 dígitos) está fora dos envios. */
export function sqlForaDosEnvios(fone: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM ${CONJUNTO_FORA} nf WHERE nf.fone = ${fone})`;
}

/** Expressão SQL: o motivo (o mais forte) ou NULL se o telefone pode receber. */
export function sqlMotivoFora(fone: SQL): SQL {
  return sql`(SELECT nf.motivo FROM ${CONJUNTO_FORA} nf WHERE nf.fone = ${fone} ORDER BY nf.ordem LIMIT 1)`;
}

/** Dos telefones dados, quais estão fora dos envios: celular (11 dígitos) → motivo. */
export async function telefonesForaDosEnvios(fones: string[]): Promise<Map<string, string>> {
  const lista = [...new Set(fones.map(celular11).filter((f): f is string => !!f))];
  const fora = new Map<string, string>();
  if (!lista.length) return fora;
  const r = (await db.execute(sql`
    SELECT t.fone, ${sqlMotivoFora(sql`t.fone`)} AS motivo
    FROM (VALUES ${sql.join(lista.map((f) => sql`(${f}::text)`), sql`, `)}) AS t(fone)
  `)) as unknown as Array<{ fone: string; motivo: string | null }>;
  for (const l of r) if (l.motivo) fora.set(l.fone, l.motivo);
  return fora;
}

/** Põe o número na lista. Não troca um motivo já gravado, a não ser o
 *  "não chega" por um pedido da própria pessoa (que é mais forte). */
export async function marcarNaoEnviar(
  telefone: string | null | undefined,
  motivo: MotivoFora,
  detalhe: string | null,
  origem: string,
): Promise<boolean> {
  const fone = celular11(telefone);
  if (!fone) return false;
  const r = (await db.execute(sql`
    INSERT INTO whatsapp_nao_enviar (telefone, motivo, detalhe, origem)
    VALUES (${fone}, ${motivo}, ${detalhe ? detalhe.slice(0, 500) : null}, ${origem})
    ON CONFLICT (telefone) DO UPDATE
      SET motivo = excluded.motivo, detalhe = excluded.detalhe, origem = excluded.origem
      WHERE whatsapp_nao_enviar.motivo = 'nao_entrega' AND excluded.motivo <> 'nao_entrega'
    RETURNING telefone
  `)) as unknown as unknown[];
  return r.length > 0;
}

const MAPA: Record<string, string> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'erro' };
const ORDEM = ['enviada', 'entregue', 'lida'];

/** Webhook de status: guarda o recibo do convite de CAMPANHA (o do Cliente VIP
 *  já é guardado em fidelidade/convite-status.ts) e, quando o convite — de
 *  campanha ou VIP — volta com 131026/131050, tira o número dos envios. */
export async function registrarStatusMarketing(wamid: string, status: string, erro: string | null): Promise<void> {
  const novo = MAPA[status];
  if (!novo) return;
  if (novo === 'erro') {
    await db.execute(sql`
      UPDATE campanha_convite
         SET entrega_status = 'erro', entrega_status_em = now(),
             entrega_erro = ${erro || 'a Meta não entregou o convite'}
       WHERE wa_message_id = ${wamid}
    `);
    const motivo = motivoDoErro(erro);
    if (!motivo) return;
    const donos = (await db.execute(sql`
      SELECT cc.telefone::text AS fone, 'campanha' AS origem
        FROM campanha_convite cc WHERE cc.wa_message_id = ${wamid}
      UNION ALL
      SELECT right(regexp_replace(fc.telefone, '\\D', '', 'g'), 11), 'convite_vip'
        FROM fidelidade_cartao fc WHERE fc.convite_wamid = ${wamid}
    `)) as unknown as Array<{ fone: string; origem: string }>;
    for (const d of donos) await marcarNaoEnviar(d.fone, motivo, erro, d.origem);
    return;
  }
  // a Meta manda os status fora de ordem: "lida" não volta pra "entregue"
  const anteriores = ORDEM.slice(0, ORDEM.indexOf(novo));
  await db.execute(sql`
    UPDATE campanha_convite
       SET entrega_status = ${novo}, entrega_status_em = now()
     WHERE wa_message_id = ${wamid}
       AND (entrega_status IS NULL OR entrega_status IN (${sql.join(
         anteriores.length ? anteriores.map((a) => sql`${a}`) : [sql`''`],
         sql`, `,
       )}))
  `);
}

/** Webhook user_preferences: a pessoa desligou ("stop") ou religou ("resume")
 *  as promoções deste número no próprio WhatsApp. */
export async function registrarPreferenciaMarketing(
  waId: string | undefined,
  valor: string | undefined,
  detalhe: string | null,
): Promise<void> {
  const fone = celular11(waId);
  if (!fone) return;
  if (valor === 'stop') {
    await marcarNaoEnviar(fone, 'parou_promocoes', detalhe, 'preferencia_meta');
    return;
  }
  if (valor === 'resume') {
    // só desfaz o que a própria pessoa tinha desligado; recusa pelo botão e
    // "pare" escrito continuam valendo
    await db.execute(sql`DELETE FROM whatsapp_nao_enviar WHERE telefone = ${fone} AND motivo = 'parou_promocoes'`);
  }
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const OBJETO = '(?: (?:mensagem|mensagens|isso|nada|convite|convites|propaganda|propagandas|promocao|promocoes))?';
const RE_PARAR = new RegExp(
  '^(?:por favor[, ]*)?(?:' +
    [
      'pare',
      'parar',
      'stop',
      'sair',
      'descadastrar',
      'descadastre',
      'remover',
      'remova',
      'nao tenho interesse',
      `nao quero(?: mais)? receber(?: mais)?${OBJETO}`,
      `nao (?:me )?(?:envie|envia|enviem|mande|manda|mandem) mais${OBJETO}`,
      `parem? de (?:me )?(?:enviar|mandar)${OBJETO}`,
      'me (?:tire|tira|remova|remove|exclua) (?:da|dessa|desta) lista',
    ].join('|') +
    ')(?:[, ]*por favor)?[\\s.!]*$',
);

/** A mensagem inteira é um pedido de parar? Frase curta e fechada — "não quero"
 *  solto, "cancelar" (é reserva) e texto comprido não contam. */
export function ehPedidoDeParar(texto: string | null | undefined): boolean {
  const t = semAcento(String(texto ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return false;
  return RE_PARAR.test(t);
}

/** Webhook de mensagem: a pessoa escreveu "pare" (ou parecido) e recebeu um
 *  convite de divulgação nos últimos 30 dias → sai dos envios. Não responde
 *  nada e não mexe na conversa: a mensagem segue pro atendimento como sempre. */
export async function registrarPedidoDeParar(
  from: string | undefined,
  texto: string | null | undefined,
): Promise<boolean> {
  if (!ehPedidoDeParar(texto)) return false;
  const fone = celular11(from);
  if (!fone) return false;
  const [recebeu] = (await db.execute(sql`
    SELECT 1 AS ok
     WHERE EXISTS (
             SELECT 1 FROM campanha_convite cc
              WHERE cc.telefone = ${fone} AND cc.enviado_em > now() - interval '30 days')
        OR EXISTS (
             SELECT 1 FROM fidelidade_cartao fc
              WHERE right(regexp_replace(fc.telefone, '\\D', '', 'g'), 11) = ${fone}
                AND fc.convidado_em > now() - interval '30 days')
  `)) as unknown as Array<{ ok: number }>;
  if (!recebeu) return false;
  return marcarNaoEnviar(fone, 'pediu_parar', String(texto ?? '').trim(), 'mensagem');
}
