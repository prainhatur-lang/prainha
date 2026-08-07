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
        versionCode = 10
        versionName = "1.6.0"
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
}
