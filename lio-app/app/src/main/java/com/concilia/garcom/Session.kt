package com.concilia.garcom

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// Sessão do garçom (SharedPreferences): token x-garcom do vendas-local,
// servidor escolhido (Prainha Bar / Tabuará / URL custom) e dados exibidos.
// O token do vendas-local vale GARCOM_TOKEN_HORAS (16h default) — expirou,
// a API devolve sem_sessao e o app volta pro login.
object Session {
    private const val PREFS = "concilia_garcom"
    private const val K_TOKEN = "token"
    private const val K_LOGIN = "login"
    private const val K_NOME = "nome"
    private const val K_SERVIDOR = "servidor"   // o que o usuário configurou (ex.: URL do Funnel)
    private const val K_LAN = "lan"             // IP:porta local aprendido do /api/config
    private const val K_LAN_DE = "lan_de"       // servidor configurado que informou esse IP local
    private const val K_LOJA = "loja"
    private const val K_PODE_DESCONTO = "pode_desconto"
    private const val K_ENTREGAS = "entregas"       // Consumer: PedidosDelivery (4) ou admin

    // Servidor ATIVO (resolverBase): o LOCAL da loja se ele responder agora,
    // senão o configurado (Funnel). Resolvido no arranque, logo depois do login,
    // quando o Wi-Fi entra/sai e, de reserva, ao voltar pra tela se a última
    // checagem tem mais de 1 min. Fica em memória — some ao matar o app.
    @Volatile private var baseAtiva: String? = null
    @Volatile private var resolvidoEm = 0L
    @Volatile private var configEm = 0L   // última vez que o /api/config respondeu
    /** Por que a última resolução deu local ou túnel — aparece no toque no nome (mesas). */
    @Volatile var motivoRota: String = "ainda não checado"
        private set
    private val filaRota = Executors.newSingleThreadExecutor()
    private val rotaNaFila = AtomicBoolean(false)
    @Volatile private var vigiando = false

    // RESERVA pra quando a descoberta automática não achar nada (VPN, rede
    // errada) — o caminho normal é a varredura da sub-rede (Descoberta.kt),
    // que mostra o nome que o próprio servidor reporta.
    val SERVIDORES = listOf(
        Pair("Prainha Bar (10.0.0.252)", "http://10.0.0.252:8790"),
        Pair("Tabuará (192.168.10.60)", "http://192.168.10.60:8790"),
        Pair("Prainha Mar (192.168.4.100)", "http://192.168.4.100:8790"),
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(ctx: Context, token: String, login: String, nome: String?, podeDesconto: Boolean, entregas: Boolean = false) {
        prefs(ctx).edit()
            .putString(K_TOKEN, token)
            .putString(K_LOGIN, login)
            .putString(K_NOME, nome)
            .putBoolean(K_PODE_DESCONTO, podeDesconto)
            .putBoolean(K_ENTREGAS, entregas)
            .apply()
    }
    /** Pode sair pra entregar e receber na porta (tela Entregas). */
    fun entregas(ctx: Context): Boolean = prefs(ctx).getBoolean(K_ENTREGAS, false)

    fun saveServidor(ctx: Context, base: String, loja: String) {
        val b = base.trimEnd('/')
        val p = prefs(ctx)
        val e = p.edit().putString(K_SERVIDOR, b).putString(K_LOJA, loja)
        if (p.getString(K_SERVIDOR, null) != b) baseAtiva = null
        // Trocou de servidor: o IP local aprendido de OUTRO servidor não vale mais
        // (senão a maquininha na rede do Bar, logada na Mar, ia parar no Bar).
        if (p.getString(K_LAN_DE, null) != b) e.remove(K_LAN).remove(K_LAN_DE)
        e.apply()
    }

    /** Limites de numeração da loja (GET /api/config) — defaults do Prainha Bar.
     *  `de` = servidor configurado que respondeu (o IP local fica amarrado a ele). */
    fun saveConfig(ctx: Context, c: Api.ConfigLoja, de: String) {
        prefs(ctx).edit()
            .putInt("mesa_max", c.mesaMax)
            .putBoolean("comanda_ativa", c.comandaAtiva)
            .putInt("comanda_min", c.comandaMin)
            .putInt("comanda_max", c.comandaMax)
            .putInt("numero_max", c.numeroMax)
            .putString("taxa_servico", c.taxaServico.toString())
            .putString("adquirente", if (c.adquirente == "rede") "rede" else "cielo")
            .apply()
        saveLan(ctx, c.lan, de) // aprende o IP local da loja (pra preferir local dentro)
        configEm = SystemClock.elapsedRealtime()
    }

    /** Adquirente da maquininha desta filial (do /api/config): cielo | rede. */
    fun adquirente(ctx: Context): String = prefs(ctx).getString("adquirente", null) ?: "cielo"

    fun taxaServico(ctx: Context): Double =
        prefs(ctx).getString("taxa_servico", null)?.toDoubleOrNull() ?: 10.0

    fun mesaMax(ctx: Context): Int = prefs(ctx).getInt("mesa_max", 299)
    fun comandaAtiva(ctx: Context): Boolean = prefs(ctx).getBoolean("comanda_ativa", true)
    fun comandaMin(ctx: Context): Int = prefs(ctx).getInt("comanda_min", 300)
    fun numeroMax(ctx: Context): Int = prefs(ctx).getInt("numero_max", 400)
    fun ehComanda(ctx: Context, numero: Int): Boolean = comandaAtiva(ctx) && numero >= comandaMin(ctx)

    fun token(ctx: Context): String? = prefs(ctx).getString(K_TOKEN, null)
    fun login(ctx: Context): String? = prefs(ctx).getString(K_LOGIN, null)
    fun nome(ctx: Context): String? = prefs(ctx).getString(K_NOME, null)
    fun podeDesconto(ctx: Context): Boolean = prefs(ctx).getBoolean(K_PODE_DESCONTO, false)
    /** Servidor de todas as chamadas: o ATIVO resolvido no arranque (local se
     *  der, senão o configurado). Antes de resolver, cai no configurado — igual
     *  ao comportamento antigo. */
    fun servidor(ctx: Context): String {
        Api.usarContexto(ctx)
        baseAtiva?.let { return it }
        // Ainda não resolvido (ex.: Android recriou a tela depois de matar o app):
        // resolve em segundo plano e, enquanto isso, vai no configurado.
        if (isLoggedIn(ctx)) revalidar(ctx, forcar = true)
        return prefs(ctx).getString(K_SERVIDOR, null) ?: BuildConfig.API_BASE
    }

    /** Endereço pra link que vai pro celular do CLIENTE (passe da catraca): o
     *  túnel https se houver — o IP local só abre em quem está no Wi-Fi da loja. */
    fun servidorPublico(ctx: Context): String =
        servidorConfigurado(ctx).takeIf { it.startsWith("https://") } ?: servidor(ctx)

    /** Rótulo curto da rota em uso, pro cabeçalho das mesas. */
    fun rotaCurta(ctx: Context): String =
        if (servidor(ctx).startsWith("http://")) "⚡ rede local" else "☁️ internet"

    /** Servidor do último login que deu certo (null = nunca entrou neste aparelho).
     *  O login reabre com ELE escolhido — a descoberta e a lista da nuvem não passam por cima. */
    fun servidorSalvo(ctx: Context): String? = prefs(ctx).getString(K_SERVIDOR, null)?.takeIf { it.isNotBlank() }

    /** O que o usuário configurou (Funnel/custom), ignorando o ativo. */
    fun servidorConfigurado(ctx: Context): String = prefs(ctx).getString(K_SERVIDOR, null) ?: BuildConfig.API_BASE

    fun lan(ctx: Context): String? = prefs(ctx).getString(K_LAN, null)?.takeIf { it.isNotBlank() }
    /** Código da empresa digitado no login (ex.: 'prainha') — o app busca as
     *  filiais/túneis no Concilia com ele e deixa a lista pronta na próxima vez. */
    fun codigoEmpresa(ctx: Context): String? = prefs(ctx).getString("codigo_empresa", null)?.takeIf { it.isNotBlank() }
    fun saveCodigoEmpresa(ctx: Context, codigo: String?) {
        prefs(ctx).edit().putString("codigo_empresa", codigo?.trim()?.lowercase()).apply()
    }
    fun saveLan(ctx: Context, lan: String?, de: String) {
        if (lan.isNullOrBlank()) return // servidor antigo não manda lan: não apaga o que já sabíamos
        prefs(ctx).edit().putString(K_LAN, lan.trim()).putString(K_LAN_DE, de.trimEnd('/')).apply()
    }

    /** IP local aprendido DESTE servidor configurado. Sem K_LAN_DE = gravado por
     *  versão antiga (<1.10.25), que só guardava o da loja em uso: vale. */
    private fun lanDe(ctx: Context, configurado: String): String? {
        val de = prefs(ctx).getString(K_LAN_DE, null)
        return lan(ctx)?.takeIf { de == null || de == configurado.trimEnd('/') }
    }

    /** IP:porta local da loja em uso (null = ainda não sabe). */
    fun lanConhecida(ctx: Context): String? = lanDe(ctx, servidorConfigurado(ctx))

    /** Escolhe o servidor ATIVO: se souber o LOCAL da loja e ele responder AGORA,
     *  usa ele (rápido, http direto, funciona offline); senão o configurado
     *  (Funnel). CHAMAR EM THREAD DE TRABALHO (faz rede). Pior caso = configurado
     *  (nunca fica pior que antes). */
    fun resolverBase(ctx: Context): String {
        Api.usarContexto(ctx)
        vigiarRede(ctx)
        val configurado = servidorConfigurado(ctx)
        val lan = lanDe(ctx, configurado)
        val local = lan?.let { "http://$it" }
        val wifi = Descoberta.redeLocal(ctx) != null
        var escolhido = configurado
        val motivo: String
        if (!configurado.startsWith("https://")) {
            motivo = "servidor escolhido no login já é o local"
        } else if (!wifi) {
            // Sem Wi-Fi/cabo o IP da loja não existe — nem testa (poupa 1,5 s no 4G).
            motivo = "sem Wi-Fi — indo pela internet"
        } else if (local != null && Api.vivo(local)) {
            escolhido = local
            motivo = "servidor da loja respondeu no Wi-Fi"
        } else {
            // IP local desconhecido ou calado: pergunta ao próprio servidor (pelo
            // túnel) qual é o IP dele na loja — aprende IP novo sem relogar. Não
            // repergunta se acabou de perguntar (logo depois do login).
            val perguntouAgora = configEm != 0L && SystemClock.elapsedRealtime() - configEm < 60_000
            val novo = if (perguntouAgora) null else Api.config(configurado)
                ?.also { saveConfig(ctx, it, de = configurado) }?.lan
                ?.let { "http://$it" }?.takeIf { it != local }
            val testado = novo ?: local
            motivo = when {
                novo != null && Api.vivo(novo) -> { escolhido = novo; "servidor da loja respondeu no Wi-Fi (IP novo)" }
                testado != null -> "Wi-Fi ligado, mas ${testado.removePrefix("http://")} não respondeu — indo pela internet"
                else -> "IP local da loja desconhecido — indo pela internet"
            }
        }
        baseAtiva = escolhido
        resolvidoEm = SystemClock.elapsedRealtime()
        motivoRota = motivo
        return escolhido
    }

    /** Refaz a escolha local × túnel em segundo plano (nunca bloqueia). Sem
     *  `forcar`, só se a última checagem tem mais de 1 min. Pedidos seguidos
     *  viram uma checagem só; pedido durante uma checagem roda logo depois dela. */
    fun revalidar(ctx: Context, forcar: Boolean = false) {
        if (!forcar && baseAtiva != null && SystemClock.elapsedRealtime() - resolvidoEm < 60_000) return
        if (!rotaNaFila.compareAndSet(false, true)) return
        val app = ctx.applicationContext
        filaRota.execute {
            rotaNaFila.set(false)
            try { resolverBase(app) } catch (_: Exception) { }
        }
    }

    /** Segundos desde a última checagem da rota (-1 = nunca). */
    fun rotaChecadaHa(): Long =
        if (resolvidoEm == 0L) -1 else (SystemClock.elapsedRealtime() - resolvidoEm) / 1000

    /** Wi-Fi/cabo entrou ou saiu → refaz a escolha na hora (saiu pra entregar
     *  no 4G, voltou pra loja). Sem exigir internet no Wi-Fi: o da loja pode ser
     *  hotspot sem autorizar e mesmo assim o servidor local responde por ele.
     *  Registrado 1x por processo. */
    private fun vigiarRede(ctx: Context) {
        synchronized(this) { if (vigiando) return; vigiando = true }
        try {
            val app = ctx.applicationContext
            val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val req = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            cm.registerNetworkCallback(req, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { revalidar(app, forcar = true) }
                override fun onLost(network: Network) { revalidar(app, forcar = true) }
            })
        } catch (_: Exception) { vigiando = false }
    }
    fun loja(ctx: Context): String = prefs(ctx).getString(K_LOJA, null) ?: SERVIDORES.first().first
    fun isLoggedIn(ctx: Context): Boolean = !token(ctx).isNullOrBlank()

    /** Sai mas preserva servidor/loja escolhidos (conveniência do próximo login). */
    fun clear(ctx: Context) {
        prefs(ctx).edit()
            .remove(K_TOKEN).remove(K_LOGIN).remove(K_NOME).remove(K_PODE_DESCONTO).remove(K_ENTREGAS)
            .apply()
        baseAtiva = null // o próximo login pode ser em outra loja
    }
}
