CREATE TABLE "filial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" varchar(200) NOT NULL,
	"cnpj" varchar(14) NOT NULL,
	"agente_token" text NOT NULL,
	"ultimo_ping" timestamp with time zone,
	"data_inicio_conciliacao" date,
	"taxas" jsonb,
	"tolerancia_auto_aceite" numeric(10, 2) DEFAULT '0.90' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filial_agente_token_unique" UNIQUE("agente_token")
);
--> statement-breakpoint
CREATE TABLE "organizacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(200) NOT NULL,
	"cnpj_raiz" varchar(8),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(200) NOT NULL,
	"nome" varchar(200),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "usuario_filial" (
	"usuario_id" uuid NOT NULL,
	"filial_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_filial_usuario_id_filial_id_pk" PRIMARY KEY("usuario_id","filial_id")
);
--> statement-breakpoint
CREATE TABLE "pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"codigo_pedido_externo" integer,
	"forma_pagamento" varchar(255),
	"valor" numeric(14, 2) NOT NULL,
	"percentual_taxa" numeric(8, 4),
	"data_pagamento" timestamp with time zone,
	"data_credito" timestamp with time zone,
	"nsu_transacao" varchar(50),
	"numero_autorizacao_cartao" varchar(50),
	"bandeira_mfe" varchar(50),
	"adquirente_mfe" varchar(255),
	"nro_parcela" smallint,
	"codigo_credenciadora_cartao" smallint,
	"codigo_conta_corrente" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone,
	CONSTRAINT "pagamento_filial_codigo_unique" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "sincronizacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"ultimo_codigo_externo_pagamento" integer DEFAULT 0,
	"ultima_sincronizacao" timestamp with time zone,
	"total_registros_sincronizados" bigint DEFAULT 0,
	CONSTRAINT "sincronizacao_filial_id_unique" UNIQUE("filial_id")
);
--> statement-breakpoint
CREATE TABLE "estabelecimento_adquirente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"adquirente" varchar(30) NOT NULL,
	"codigo_estabelecimento" varchar(30) NOT NULL,
	"apelido" varchar(100),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estabelecimento_adquirente_adquirente_codigo_estabelecimento_unique" UNIQUE("adquirente","codigo_estabelecimento")
);
--> statement-breakpoint
CREATE TABLE "recebivel_adquirente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"adquirente" varchar(30) NOT NULL,
	"codigo_estabelecimento" varchar(30),
	"data_pagamento" date NOT NULL,
	"data_venda" date,
	"forma_pagamento" varchar(50),
	"bandeira" varchar(50),
	"valor_bruto" numeric(14, 2) NOT NULL,
	"valor_taxa" numeric(14, 2),
	"valor_liquido" numeric(14, 2) NOT NULL,
	"nsu" varchar(50) NOT NULL,
	"autorizacao" varchar(50),
	"status" varchar(30),
	"arquivo_origem" text,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rec_adq_filial_nsu_unique" UNIQUE("filial_id","adquirente","nsu","data_pagamento","autorizacao")
);
--> statement-breakpoint
CREATE TABLE "venda_adquirente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"adquirente" varchar(30) NOT NULL,
	"codigo_estabelecimento" varchar(30),
	"data_venda" date NOT NULL,
	"hora_venda" varchar(8),
	"forma_pagamento" varchar(50),
	"bandeira" varchar(50),
	"valor_bruto" numeric(14, 2) NOT NULL,
	"valor_taxa" numeric(14, 2),
	"valor_liquido" numeric(14, 2),
	"nsu" varchar(50) NOT NULL,
	"autorizacao" varchar(50),
	"tid" varchar(50),
	"data_prevista_pagamento" date,
	"arquivo_origem" text,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venda_adq_filial_nsu_unique" UNIQUE("filial_id","adquirente","nsu","data_venda","autorizacao")
);
--> statement-breakpoint
CREATE TABLE "conta_bancaria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"banco" varchar(100) NOT NULL,
	"codigo_banco" varchar(5),
	"agencia" varchar(10),
	"conta" varchar(30),
	"apelido" varchar(100),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conta_bancaria_codigo_banco_agencia_conta_unique" UNIQUE("codigo_banco","agencia","conta")
);
--> statement-breakpoint
CREATE TABLE "lancamento_banco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_bancaria_id" uuid NOT NULL,
	"filial_id" uuid NOT NULL,
	"data_movimento" date NOT NULL,
	"data_execucao" date,
	"tipo" char(1) NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"codigo_historico" varchar(20),
	"descricao" varchar(100),
	"id_transacao" varchar(50),
	"arquivo_origem" text,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lanc_banco_unique" UNIQUE("conta_bancaria_id","data_movimento","tipo","valor","id_transacao")
);
--> statement-breakpoint
CREATE TABLE "conciliacao_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pagamento_id" uuid NOT NULL,
	"filial_id" uuid NOT NULL,
	"etapa" varchar(30) NOT NULL,
	"venda_adquirente_id" uuid,
	"recebivel_adquirente_id" uuid,
	"lancamentos_banco_ids" jsonb,
	"valor_divergencia" numeric(14, 2),
	"detalhes" jsonb,
	"rodado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conciliacao_pagamento_pagamento_id_unique" UNIQUE("pagamento_id")
);
--> statement-breakpoint
CREATE TABLE "excecao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"processo" varchar(20),
	"pagamento_id" uuid,
	"venda_adquirente_id" uuid,
	"recebivel_adquirente_id" uuid,
	"lancamento_banco_id" uuid,
	"tipo" varchar(50) NOT NULL,
	"severidade" varchar(20) NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(14, 2),
	"detectado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"aceita_em" timestamp with time zone,
	"aceita_por" uuid,
	"observacao" text
);
--> statement-breakpoint
CREATE TABLE "execucao_conciliacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"processo" varchar(20),
	"data_inicio" timestamp with time zone,
	"data_fim" timestamp with time zone,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"finalizado_em" timestamp with time zone,
	"status" varchar(20) DEFAULT 'EM_ANDAMENTO' NOT NULL,
	"resumo" jsonb,
	"erro" text
);
--> statement-breakpoint
CREATE TABLE "fechamento_conciliacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"processo" varchar(20) NOT NULL,
	"data" date NOT NULL,
	"fechado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"fechado_por" uuid,
	"observacao" text
);
--> statement-breakpoint
CREATE TABLE "arquivo_importacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"tipo" varchar(30) NOT NULL,
	"nome_original" text NOT NULL,
	"storage_path" text NOT NULL,
	"tamanho_bytes" bigint,
	"status" varchar(20) DEFAULT 'PENDENTE' NOT NULL,
	"registros_processados" bigint DEFAULT 0,
	"resumo" jsonb,
	"erro" text,
	"enviado_por" uuid,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categoria_conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"codigo_pai_externo" integer,
	"codigo_grupo_dre_externo" integer,
	"descricao" varchar(200),
	"tipo" varchar(20),
	"excluida_em" timestamp with time zone,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cat_conta_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "conta_bancaria_consumer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"descricao" varchar(200),
	"banco" varchar(100),
	"agencia" varchar(20),
	"conta" varchar(30),
	"data_delete" timestamp with time zone,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_conta_bancaria_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "conta_pagar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"codigo_fornecedor_externo" integer,
	"codigo_categoria_externo" integer,
	"codigo_conta_bancaria_externo" integer,
	"fornecedor_id" uuid,
	"categoria_id" uuid,
	"parcela" integer,
	"total_parcelas" integer,
	"data_vencimento" date NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"data_pagamento" date,
	"descontos" numeric(14, 2),
	"juros_multa" numeric(14, 2),
	"valor_pago" numeric(14, 2),
	"codigo_referencia" varchar(50),
	"competencia" varchar(7),
	"descricao" text,
	"observacao" text,
	"data_cadastro" timestamp with time zone,
	"data_delete" timestamp with time zone,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_conta_pagar_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "fornecedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"cnpj_ou_cpf" varchar(14),
	"nome" varchar(200),
	"razao_social" varchar(200),
	"endereco" text,
	"numero" varchar(20),
	"complemento" varchar(100),
	"bairro" varchar(100),
	"cidade" varchar(100),
	"uf" varchar(2),
	"cep" varchar(10),
	"email" varchar(200),
	"fone_principal" varchar(30),
	"fone_secundario" varchar(30),
	"rg_ou_ie" varchar(30),
	"data_delete" timestamp with time zone,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_fornecedor_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
ALTER TABLE "filial" ADD CONSTRAINT "filial_organizacao_id_organizacao_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_filial" ADD CONSTRAINT "usuario_filial_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_filial" ADD CONSTRAINT "usuario_filial_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamento" ADD CONSTRAINT "pagamento_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sincronizacao" ADD CONSTRAINT "sincronizacao_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estabelecimento_adquirente" ADD CONSTRAINT "estabelecimento_adquirente_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recebivel_adquirente" ADD CONSTRAINT "recebivel_adquirente_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_adquirente" ADD CONSTRAINT "venda_adquirente_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_bancaria" ADD CONSTRAINT "conta_bancaria_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_banco" ADD CONSTRAINT "lancamento_banco_conta_bancaria_id_conta_bancaria_id_fk" FOREIGN KEY ("conta_bancaria_id") REFERENCES "public"."conta_bancaria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_banco" ADD CONSTRAINT "lancamento_banco_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conciliacao_pagamento" ADD CONSTRAINT "conciliacao_pagamento_pagamento_id_pagamento_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conciliacao_pagamento" ADD CONSTRAINT "conciliacao_pagamento_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excecao" ADD CONSTRAINT "excecao_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excecao" ADD CONSTRAINT "excecao_pagamento_id_pagamento_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_conciliacao" ADD CONSTRAINT "execucao_conciliacao_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_conciliacao" ADD CONSTRAINT "fechamento_conciliacao_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arquivo_importacao" ADD CONSTRAINT "arquivo_importacao_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arquivo_importacao" ADD CONSTRAINT "arquivo_importacao_enviado_por_usuario_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoria_conta" ADD CONSTRAINT "categoria_conta_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_bancaria_consumer" ADD CONSTRAINT "conta_bancaria_consumer_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_pagar" ADD CONSTRAINT "conta_pagar_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_pagar" ADD CONSTRAINT "conta_pagar_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_pagar" ADD CONSTRAINT "conta_pagar_categoria_id_categoria_conta_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria_conta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedor" ADD CONSTRAINT "fornecedor_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filial_org_idx" ON "filial" USING btree ("organizacao_id");--> statement-breakpoint
CREATE INDEX "uf_filial_idx" ON "usuario_filial" USING btree ("filial_id");--> statement-breakpoint
CREATE INDEX "pagamento_filial_data_idx" ON "pagamento" USING btree ("filial_id","data_pagamento");--> statement-breakpoint
CREATE INDEX "pagamento_nsu_idx" ON "pagamento" USING btree ("nsu_transacao");--> statement-breakpoint
CREATE INDEX "rec_adq_nsu_idx" ON "recebivel_adquirente" USING btree ("nsu");--> statement-breakpoint
CREATE INDEX "rec_adq_data_pag_idx" ON "recebivel_adquirente" USING btree ("filial_id","data_pagamento");--> statement-breakpoint
CREATE INDEX "venda_adq_nsu_idx" ON "venda_adquirente" USING btree ("nsu");--> statement-breakpoint
CREATE INDEX "venda_adq_data_idx" ON "venda_adquirente" USING btree ("filial_id","data_venda");--> statement-breakpoint
CREATE INDEX "lanc_banco_conta_data_idx" ON "lancamento_banco" USING btree ("conta_bancaria_id","data_movimento");--> statement-breakpoint
CREATE INDEX "conc_filial_etapa_idx" ON "conciliacao_pagamento" USING btree ("filial_id","etapa");--> statement-breakpoint
CREATE INDEX "excecao_filial_idx" ON "excecao" USING btree ("filial_id","detectado_em");--> statement-breakpoint
CREATE INDEX "excecao_abertas_idx" ON "excecao" USING btree ("filial_id") WHERE aceita_em IS NULL;--> statement-breakpoint
CREATE INDEX "excecao_processo_idx" ON "excecao" USING btree ("filial_id","processo");--> statement-breakpoint
CREATE INDEX "fechamento_unique_idx" ON "fechamento_conciliacao" USING btree ("filial_id","processo","data");--> statement-breakpoint
CREATE INDEX "fechamento_filial_idx" ON "fechamento_conciliacao" USING btree ("filial_id","processo");--> statement-breakpoint
CREATE INDEX "arquivo_filial_idx" ON "arquivo_importacao" USING btree ("filial_id","enviado_em");--> statement-breakpoint
CREATE INDEX "arquivo_status_idx" ON "arquivo_importacao" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conta_pagar_venc" ON "conta_pagar" USING btree ("filial_id","data_vencimento");--> statement-breakpoint
CREATE INDEX "idx_conta_pagar_pgto" ON "conta_pagar" USING btree ("filial_id","data_pagamento");--> statement-breakpoint
CREATE INDEX "idx_fornecedor_cnpj" ON "fornecedor" USING btree ("filial_id","cnpj_ou_cpf");