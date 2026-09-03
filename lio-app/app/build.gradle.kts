import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Config do app: valores em lio-app/secrets.properties (gitignorado — ver
// secrets.properties.example). Fallback: gradle.properties/-P (vazios no repo).
//   API_BASE=https://app.prainhabar.com   (base das rotas /api/lio)
//   CIELO_CLIENT_ID / CIELO_ACCESS_TOKEN  (Dev Console Cielo → app → credenciais)
//   KEYSTORE_FILE / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD (assinatura release)
val secrets = Properties().apply {
    val f = rootProject.file("secrets.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun conf(name: String, default: String = ""): String =
    secrets.getProperty(name)?.takeIf { it.isNotBlank() }
        ?: (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
        ?: default

val apiBase = conf("API_BASE", "https://app.prainhabar.com")
val cieloClientId = conf("CIELO_CLIENT_ID")
val cieloAccessToken = conf("CIELO_ACCESS_TOKEN")

// Keystore de release (caminho com ~ expandido). Sem keystore configurada o
// release sai SEM assinatura — o Dev Console da Cielo rejeita.
val keystorePath = conf("KEYSTORE_FILE").replaceFirst("^~".toRegex(), System.getProperty("user.home"))
val keystoreOk = keystorePath.isNotBlank() && File(keystorePath).exists()

android {
    namespace = "com.concilia.garcom"
    // LIO V3 = Android 8.1 (API 27); DX8000 = Android 10+. minSdk 25 é o
    // mínimo exigido pelo Order Manager SDK 2.5.5.
    compileSdk = 34

    defaultConfig {
        // ID imutável depois do primeiro upload na Cielo Store — decidido junto
        // com o nome: o app é do PRODUTO (Concilia), o Prainha é a filial.
        applicationId = "com.concilia.garcom"
        minSdk = 25
        targetSdk = 34
        // v1.0.0 — a venda do garçom NA maquininha: abrir mesa, lançar itens do
        // cardápio, conferência, e receber na mesa pelo terminal (Order Manager
        // SDK, integral ou parcial) com baixa no Concilia (NSU/authCode/bandeira)
        // e recibo impresso.
        // A versão que a Store enxerga é ESTA (do manifest) — renomear o .apk
        // não muda nada. 1.3.0 = feedback do teste em campo na 0003: nome da
        // loja em vez de IP (título da página em servidor antigo), pagamentos
        // como lançamentos em vermelho + SALDO, serviço zerado some, e o menu
        // ⋯ (identificar cliente, vincular comanda, transferir/juntar mesas).
        // 1.6.0: rodada de campo na 0003 — cupom centralizado em blocos (mesa
        // e FALTA em negrito, sem observações, rateio por N pessoas, avanço
        // curto), serviço de 10% na tela e aplicado no pedido ao pedir a
        // conta, GERAL mesa+comandas na tela (= cupom), chips de comanda
        // grandes com valor, rodapé uniforme, revisão obrigatória do pedido
        // e identificar bloqueado quando já tem dono.
        // 1.7.0: Receber IDÊNTICO ao do celular — consumo + serviço escolhido
        // (chips 10%/15%) − pago, Dividir por 1–6, ou valor digitado; o
        // servidor aceita o teto com serviço (permitir_servico).
        // 1.8.0: passe de saída na maquininha (QR da catraca em N vias +
        // placas pra cancela LPR, mesa e comanda) e o botão Receber já
        // mostrando o saldo COM os 10% (no dialog dá pra subir pra 15).
        // 1.8.2: "Fechar conta (quitada)" no menu ⋯ — ato final do caixa pela
        // maquininha (rota /api/lio/fechar). Quitou na hora do pagamento, o
        // servidor já fecha sozinho; este botão resolve as quitadas antigas.
        // 1.8.3: conta quitada mostra SALDO 0 (não estima 10% sobre conta paga
        // — serviço é opcional, mesma regra do passe de saída).
        // 1.9.0: NFC-e — ao fechar a conta (pagamento que quita OU botão
        // Fechar), pergunta se o cliente quer nota fiscal; valida CPF/CNPJ
        // (ou confirma o do cadastro), o central emite na SEFAZ e o DANFE
        // com QR Code sai na impressora da própria maquininha.
        // 1.9.1: SEFAZ fora do ar não é erro — a nota cai na FILA da loja
        // (reenvio automático a cada 2 min; DANFE sai na térmica do caixa)
        // e a tela avisa com calma. Erro real ensina a reemissão pelo caixa.
        // 1.9.2: conta da tela quitou = depois do resultado (e do recibo/
        // passe/nota, mesmo com erro) a tela VOLTA SOZINHA pras mesas —
        // ficava presa na mesa morta mostrando "aguardando pagamento".
        // 1.10.1: QR do DANFE/passe desenhado no app (zxing) e impresso como
        // IMAGEM — o printQrCode do SDK da Cielo não imprime em campo (cupom
        // saía com o aviso mas sem o QR; mesma lição já aprendida no CupomPro).
        // 1.10.2: estoque na consulta de produto da maquininha (frente do caixa).
        // 1.10.3: erro de rede CLARO. Servidor desligado mostrava o texto cru
        // do Java ("Unable to resolve host", "failed to connect…"); agora diz
        // "Não encontrei o servidor da loja — confira o endereço e se está
        // ligado" no login, na grade de mesas e no cardápio (Api.msgErroRede).
        // 1.10.4: mesa que o cliente CHAMOU O GARÇOM pisca vermelho na grade
        // (campo chamou_garcom do /api/venda/abertas + AlphaAnimation). O
        // servidor já mostra 🔔+vermelho estático nas versões antigas do app;
        // ESTA faz piscar. NÃO subir agora — guardar pra próxima subida na Cielo.
        // 1.10.5: manda o SERIAL do terminal (p.terminal) no /api/lio/pagar —
        // o servidor prende o caixa àquela maquininha (1 operador não recebe em
        // 2 maquininhas). O auto-abrir do caixa do operador é 100% servidor.
        // 1.10.6: SERVIDOR LOCAL × FUNNEL automático. O /api/config informa o IP
        // local da loja; o app aprende e, no arranque, prefere o LOCAL se ele
        // responder (rápido/offline), caindo pro Funnel (URL https configurada)
        // só quando está FORA. Uma config só, vai direto por dentro (Session.
        // resolverBase, checagem rápida em MainActivity).
        // 1.10.7: TROCA DE TURNO no aparelho — o 🧾 Dia mostra "SEU DIA" (só o
        // garçom logado, campo `meu` do resumo-dia) antes do total do aparelho,
        // e ganha o botão "🔒 Fechar meu caixa": fecha o caixa da MAQUININHA do
        // logado, só se BATER (servidor confere NSU a NSU; não bateu = fica
        // aberto com o motivo). Sai um, entra o outro, caixa novo nasce sozinho.
        // 1.10.8: valor digitado no Receber em CENTAVOS (550 = R$ 5,50), campo
        // se formata sozinho. O teclado da LIO não tem vírgula e "5.50" parseava
        // como 550 (ponto tratado como milhar) — cobrava a conta INTEIRA.
        // 1.10.9: comprovante IMPRESSO do fechamento de caixa na maquininha —
        // operador, período, por forma, TOTAL e o carimbo "BATEU (N NSUs)".
        // O servidor devolve o detalhamento no /api/lio/fechar-caixa.
        // 1.10.10: DESCONTO/ACRÉSCIMO do pedido obedecidos no Receber e no cupom
        // (conta com desconto era cobrada CHEIA). Manda x-concilia-app; o app
        // antigo sem o header recebe o desconto dobrado no `total` pelo servidor.
        // 1.10.12: camada `Pagamento` (telas não chamam o SDK direto). A 1.10.12
        // TROCAVA de módulo pela config da filial — ERRADO (a máquina define o
        // SDK; uma LIO numa loja marcada "Rede" pararia de cobrar). Nunca subiu.
        // 1.10.13: `Pagamento` = Cielo, sempre (este build roda na máquina da
        // Cielo). A versão Rede será OUTRO BUILD (flavor `rede`, SDK da Rede,
        // Rede Store) na máquina da Rede. Quem escolhe com quem a filial trabalha
        // é o Concilia (Configurações → Filiais) — orienta o sistema, não o app.
        versionCode = 37
        versionName = "1.10.13"
        buildConfigField("String", "API_BASE", "\"$apiBase\"")
        buildConfigField("String", "CIELO_CLIENT_ID", "\"$cieloClientId\"")
        buildConfigField("String", "CIELO_ACCESS_TOKEN", "\"$cieloAccessToken\"")
    }

    signingConfigs {
        if (keystoreOk) {
            create("release") {
                storeFile = File(keystorePath)
                storePassword = conf("KEYSTORE_PASSWORD")
                keyAlias = conf("KEY_ALIAS")
                keyPassword = conf("KEY_PASSWORD", conf("KEYSTORE_PASSWORD"))
            }
        }
    }

    buildTypes {
        release {
            // R8 LIGADO de propósito: remove classes de biblioteca não usadas —
            // inclusive androidx LinkifyCompat, que referencia WebView.findAddress
            // sem a gente usar. A Cielo reprova APK com WebView (PCI do DX8000);
            // com R8 o APK sai sem NENHUMA referência a android.webkit.
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreOk) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    // SDK Cielo LIO — pagamento NO terminal (pinpad/NFC). AAR vendorado em
    // lio-app/sdk/ (repo Maven local declarado no settings.gradle.kts).
    // Puxa transitivamente: kotlinx-coroutines, gson e cielo.smart:event-tracker.
    implementation("com.cielo.lio:order-manager:2.5.5")
    // Gera o QR (DANFE, passe) como Bitmap — impresso via printImage, porque o
    // printQrCode do SDK não imprime em campo. Java puro, zero WebView.
    implementation("com.google.zxing:core:3.5.3")
}
