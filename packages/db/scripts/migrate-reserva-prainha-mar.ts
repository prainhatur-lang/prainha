// Reserva online da Prainha Mar e Grill (filial 03), no formato do Prainha Bar.
// Mesas 1 a 70 nas áreas dos QR das mesas (Downloads/"QR das mesas — Prainha
// Mar e Grill ..."): 1-30 Salão, 31-49 Salão fechado, 50-70 Varanda. 4 lugares
// e juntáveis até a planta dizer outra coisa. Só grava se a filial não tem
// áreas (ou tem só o "Salão" provisório 1-70 da 1ª versão) — depois disso a
// config é editada pela tela de reservas. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reserva-prainha-mar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const PRAINHA_MAR = 'e899dae2-38bf-4f3f-9149-7effd059fab8';

function area(nome: string, de: number, ate: number) {
  const mesas = [];
  for (let n = de; n <= ate; n++) mesas.push({ numero: String(n), lugares: 4, juntavel: true });
  return { nome, ativo: true, horaLimite: '21:00', mesas };
}

const config = {
  areas: [
    area('Salão', 1, 30),
    area('Salão fechado', 31, 49),
    area('Varanda', 50, 70),
  ],
  semOtp: true,
  bebidas: [],
  pedirCpf: true,
  pedirPlaca: false, // shopping: estacionamento é do Praia Sul
  pedirBebida: false,
  juntarMesas: true,
  valorCheio: 30,
  valorAtual: 0,
  atendimento: { inicio: '11:30', fim: '21:30', fimHojeFimDeSemana: '21:30' },
};

async function main() {
  const r = await sql`
    UPDATE filial
       SET reserva_config = coalesce(reserva_config, '{}'::jsonb) || ${sql.json(config)}
     WHERE id = ${PRAINHA_MAR}
       AND (jsonb_array_length(coalesce(reserva_config->'areas', '[]'::jsonb)) = 0
            OR (jsonb_array_length(reserva_config->'areas') = 1
                AND jsonb_array_length(reserva_config->'areas'->0->'mesas') = 70))
    RETURNING id`;
  console.log(r.length ? 'Pronto. Reserva da Prainha Mar configurada (Salão 1-30, Salão fechado 31-49, Varanda 50-70).' : 'Já tinha áreas — nada a fazer.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
