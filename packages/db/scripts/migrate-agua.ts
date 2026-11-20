// Água do Prainha: tabelas agua_*, regras de alarme e permissões.
// Vem do pacote "concilia agua" (01_agua_schema.sql), adaptado ao Concilia:
//   - SEM políticas pra `authenticated` e SEM realtime: aqui o navegador não
//     fala com o banco; a tela lê pelas rotas /api/agua (guard `agua.read`).
//     RLS ligado sem política = PostgREST não lê nem grava.
//   - SEM pg_cron: quem chama agua_avaliar_alarmes() a cada minuto é o cron
//     da Vercel (/api/cron/agua-alarmes).
//   - Enquanto não existir NENHUMA leitura (quadro ainda não instalado), a
//     regra não abre "sem comunicação" — senão o aviso em tela cheia piscaria
//     pra todo mundo antes de a placa existir.
// Só cria objetos novos com o prefixo agua_. Idempotente.
//
// Uso: pnpm --filter @concilia/db migrate:agua

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

const TABELAS = [
  'agua_bombas',
  'agua_leituras',
  'agua_config',
  'agua_alarmes',
  'agua_comandos',
  'agua_retrolavagens',
] as const;

async function main() {
  console.log('[1] Tabelas');
  await run('agua_bombas', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_bombas (
        id smallint PRIMARY KEY,
        nome text NOT NULL,
        fases text,
        corrente_nominal numeric(5,2),
        limite_corrente_baixa numeric(5,2),
        tuya_device_id text,
        liberada boolean NOT NULL DEFAULT true,
        modo text NOT NULL DEFAULT 'auto' CHECK (modo IN ('auto','manual','off')),
        falha text CHECK (falha IN ('poco_seco','tubo_fechado','sobrecarga')),
        tentativas smallint NOT NULL DEFAULT 0,
        proxima_tentativa timestamptz,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `),
  );
  await run('agua_bombas: 3 poços + bomba 4', () =>
    sql.unsafe(`
      INSERT INTO agua_bombas (id, nome, fases) VALUES
        (1, 'Poço 1', 'R-S'), (2, 'Poço 2', 'S-T'), (3, 'Poço 3', 'T-R'), (4, 'Bomba 4', 'a definir')
      ON CONFLICT (id) DO NOTHING
    `),
  );
  await run('agua_leituras', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_leituras (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        criado_em timestamptz NOT NULL DEFAULT now(),
        nivel_terrea numeric(5,1),
        nivel_intermediaria numeric(5,1),
        nivel_superior numeric(5,1),
        pressao_1 numeric(5,2),
        pressao_2 numeric(5,2),
        pressao_3 numeric(5,2),
        corrente_1 numeric(5,2),
        corrente_2 numeric(5,2),
        corrente_3 numeric(5,2),
        corrente_4 numeric(5,2),
        v1_aberta boolean,
        v2_aberta boolean
      )
    `),
  );
  await run('idx agua_leituras', () =>
    sql.unsafe(`CREATE INDEX IF NOT EXISTS agua_leituras_criado_em ON agua_leituras (criado_em DESC)`),
  );
  await run('agua_config', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_config (
        chave text PRIMARY KEY,
        valor numeric NOT NULL,
        descricao text
      )
    `),
  );
  await run('agua_config: limites iniciais', () =>
    sql.unsafe(`
      INSERT INTO agua_config (chave, valor, descricao) VALUES
        ('superior_critico', 20, 'Percentual da caixa superior que dispara aviso em tela cheia'),
        ('superior_liga', 50, 'Percentual em que a boia da superior deveria ligar a bomba 4'),
        ('terrea_minimo', 15, 'Percentual mínimo da térrea para a bomba 4 poder rodar'),
        ('corrente_zero', 0.3, 'Abaixo disso a bomba é considerada parada (A)'),
        ('minutos_boia', 5, 'Minutos de nível baixo com bomba parada para acusar boia com defeito'),
        ('minutos_sem_comunicacao', 10, 'Minutos sem leitura para acusar quadro sem comunicação'),
        ('espera_poco_seco_min', 30, 'Espera antes do rearme automático por poço seco'),
        ('max_tentativas', 3, 'Tentativas seguidas antes de travar a bomba'),
        ('reaviso_min', 30, 'Minutos para o aviso em tela cheia voltar depois de confirmado')
      ON CONFLICT (chave) DO NOTHING
    `),
  );
  await run('agua_alarmes', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_alarmes (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        codigo text NOT NULL,
        gravidade text NOT NULL CHECK (gravidade IN ('critico','aviso')),
        titulo text NOT NULL,
        detalhe text,
        bomba_id smallint REFERENCES agua_bombas(id),
        aberto_em timestamptz NOT NULL DEFAULT now(),
        visto_em timestamptz,
        visto_por uuid,
        resolvido_em timestamptz
      )
    `),
  );
  await run('idx agua_alarmes (um aberto por código/bomba)', () =>
    sql.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS agua_alarmes_aberto
        ON agua_alarmes (codigo, coalesce(bomba_id, 0)) WHERE resolvido_em IS NULL
    `),
  );
  await run('agua_comandos', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_comandos (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        criado_em timestamptz NOT NULL DEFAULT now(),
        tipo text NOT NULL CHECK (tipo IN ('liberar','bloquear','rearmar','retrolavar','abrir_v1','abrir_v2')),
        bomba_id smallint REFERENCES agua_bombas(id),
        solicitado_por uuid,
        executado_em timestamptz,
        resultado text
      )
    `),
  );
  await run('agua_retrolavagens', () =>
    sql.unsafe(`
      CREATE TABLE IF NOT EXISTS agua_retrolavagens (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        iniciado_em timestamptz NOT NULL DEFAULT now(),
        terminado_em timestamptz,
        resultado text,
        nivel_terrea_antes numeric(5,1),
        nivel_terrea_depois numeric(5,1)
      )
    `),
  );

  console.log('[2] RLS (deny-all pro PostgREST; app acessa via role postgres)');
  for (const t of TABELAS) {
    await run(`RLS ${t}`, () => sql.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
  }

  console.log('[3] Regras de alarme');
  await run('agua_cfg', () =>
    sql.unsafe(`
      CREATE OR REPLACE FUNCTION agua_cfg(p_chave text) RETURNS numeric
      LANGUAGE sql STABLE AS $fn$ SELECT valor FROM agua_config WHERE chave = p_chave $fn$
    `),
  );
  await run('agua_abrir_alarme', () =>
    sql.unsafe(`
      CREATE OR REPLACE FUNCTION agua_abrir_alarme(p_codigo text, p_gravidade text, p_titulo text, p_detalhe text, p_bomba smallint DEFAULT NULL)
      RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO agua_alarmes (codigo, gravidade, titulo, detalhe, bomba_id)
        SELECT p_codigo, p_gravidade, p_titulo, p_detalhe, p_bomba
        WHERE NOT EXISTS (
          SELECT 1 FROM agua_alarmes
          WHERE codigo = p_codigo AND coalesce(bomba_id, 0) = coalesce(p_bomba, 0) AND resolvido_em IS NULL);
      END $fn$
    `),
  );
  await run('agua_fechar_alarme', () =>
    sql.unsafe(`
      CREATE OR REPLACE FUNCTION agua_fechar_alarme(p_codigo text, p_bomba smallint DEFAULT NULL)
      RETURNS void LANGUAGE sql AS $fn$
        UPDATE agua_alarmes SET resolvido_em = now()
        WHERE codigo = p_codigo AND coalesce(bomba_id, 0) = coalesce(p_bomba, 0) AND resolvido_em IS NULL
      $fn$
    `),
  );
  await run('agua_avaliar_alarmes', () =>
    sql.unsafe(`
      CREATE OR REPLACE FUNCTION agua_avaliar_alarmes() RETURNS void
      LANGUAGE plpgsql AS $fn$
      DECLARE
        u agua_leituras%rowtype;
        b agua_bombas%rowtype;
        b4 agua_bombas%rowtype;
        total int;
        ruins int;
      BEGIN
        SELECT * INTO u FROM agua_leituras ORDER BY criado_em DESC LIMIT 1;

        -- Quadro ainda não instalado: nenhuma leitura na vida, nenhuma regra.
        IF u.id IS NULL THEN
          RETURN;
        END IF;

        IF u.criado_em < now() - make_interval(mins => agua_cfg('minutos_sem_comunicacao')::int) THEN
          PERFORM agua_abrir_alarme('sem_comunicacao', 'critico', 'Quadro da água sem comunicação',
            'Nenhuma leitura recebida. Nesse período não há corte por poço seco nem por tubo fechado. Verifique a energia e a internet do quadro.');
          RETURN;
        END IF;
        PERFORM agua_fechar_alarme('sem_comunicacao');

        IF u.nivel_superior < agua_cfg('superior_critico') THEN
          PERFORM agua_abrir_alarme('superior_baixa', 'critico', 'Caixa superior quase vazia',
            'O restaurante pode ficar sem água. Verifique a bomba 4 no quadro.');
        ELSE
          PERFORM agua_fechar_alarme('superior_baixa');
        END IF;

        SELECT * INTO b4 FROM agua_bombas WHERE id = 4;
        SELECT count(*),
               count(*) FILTER (WHERE nivel_superior < agua_cfg('superior_liga') - 5
                                  AND coalesce(corrente_4, 0) < agua_cfg('corrente_zero')
                                  AND nivel_terrea > agua_cfg('terrea_minimo'))
          INTO total, ruins
          FROM agua_leituras
         WHERE criado_em > now() - make_interval(mins => agua_cfg('minutos_boia')::int);
        IF total >= 3 AND total = ruins AND b4.liberada AND b4.modo = 'auto' AND b4.falha IS NULL THEN
          PERFORM agua_abrir_alarme('boia_superior', 'critico', 'Caixa superior baixa e a bomba 4 não ligou',
            'Provável defeito na boia de comando da caixa superior. Passe a chave da bomba 4 para Manual e chame a manutenção. A boia de caixa cheia continua protegendo.', 4::smallint);
        ELSE
          PERFORM agua_fechar_alarme('boia_superior', 4::smallint);
        END IF;

        FOR b IN SELECT * FROM agua_bombas LOOP
          IF b.falha IS NOT NULL AND b.tentativas >= agua_cfg('max_tentativas') THEN
            PERFORM agua_abrir_alarme('bomba_travada', 'critico', b.nome || ' travada',
              'Desarmou ' || b.tentativas || ' vezes seguidas (' || replace(b.falha, '_', ' ') || '). Verifique antes de rearmar.', b.id);
            PERFORM agua_fechar_alarme('bomba_em_espera', b.id);
          ELSIF b.falha IS NOT NULL THEN
            PERFORM agua_abrir_alarme('bomba_em_espera', 'aviso', b.nome || ' em espera',
              'Desarmou por ' || replace(b.falha, '_', ' ') || '. O sistema tenta de novo sozinho.', b.id);
            PERFORM agua_fechar_alarme('bomba_travada', b.id);
          ELSE
            PERFORM agua_fechar_alarme('bomba_travada', b.id);
            PERFORM agua_fechar_alarme('bomba_em_espera', b.id);
          END IF;

          IF b.modo <> 'auto' THEN
            PERFORM agua_abrir_alarme('bomba_fora_auto', 'aviso', b.nome || ' fora do automático',
              'Chave do quadro em ' || CASE b.modo WHEN 'manual' THEN 'Manual' ELSE '0' END || '.', b.id);
          ELSE
            PERFORM agua_fechar_alarme('bomba_fora_auto', b.id);
          END IF;

          IF NOT b.liberada AND b.falha IS NULL THEN
            PERFORM agua_abrir_alarme('bomba_bloqueada', 'aviso', b.nome || ' bloqueada pelo sistema', 'Alguém bloqueou esta bomba no aplicativo.', b.id);
          ELSE
            PERFORM agua_fechar_alarme('bomba_bloqueada', b.id);
          END IF;
        END LOOP;
      END $fn$
    `),
  );
  // Função em public vira RPC do PostgREST: tira o EXECUTE de quem vem de fora.
  for (const f of [
    'agua_cfg(text)',
    'agua_abrir_alarme(text, text, text, text, smallint)',
    'agua_fechar_alarme(text, smallint)',
    'agua_avaliar_alarmes()',
  ]) {
    await run(`REVOKE ${f}`, () => sql.unsafe(`REVOKE ALL ON FUNCTION ${f} FROM PUBLIC, anon, authenticated`));
  }

  console.log('[4] Permissoes');
  const perms = [
    ['agua.read', 'read', 'Ver a tela Água (caixas, bombas e avisos) e receber o aviso em tela cheia'],
    ['agua.control', 'control', 'Comandar as bombas e válvulas da água (liberar, bloquear, rearmar, retrolavar)'],
  ] as const;
  for (const [codigo, acao, descricao] of perms) {
    await run(`permissao ${codigo}`, () =>
      sql`
        INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
        VALUES (${codigo}, 'agua', ${acao}, ${descricao}, 'filial')
        ON CONFLICT (codigo) DO NOTHING
      `,
    );
  }
  await run('agua.read → Admin e Gerente', () =>
    sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
      WHERE g.sistema = true AND g.nome IN ('Admin', 'Gerente')
        AND p.codigo = 'agua.read'
      ON CONFLICT DO NOTHING
    `,
  );
  await run('agua.control → Admin', () =>
    sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
      WHERE g.sistema = true AND g.nome = 'Admin'
        AND p.codigo = 'agua.control'
      ON CONFLICT DO NOTHING
    `,
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
