# Vendas local‑first — Fase 0 (Fundação) — Filial 0001 (Prainha Bar) [piloto]

> Piloto movido de 0003 → **0001 (Prainha Bar)**: já temos toda a info dela e o Firebird (`10.0.0.252:3050`) é **alcançável pela VPN** (testado), então dá pra construir/testar remotamente.

**Data:** 2026‑07‑23
**Status:** design pra revisão
**Contexto maior:** substituir, de forma incremental, a parte de **vendas** do Consumer (RAL) por um sistema próprio **local‑first** (banco local na loja + Supabase como consolidado na nuvem). Esta spec cobre **só a Fase 0**. As fases 1–4 (comanda, pagamento, fiscal, virada) terão specs próprias.

---

## 1. Objetivo da Fase 0

Provar a **plumbing local‑first** — banco local + sincronização + um app local que funciona **offline** — **sem tocar em venda, dinheiro ou fiscal**. O Consumer continua 100% oficial. É a base reversível de tudo que vem depois.

Entregável concreto: um **Monitor de Vendas (somente leitura)** rodando na rede da 0003, lendo do **Postgres local**, que continua funcionando mesmo com a internet caída.

## 2. Fora de escopo (Fase 0 NÃO faz)

- Nenhuma comanda/venda escrita pelo sistema novo.
- Nenhum pagamento, nenhuma emissão de NFC‑e, nenhuma baixa de estoque.
- Nenhum desligamento de nada do Consumer.

## 3. O que já existe (ponto de partida) — 0001

- **Consumer/Firebird** em `10.0.0.252:3050` (SYSDBA/masterkey), servidor WIN‑3TT8LMSANUH — **alcançável do Mac pela VPN** (testado). DB: `C:\Users\Administrator\AppData\Local\RAL Tecnologia\CreateInstall\consumer.fdb`.
- Já existe leitura pronta desse Firebird: `agente-local` + `agente-local/cardapio-dev.mjs` (lê PEDIDOS/PRODUTODETALHE da 0001).
- Supabase (nuvem) já é o consolidado do concilia, alimentado pelo agente/CDC.
- Schema Drizzle do concilia (`packages/db/src/schema`) já modela `produto`, `pedido`, `itemPedido`, `filial`, etc. — **reutilizável** no Postgres local.
- ⚠️ **Postgres local na 0001: A CONFIRMAR.** Porta 5432 em `10.0.0.252` deu timeout pela VPN — pode não ter Postgres (a 0003 tinha), ou ter só em localhost, ou em outro host. **Decidir onde roda o Postgres local da 0001** (mesmo servidor 10.0.0.252, ou um mini‑PC dedicado na LAN da loja).

## 4. Componentes (todos rodando na máquina da 0003)

1. **Postgres local** *(a INSTALAR na Xeon — decisão A; convive com o Firebird do Consumer)*
   - Recebe um schema **operacional** = subconjunto do schema do concilia (produtos/catálogo + pedidos/itens espelhados).
   - Migrations reaproveitando o Drizzle do concilia (mesmo "idioma" do Supabase → sync limpo).
   - Roda em `localhost` na máquina; o app do monitor conecta local.

2. **Sync worker** *(Node, novo — roda como serviço na máquina)*
   - **Down (catálogo):** puxa `produto`/preços/config do **Supabase → Postgres local** (upsert idempotente por chave). Periódico (ex.: a cada 5 min) + no boot.
   - **Espelho de vendas (sombra):** lê `PEDIDOS`/`ITENSPEDIDO` do **Firebird (Consumer) → Postgres local**, reusando a lógica de leitura do agente (`agente-local`). Incremental (por `versao`/checkpoint). Dá dado ao vivo pro monitor e prova o store local operacional.

3. **Monitor de Vendas (read‑only)** *(app web local, novo)*
   - Servido na **LAN da loja** (Node/Next local). Lê **só** o Postgres local.
   - Mostra: comandas abertas, itens, totais, nº de pessoas, garçom, tempo aberto.
   - **Funciona offline** (não depende de internet nem do Supabase).
   - **Dois formatos de tela (definido pelo user):**
     - **Smart TV (fixa)** — visão de **produção/cozinha (KDS)**: os pedidos que entram.
     - **Tablet (móvel)** — o corredor/expedidor **puxa a comanda pronta da produção e leva pra entrega** (mesa).
   - *Nota:* na Fase 0 é **só leitura** (mostra o que o Consumer produz). O KDS **interativo** (marcar em produção → pronto → entregue) entra na **Fase 1**.

## 5. Fluxo de dados

```
Supabase (nuvem)  ──(down: catálogo)──▶  Postgres LOCAL  ◀──(espelho: vendas)── Firebird/Consumer (local)
                                              │
                                              ▼
                                     Monitor de Vendas (LAN, read-only)
```

- Nenhum caminho crítico passa pela internet.
- O "sobe" (local→Supabase) **não é necessário na Fase 0**: as vendas ainda são do Consumer, que já sobe via agente. (Entra na Fase 1+, quando o sistema novo começa a gravar venda.)

## 6. Erros / offline (o teste que importa)

- **Internet cai:** o down‑sync do catálogo pausa (fica com a última cópia); o espelho Firebird→Postgres e o Monitor **seguem funcionando** (tudo local). ← *isto é o que a Fase 0 precisa provar.*
- **Sync idempotente:** upsert por chave natural (`filial_id + codigo_externo`), reprocessável sem duplicar.
- **Checkpoint** do espelho persistido no Postgres local (retoma de onde parou).

## 7. Como validar (critérios de aceite)

1. **Offline:** desligar a internet da máquina → o Monitor continua mostrando as comandas abertas (lendo local). ✅
2. **Catálogo:** produtos/preços no Postgres local batem com o Supabase. ✅
3. **Espelho:** comandas/itens no Postgres local batem com o que está aberto no Consumer (conferência amostral). ✅
4. **Zero impacto:** Consumer opera normalmente, sem lentidão perceptível causada pelo worker. ✅

## 8. Perguntas — status

- ✅ **Recursos da máquina:** user confirmou que aguenta.
- ✅ **Monitor:** Smart TV (KDS de produção) + tablet (puxar comanda pronta → entrega).
- ✅ **DECIDIDO (opção A):** a 0001 hoje tem **só Firebird** (Consumer), **sem Postgres**. O banco do **sistema novo** será um **Postgres local a INSTALAR na Xeon** (`10.0.0.252`), convivendo com o Firebird. O Firebird fica só pro Consumer (lido na transição). Postgres roda em **`localhost`** (não exposto na rede — correto por segurança). Pra **construir**, não preciso do Postgres exposto: leio o Firebird pela VPN e a instalação/migrations na máquina fazemos por comandos no remote desktop.
- ⏳ **Rede:** IP fixo do host do Postgres/monitor na LAN da 0001 (pros aparelhos acharem o monitor e pro meu acesso via VPN).

## 9. Pré‑requisitos não‑código (encaminhar em paralelo, pras fases seguintes)

- **Certificado A1 da 0003** ativo (necessário só na Fase 3 — fiscal).
- **Contador** no circuito pro fiscal (CST/CFOP/alíquotas) — Fase 3.
- **IBS/CBS (reforma tributária):** só entra pra valer **ano que vem** e ainda está em definição pra todo mundo — **não trava nada agora**. Quando entrar, quem cuida do layout é o **emissor** (ACBr/middleware), não o nosso código. Mais um motivo pra não construir o fiscal na mão.

## 10. Depois da Fase 0

Fase 1 = captura de comanda + cozinha (o sistema novo começa a **gravar** venda no Postgres local, em paralelo ao Consumer, numa mesa piloto). Terá spec própria.
