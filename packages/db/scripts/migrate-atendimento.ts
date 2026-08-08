// Atendimento WhatsApp (Nina): 5 tabelas + permissoes + seeds.
// Idempotente: CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING (seeds nao
// sobrescrevem edicoes feitas depois no painel).
//
// Uso: pnpm --filter @concilia/db migrate:atendimento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const FILIAL_PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const PHONE_ID_ATUAL = '1055094051031714'; // numero ja integrado (ex-Tabuara)

const PERSONA_NINA =
  'Nina é doce, amável e super educada, de fala meiga; sempre compreende e ' +
  'acolhe as pessoas com quem conversa. Acredita que as pessoas podem sempre ' +
  'muito mais, e que toda festa e confraternização é uma coisa especial que ' +
  'deve ser valorizada.';

// Blocos com [PENDENTE] = a Nina trata como informacao que ela NAO tem
// (regra no system prompt) — o Elison preenche no painel.
const CONHECIMENTO = [
  {
    id: 'horarios',
    titulo: 'Horário de funcionamento',
    conteudo:
      'Aberto todos os dias, das 9h às 18h. Chegar por volta das 16h é o melhor horário pra curtir o pôr do sol no deck.',
  },
  {
    id: 'endereco',
    titulo: 'Endereço e estacionamento',
    conteudo:
      'Estrada Matapoã, 2288 — Matapoã (Parque Santo Antonio), Aracaju-SE, na foz do rio Vaza-Barris. Estacionamento coberto e gratuito.',
  },
  {
    id: 'entrada',
    titulo: 'Entrada / couvert',
    conteudo: '[PENDENTE] Preencher: paga entrada? couvert artístico? valores?',
  },
  {
    id: 'aquaarena',
    titulo: 'Parque AquaArena',
    conteudo:
      '[PENDENTE] Preencher: status do parque (site dizia reabertura prevista pra julho/2026), dias, horários e preços.',
  },
  {
    id: 'cardapio',
    titulo: 'Cardápio e música',
    conteudo:
      'Cardápio online: prainha.menudino.com.br — destaques: Camarão Paris, moqueca de camarão, picanha Angus e o drink Prainha Sunset. [PENDENTE] dias e horários da música ao vivo.',
  },
  {
    id: 'reservas',
    titulo: 'Reserva de mesa',
    conteudo:
      'Reserva de mesa é pelo site www.prainhabar.com (botão Reservar). A mesa fica guardada por até 15 minutos após o horário marcado.',
  },
  {
    id: 'tabuara',
    titulo: 'Tabuará',
    conteudo:
      '[PENDENTE] Informações do Tabuará: endereço, horários, cardápio e diferenças em relação ao Prainha.',
  },
  {
    id: 'contato',
    titulo: 'Contatos',
    conteudo:
      'WhatsApp: (79) 99600-7289 · Instagram @prainha.se · E-mail prainha@prainhabar.com',
  },
];

const ESPACOS = [
  {
    id: 'gramado',
    nome: 'Gramado',
    capacidade: 'eventos ao ar livre (casamentos e cerimônias)',
    descricao: 'Gramado à beira do rio, usado pra casamentos e eventos ao ar livre.',
    preco: '',
    condicoes: '',
    ativo: true,
  },
  {
    id: 'terraco',
    nome: 'Terraço',
    capacidade: 'até 50 pessoas sentadas',
    descricao: 'Espaço que fica fechado no dia a dia e abre pra eventos.',
    preco: '',
    condicoes: '',
    ativo: true,
  },
  {
    id: 'varandinha',
    nome: 'Varandinha',
    capacidade: '15 a 20 pessoas',
    descricao: 'Varanda menor, boa pra grupos e comemorações mais intimistas.',
    preco: '',
    condicoes: '',
    ativo: true,
  },
];

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
  console.log('[1] Tabelas');
  await run('whatsapp_numero', () =>
    sql`
      CREATE TABLE IF NOT EXISTS whatsapp_numero (
        phone_number_id text PRIMARY KEY,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        numero_exibicao varchar(20),
        atendente_ativo boolean NOT NULL DEFAULT false,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('atendimento_conversa', () =>
    sql`
      CREATE TABLE IF NOT EXISTS atendimento_conversa (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        telefone varchar(20) NOT NULL,
        nome_cliente varchar(200),
        status varchar(20) NOT NULL DEFAULT 'bot',
        motivo_transferencia text,
        ultima_msg_cliente_em timestamptz,
        ultima_msg_em timestamptz,
        nao_lidas integer NOT NULL DEFAULT 0,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_atend_conversa_filial_fone UNIQUE (filial_id, telefone)
      )
    `,
  );
  await run('idx conversa ultima', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_atend_conversa_ultima ON atendimento_conversa (filial_id, ultima_msg_em)`,
  );
  await run('atendimento_mensagem', () =>
    sql`
      CREATE TABLE IF NOT EXISTS atendimento_mensagem (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversa_id uuid NOT NULL REFERENCES atendimento_conversa(id) ON DELETE CASCADE,
        wa_message_id text UNIQUE,
        direcao varchar(10) NOT NULL,
        autor varchar(12) NOT NULL,
        autor_usuario_id uuid,
        tipo varchar(20) NOT NULL DEFAULT 'texto',
        corpo text,
        media_id text,
        status_envio varchar(20),
        erro text,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx mensagem conversa', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_atend_msg_conversa ON atendimento_mensagem (conversa_id, criado_em)`,
  );
  await run('atendimento_config', () =>
    sql`
      CREATE TABLE IF NOT EXISTS atendimento_config (
        filial_id uuid PRIMARY KEY REFERENCES filial(id) ON DELETE CASCADE,
        ativo boolean NOT NULL DEFAULT false,
        nome_atendente varchar(50) NOT NULL DEFAULT 'Nina',
        persona text,
        conhecimento jsonb,
        espacos_evento jsonb,
        numeros_equipe jsonb,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('evento_lead', () =>
    sql`
      CREATE TABLE IF NOT EXISTS evento_lead (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        conversa_id uuid REFERENCES atendimento_conversa(id) ON DELETE SET NULL,
        nome varchar(200),
        telefone varchar(20),
        tipo_evento varchar(100),
        data_evento date,
        hora varchar(5),
        pessoas integer,
        espaco varchar(100),
        observacoes text,
        status varchar(20) NOT NULL DEFAULT 'novo',
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx lead filial', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_evento_lead_filial ON evento_lead (filial_id, status)`,
  );

  console.log('[2] Permissoes');
  const perms = [
    ['atendimento.read', 'read', 'Ver conversas do WhatsApp e leads de evento'],
    ['atendimento.responder', 'responder', 'Assumir conversas e responder como equipe'],
    ['atendimento.config', 'config', 'Configurar a Nina (persona, conhecimento, espaços, equipe)'],
  ] as const;
  for (const [codigo, acao, descricao] of perms) {
    await run(`permissao ${codigo}`, () =>
      sql`
        INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
        VALUES (${codigo}, 'atendimento', ${acao}, ${descricao}, 'filial')
        ON CONFLICT (codigo) DO NOTHING
      `,
    );
  }
  await run('vincular a Admin/Gerente', () =>
    sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
      WHERE g.sistema = true AND g.nome IN ('Admin', 'Gerente')
        AND p.modulo = 'atendimento'
      ON CONFLICT DO NOTHING
    `,
  );

  console.log('[3] Seeds');
  await run('whatsapp_numero atual -> Prainha (inativo)', () =>
    sql`
      INSERT INTO whatsapp_numero (phone_number_id, filial_id, atendente_ativo)
      VALUES (${PHONE_ID_ATUAL}, ${FILIAL_PRAINHA}, false)
      ON CONFLICT (phone_number_id) DO NOTHING
    `,
  );
  await run('atendimento_config Prainha (Nina)', () =>
    sql`
      INSERT INTO atendimento_config
        (filial_id, ativo, nome_atendente, persona, conhecimento, espacos_evento, numeros_equipe)
      VALUES
        (${FILIAL_PRAINHA}, false, 'Nina', ${PERSONA_NINA},
         ${sql.json(CONHECIMENTO)}, ${sql.json(ESPACOS)}, ${sql.json([])})
      ON CONFLICT (filial_id) DO NOTHING
    `,
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
