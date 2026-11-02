# Servidor de demonstração do Concilia

O vendas-local das lojas, rodando na nuvem com um cardápio de exemplo (984 itens,
sem nome das casas). Quem baixa o Concilia na maquininha digita **`demo`** em
"Buscar empresa" e entra com **login `teste` / PIN `1234`**.

Testado no Mac em 02/11/2026: login, cardápio, lançar na mesa, 10% de serviço,
receber em dinheiro e fechar a conta. Sem `FILIAL_ID`/`AGENTE_TOKEN`, nada sobe
pra nuvem de produção. `PAGAMENTO_MANUAL=on` deixa testar sem passar cartão.

## Subir na Fly.io (uma vez)

1. Criar conta em fly.io e instalar o flyctl: `brew install flyctl`, depois `fly auth login`.
2. De dentro de `vendas-local`:
   - `fly apps create concilia-demo`
   - `fly postgres create --name concilia-demo-db --region gru` (o menor plano serve)
   - `fly postgres attach concilia-demo-db --app concilia-demo --variable-name PG_URL`
   - `fly deploy . --config demo/fly.toml`
3. Na Vercel (projeto prainha-web, Production): `LIO_DEMO_URL=https://concilia-demo.fly.dev` e redeploy.
4. Conferir: `https://app.prainhabar.com/api/app/filiais?empresa=demo` devolve a URL.

## Zerar as vendas de teste

`fly secrets set DEMO_ZERAR=1 --app concilia-demo` (reinicia e recomeça do
cardápio), depois `fly secrets unset DEMO_ZERAR --app concilia-demo`.
