CREATE TABLE "cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"cpf_ou_cnpj" varchar(14),
	"nome" varchar(200),
	"email" varchar(200),
	"telefone" varchar(30),
	"data_delete" timestamp with time zone,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cliente_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "movimento_conta_corrente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"codigo_cliente_externo" integer,
	"codigo_pedido_externo" integer,
	"cliente_id" uuid,
	"data_hora" timestamp with time zone,
	"saldo_inicial" numeric(14, 2),
	"credito" numeric(14, 2),
	"debito" numeric(14, 2),
	"saldo_final" numeric(14, 2),
	"codigo_pagamento" integer,
	"codigo_usuario" integer,
	"codigo_conta_estornada" integer,
	"observacao" text,
	"importado" varchar(10),
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_mcc_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "pedido" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"numero" integer,
	"senha" varchar(30),
	"codigo_cliente_contato_externo" integer,
	"codigo_cliente_fiado_externo" integer,
	"nome_cliente" varchar(200),
	"codigo_colaborador" integer,
	"codigo_usuario_criador" integer,
	"data_abertura" timestamp with time zone,
	"data_fechamento" timestamp with time zone,
	"valor_total" numeric(14, 2),
	"valor_total_itens" numeric(14, 2),
	"subtotal_pago" numeric(14, 2),
	"total_desconto" numeric(14, 2),
	"percentual_desconto" numeric(8, 4),
	"total_acrescimo" numeric(14, 2),
	"total_servico" numeric(14, 2),
	"percentual_taxa_servico" numeric(8, 4),
	"valor_entrega" numeric(14, 2),
	"valor_troco" numeric(14, 2),
	"valor_iva" numeric(14, 2),
	"quantidade_pessoas" integer,
	"nota_emitida" boolean,
	"tag" varchar(100),
	"codigo_pedido_origem" integer,
	"codigo_cupom" integer,
	"data_delete" timestamp with time zone,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pedido_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "pedido_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer NOT NULL,
	"codigo_pedido_externo" integer NOT NULL,
	"codigo_produto_externo" integer,
	"pedido_id" uuid,
	"produto_id" uuid,
	"nome_produto" varchar(200),
	"quantidade" numeric(14, 3),
	"valor_unitario" numeric(14, 4),
	"preco_custo" numeric(14, 4),
	"valor_item" numeric(14, 2),
	"valor_complemento" numeric(14, 2),
	"valor_filho" numeric(14, 2),
	"valor_desconto" numeric(14, 2),
	"valor_gorjeta" numeric(14, 2),
	"valor_total" numeric(14, 2),
	"codigo_pai" integer,
	"codigo_item_pedido_tipo" integer,
	"codigo_pagamento" integer,
	"codigo_colaborador" integer,
	"data_hora_cadastro" timestamp with time zone,
	"data_delete" timestamp with time zone,
	"detalhes" text,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pedido_item_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "produto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"codigo_externo" integer,
	"nome" varchar(200),
	"descricao" text,
	"codigo_personalizado" varchar(50),
	"codigo_etiqueta" varchar(50),
	"preco_venda" numeric(14, 4),
	"preco_custo" numeric(14, 4),
	"estoque_atual" numeric(14, 3),
	"estoque_minimo" numeric(14, 3),
	"estoque_controlado" boolean,
	"descontinuado" boolean,
	"item_por_kg" boolean,
	"codigo_unidade_comercial" integer,
	"codigo_produto_tipo" integer,
	"codigo_cozinha" integer,
	"ncm" varchar(10),
	"cfop" varchar(10),
	"cest" varchar(10),
	"tipo" varchar(20) DEFAULT 'VENDA_SIMPLES' NOT NULL,
	"unidade_estoque" varchar(10) DEFAULT 'un' NOT NULL,
	"controla_estoque" boolean DEFAULT true NOT NULL,
	"criado_na_nuvem" boolean DEFAULT false NOT NULL,
	"versao_reg" integer,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_produto_filial_codigo" UNIQUE("filial_id","codigo_externo")
);
--> statement-breakpoint
CREATE TABLE "nota_compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"chave" varchar(44) NOT NULL,
	"modelo" integer,
	"serie" integer,
	"numero" integer,
	"tipo_operacao" integer,
	"natureza_operacao" varchar(200),
	"emit_cnpj" varchar(14),
	"emit_nome" varchar(200),
	"emit_fantasia" varchar(200),
	"emit_ie" varchar(30),
	"emit_uf" varchar(2),
	"emit_cidade" varchar(100),
	"fornecedor_id" uuid,
	"dest_cnpj" varchar(14),
	"dest_nome" varchar(200),
	"data_emissao" timestamp with time zone,
	"data_entrada" timestamp with time zone,
	"valor_total" numeric(14, 2),
	"valor_produtos" numeric(14, 2),
	"valor_frete" numeric(14, 2),
	"valor_seguro" numeric(14, 2),
	"valor_desconto" numeric(14, 2),
	"valor_outros" numeric(14, 2),
	"valor_icms" numeric(14, 2),
	"valor_icms_st" numeric(14, 2),
	"valor_ipi" numeric(14, 2),
	"valor_pis" numeric(14, 2),
	"valor_cofins" numeric(14, 2),
	"situacao" varchar(30),
	"protocolo_autorizacao" varchar(50),
	"data_autorizacao" timestamp with time zone,
	"xml_storage_path" text,
	"xml_hash" varchar(64),
	"origem_importacao" varchar(20) DEFAULT 'UPLOAD',
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_nota_compra_chave" UNIQUE("filial_id","chave")
);
--> statement-breakpoint
CREATE TABLE "nota_compra_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"nota_compra_id" uuid NOT NULL,
	"numero_item" integer NOT NULL,
	"codigo_produto_fornecedor" varchar(60),
	"ean" varchar(20),
	"descricao" text,
	"ncm" varchar(10),
	"cest" varchar(10),
	"cfop" varchar(10),
	"unidade" varchar(10),
	"quantidade" numeric(14, 4),
	"valor_unitario" numeric(14, 6),
	"valor_total" numeric(14, 2),
	"valor_desconto" numeric(14, 2),
	"valor_frete" numeric(14, 2),
	"valor_icms" numeric(14, 2),
	"aliquota_icms" numeric(8, 4),
	"valor_ipi" numeric(14, 2),
	"valor_pis" numeric(14, 2),
	"valor_cofins" numeric(14, 2),
	"produto_id" uuid
);
--> statement-breakpoint
CREATE TABLE "certificado_filial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"cnpj_certificado" varchar(14),
	"cn" varchar(300),
	"pfx_storage_path" text NOT NULL,
	"senha_cifrada" text NOT NULL,
	"validade_inicio" date,
	"validade_fim" date,
	"nome_arquivo" varchar(200),
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_nsu" varchar(15),
	"ultima_consulta_sefaz" timestamp with time zone,
	"uploadado_por" uuid,
	"uploadado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cert_filial_ativo" UNIQUE("filial_id","ativo")
);
--> statement-breakpoint
CREATE TABLE "ficha_tecnica" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"insumo_id" uuid NOT NULL,
	"quantidade" numeric(14, 4) NOT NULL,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ficha_prod_insumo" UNIQUE("produto_id","insumo_id")
);
--> statement-breakpoint
CREATE TABLE "movimento_estoque" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"tipo" varchar(30) NOT NULL,
	"quantidade" numeric(14, 4) NOT NULL,
	"preco_unitario" numeric(14, 6),
	"valor_total" numeric(14, 2),
	"data_hora" timestamp with time zone NOT NULL,
	"nota_compra_item_id" uuid,
	"pedido_item_id" uuid,
	"movimento_pai_id" uuid,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produto_fornecedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filial_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"codigo_fornecedor" varchar(60),
	"ean" varchar(20),
	"descricao_fornecedor" text,
	"unidade_fornecedor" varchar(10),
	"fator_conversao" numeric(14, 6) DEFAULT '1' NOT NULL,
	"ultimo_preco_custo" numeric(14, 4),
	"ultimo_preco_custo_unidade" numeric(14, 6),
	"ultima_compra_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_prod_forn_codigo" UNIQUE("fornecedor_id","codigo_fornecedor")
);
--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_conta_corrente" ADD CONSTRAINT "movimento_conta_corrente_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_conta_corrente" ADD CONSTRAINT "movimento_conta_corrente_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto" ADD CONSTRAINT "produto_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_compra" ADD CONSTRAINT "nota_compra_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_compra" ADD CONSTRAINT "nota_compra_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_compra_item" ADD CONSTRAINT "nota_compra_item_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_compra_item" ADD CONSTRAINT "nota_compra_item_nota_compra_id_nota_compra_id_fk" FOREIGN KEY ("nota_compra_id") REFERENCES "public"."nota_compra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nota_compra_item" ADD CONSTRAINT "nota_compra_item_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificado_filial" ADD CONSTRAINT "certificado_filial_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ficha_tecnica" ADD CONSTRAINT "ficha_tecnica_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ficha_tecnica" ADD CONSTRAINT "ficha_tecnica_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ficha_tecnica" ADD CONSTRAINT "ficha_tecnica_insumo_id_produto_id_fk" FOREIGN KEY ("insumo_id") REFERENCES "public"."produto"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_nota_compra_item_id_nota_compra_item_id_fk" FOREIGN KEY ("nota_compra_item_id") REFERENCES "public"."nota_compra_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_pedido_item_id_pedido_item_id_fk" FOREIGN KEY ("pedido_item_id") REFERENCES "public"."pedido_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_fornecedor" ADD CONSTRAINT "produto_fornecedor_filial_id_filial_id_fk" FOREIGN KEY ("filial_id") REFERENCES "public"."filial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_fornecedor" ADD CONSTRAINT "produto_fornecedor_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_fornecedor" ADD CONSTRAINT "produto_fornecedor_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cliente_cpf" ON "cliente" USING btree ("filial_id","cpf_ou_cnpj");--> statement-breakpoint
CREATE INDEX "idx_mcc_cliente" ON "movimento_conta_corrente" USING btree ("filial_id","cliente_id");--> statement-breakpoint
CREATE INDEX "idx_mcc_data" ON "movimento_conta_corrente" USING btree ("filial_id","data_hora");--> statement-breakpoint
CREATE INDEX "idx_pedido_data" ON "pedido" USING btree ("filial_id","data_fechamento");--> statement-breakpoint
CREATE INDEX "idx_pedido_cliente" ON "pedido" USING btree ("filial_id","codigo_cliente_contato_externo");--> statement-breakpoint
CREATE INDEX "idx_pedido_item_pedido" ON "pedido_item" USING btree ("filial_id","codigo_pedido_externo");--> statement-breakpoint
CREATE INDEX "idx_pedido_item_produto" ON "pedido_item" USING btree ("filial_id","codigo_produto_externo");--> statement-breakpoint
CREATE INDEX "idx_produto_nome" ON "produto" USING btree ("filial_id","nome");--> statement-breakpoint
CREATE INDEX "idx_produto_tipo" ON "produto" USING btree ("filial_id","tipo");--> statement-breakpoint
CREATE INDEX "idx_produto_etiqueta" ON "produto" USING btree ("filial_id","codigo_etiqueta");--> statement-breakpoint
CREATE INDEX "idx_nota_compra_emissao" ON "nota_compra" USING btree ("filial_id","data_emissao");--> statement-breakpoint
CREATE INDEX "idx_nota_compra_fornecedor" ON "nota_compra" USING btree ("filial_id","fornecedor_id");--> statement-breakpoint
CREATE INDEX "idx_nota_compra_item_nota" ON "nota_compra_item" USING btree ("nota_compra_id");--> statement-breakpoint
CREATE INDEX "idx_nota_compra_item_produto" ON "nota_compra_item" USING btree ("filial_id","produto_id");--> statement-breakpoint
CREATE INDEX "idx_nota_compra_item_ean" ON "nota_compra_item" USING btree ("filial_id","ean");--> statement-breakpoint
CREATE INDEX "idx_ficha_produto" ON "ficha_tecnica" USING btree ("filial_id","produto_id");--> statement-breakpoint
CREATE INDEX "idx_ficha_insumo" ON "ficha_tecnica" USING btree ("filial_id","insumo_id");--> statement-breakpoint
CREATE INDEX "idx_mov_est_produto_data" ON "movimento_estoque" USING btree ("filial_id","produto_id","data_hora");--> statement-breakpoint
CREATE INDEX "idx_mov_est_data" ON "movimento_estoque" USING btree ("filial_id","data_hora");--> statement-breakpoint
CREATE INDEX "idx_mov_est_tipo" ON "movimento_estoque" USING btree ("filial_id","tipo");--> statement-breakpoint
CREATE INDEX "idx_mov_est_nota" ON "movimento_estoque" USING btree ("nota_compra_item_id");--> statement-breakpoint
CREATE INDEX "idx_mov_est_pedido" ON "movimento_estoque" USING btree ("pedido_item_id");--> statement-breakpoint
CREATE INDEX "idx_prod_forn_produto" ON "produto_fornecedor" USING btree ("produto_id");--> statement-breakpoint
CREATE INDEX "idx_prod_forn_fornecedor" ON "produto_fornecedor" USING btree ("fornecedor_id");--> statement-breakpoint
CREATE INDEX "idx_prod_forn_ean" ON "produto_fornecedor" USING btree ("filial_id","ean");