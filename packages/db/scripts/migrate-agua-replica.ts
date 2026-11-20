// Água do Prainha: a nuvem vira CÓPIA do servidor da loja (dono 20/11/2026 —
// "o banco fica na filial e replica pra nuvem; tem que operar sem internet").
// A placa grava no Concilia Loja; a loja avalia os alarmes e manda tudo pra cá
// por /api/loja/agua. Aqui muda só:
//   - agua_leituras.id_local: o id da leitura na loja (reenvio não duplica);
//   - agua_avaliar_alarmes(): as regras de nível/boia/bomba saem daqui (quem
//     decide é a loja). A nuvem só acusa "cópia desatualizada" quando a loja
//     para de mandar — e nada enquanto a loja nunca mandou.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:agua-replica

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  await run('agua_leituras.id_local', () =>
    sql.unsafe(`ALTER TABLE agua_leituras ADD COLUMN IF NOT EXISTS id_local bigint`),
  );
  await run('idx agua_leituras (id_local único)', () =>
    sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS agua_leituras_id_local ON agua_leituras (id_local)`),
  );
  await run('agua_avaliar_alarmes (só cópia desatualizada)', () =>
    sql.unsafe(`
      CREATE OR REPLACE FUNCTION agua_avaliar_alarmes() RETURNS void
      LANGUAGE plpgsql AS $fn$
      DECLARE
        ultima numeric;
      BEGIN
        -- epoch (segundos) do último envio da loja; gravado por /api/loja/agua
        ultima := agua_cfg('ultima_sincronizacao');
        IF ultima IS NULL THEN
          RETURN; -- a loja nunca mandou: quadro ainda não instalado
        END IF;
        IF to_timestamp(ultima) < now() - make_interval(mins => coalesce(agua_cfg('minutos_sem_comunicacao'), 10)::int) THEN
          PERFORM agua_abrir_alarme('loja_sem_nuvem', 'aviso', 'Cópia da água desatualizada',
            'O servidor da loja parou de mandar os dados (internet da loja ou servidor desligado). O que aparece aqui é a última situação recebida. Na loja a tela e os avisos seguem funcionando.');
        ELSE
          PERFORM agua_fechar_alarme('loja_sem_nuvem');
        END IF;
      END $fn$
    `),
  );
  await run('REVOKE agua_avaliar_alarmes', () =>
    sql.unsafe(`REVOKE ALL ON FUNCTION agua_avaliar_alarmes() FROM PUBLIC, anon, authenticated`),
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
