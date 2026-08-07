# Concilia Garçom — app da maquininha Cielo (LIO V3 / DX8000)

A **venda do garçom rodando DENTRO da maquininha**: abrir mesa, lançar itens do
cardápio (com wizard de perguntas do Consumer), conferência impressa na térmica,
e **receber na mesa pelo próprio terminal** (Order Manager SDK — cartão inserido/
aproximado/PIX), com baixa automática no vendas-local → Firebird do Consumer →
conciliação nível 1 com o EDI da Cielo (NSU + autorização).

Backend: o **vendas-local** da loja (`../vendas-local/server.mjs`, HTTP :8790 na
LAN). Rotas criadas pra este app: `GET /api/config` e `POST /api/lio/pagar`
(deduplica por NSU — reenviar é seguro). **Essas rotas exigem redeploy do
vendas-local nas lojas** (ZIP + .bat, ver `vendas-local/deploy-xeon/LEIA-ME.txt`).

## Arquitetura (espelho do runbook do CupomPro)

- **SDK Cielo vendorado** em `sdk/` (order-manager 2.5.5 + event-tracker) — repo
  Maven local; buildável em qualquer máquina sem setup.
- **Zero WebView** (PCI do DX8000 — reprovação real), zero OkHttp: rede é
  `HttpURLConnection` puro (`Api.kt`), auth por header `x-garcom`.
- **Pagamento NO terminal** (`Lio.kt`): `createDraftOrder` com os itens reais da
  conta → `checkoutOrder` (cliente escolhe crédito/débito/PIX na UI nativa) →
  `onPayment` extrai NSU/authCode/bandeira → `POST /api/lio/pagar`.
- **Fila de pendentes** (`Pendentes.kt`): pagamento aprovado entra na fila ANTES
  do registro; só sai quando o servidor confirmar. Rede caiu = reenvia da tela
  de mesas. Dinheiro capturado não se perde nem duplica (dedup por NSU no servidor).
- **Cleartext só pros IPs das lojas** (`network_security_config.xml`):
  10.0.0.252 (Prainha Bar) e 192.168.10.60 (Tabuará). Loja nova/IP novo = editar
  o XML e gerar APK novo. URLs `https://` (túnel de certificação) sempre funcionam.
- **Build dir fora do SSD exFAT** (`~/.concilia-lio-build`) — AppleDouble (`._*`)
  quebra o AGP.
- **Fora da maquininha** o app vira consulta/lançamento (bind falha → botão de
  receber some). Dá pra testar num celular Android comum por sideload.

## Build

```bash
cd lio-app
./build-release.sh          # release assinado + 4 verificações → dist/concilia-garcom-vX.Y.Z.apk
```

Debug (sem credenciais Cielo, pra testar em celular):
`JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew :app:assembleDebug`
(APK em `~/.concilia-lio-build/app/outputs/apk/debug/`).

Requisitos já resolvidos nesta máquina: JDK 17 (brew), Android SDK em
`~/Library/Android/sdk-cupompro` (platform 34), Gradle 8.10.2 via wrapper.

### secrets.properties (gitignorado)

Copie de `secrets.properties.example`. Falta preencher **CIELO_CLIENT_ID** e
**CIELO_ACCESS_TOKEN** (Dev Console). A keystore já está criada e configurada:

- **`~/concilia-lio-release.keystore`** · alias `concilia` · senha no
  `secrets.properties` local. **FAÇA BACKUP do arquivo + senha** (Google Drive,
  1Password, qualquer coisa fora deste SSD). Perder a keystore = nunca mais
  atualizar o app na Cielo Store (update com assinatura diferente é rejeitado).
- Verificações do `build-release.sh`: assinatura ok, **zero `android.webkit`**
  no dex, SDK Cielo presente, Client ID embutido. Qualquer uma falhando aborta.

## O que o ELISON precisa fazer (o app não anda sem isso)

1. **Dev Console** — `desenvolvedores.cielo.com.br` → Dev Console → **Cadastrar
   Nova App** (nome: Concilia Garçom) → copiar **Client ID** e **Access Token**
   → colar em `lio-app/secrets.properties` → rodar `./build-release.sh`.
2. **Cielo Store** — `www.cieloliostore.com.br` → criar o app como **loja
   PRIVADA** (sistema interno) → subir o APK de `dist/`, o ícone
   (`store-assets/icon-512.png`) e screenshots 750x1334 (tirar do app rodando;
   divergência tela × screenshot reprova).
3. **Instalar na maquininha** — console da Store → Ver detalhes → **Baixar App**
   → escolher o tipo (LIO On V3 / DX8000) → QR na tela → app **Test Your App**
   na maquininha lê o QR e instala.
   - Sem o Test Your App no terminal: e-mail pra `integracaosmart@cielo.com.br`,
     assunto exato **"Liberação Test Your App"**, corpo com EC + número lógico
     (Configurações do terminal ou cabeçalho de comprovante).
4. **Redeploy do vendas-local** nas lojas (as rotas novas `/api/config` e
   `/api/lio/pagar` precisam estar no servidor da loja).
5. **Testes reais na maquininha** (com caixa aberto no Consumer!):
   aprovada (cartão E PIX), **cancelada** (X na tela de pagamento) e recusada.
   Conferir no `/caixa` da loja e na conciliação que o NSU/bandeira gravaram.
6. **Certificação** (formulário da versão no console da Store):
   - Usuário de teste REAL: login do Consumer com a permissão **53**
     (AcessarComandaMobile) + PIN definido — senha do formulário sempre
     sincronizada com o PIN real.
   - O certificador precisa alcançar um vendas-local de verdade: exponha um por
     **túnel HTTPS** (ex.: `cloudflared tunnel --url http://10.0.0.252:8790`) e
     preencha a URL no campo "Outro servidor…" do roteiro. **Caixa aberto no
     Consumer durante a janela de teste** (sem caixa aberto, pagamento falha).
   - Vídeo (YouTube **não listado**): abrir app → **versão visível** (tela de
     login) → login → abrir mesa → lançar itens → **cartão passado NO terminal**
     → aprovação → recibo impresso.
   - Foto nítida do comprovante impresso da transação de teste.
   - Enviar → ~48h úteis → aprovado → **Publicar em produção** (loja privada).

## Fluxo do garçom (o que o app faz)

```
Login (login do Consumer + PIN próprio, permissão 53)
  └─ Mesas: grade ao vivo (verde andamento / âmbar atrasada / vermelho fechando)
      ├─ nº digitado abre QUALQUER mesa (vazia = primeiro envio abre a conta)
      └─ Conta da mesa/comanda (números AO VIVO do Firebird)
          ├─ ＋ Lançar: categorias → variantes → wizard de perguntas → obs → ENVIAR
          │    (o servidor reprecifica, grava no Consumer e imprime na cozinha)
          ├─ 🖨 Conferência na térmica da maquininha (mesa + comandas penduradas)
          ├─ Pedir conta / Liberar (trava e destrava lançamentos)
          └─ 💳 Receber (integral ou parcial) → UI nativa Cielo → NSU/bandeira
               → baixa no vendas-local (retry + fila de pendentes) → recibo
```

Formas registradas no Consumer: crédito→3, débito→4, PIX da maquininha→21
(Pix Online, canal adquirente). Conferir em `/configuracoes/formas-pagamento`
do Concilia que "Pix Online" roteia pelo canal ADQUIRENTE.

## Limitações conhecidas (v1)

- Não cria/vincula comanda nova (usa o celular pra isso); comandas existentes
  aparecem e funcionam normalmente.
- Não identifica mesa (nome/CPF) — celular também.
- `sem_estoque` só avisa (o servidor aceita lançar — regra da casa).
- Estorno: pela Cielo (app da maquininha não estorna) — depois ajustar o
  Consumer manualmente se precisar.
