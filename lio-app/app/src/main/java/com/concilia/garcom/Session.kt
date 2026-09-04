package com.concilia.garcom

import android.content.Context

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
    private const val K_LOJA = "loja"
    private const val K_PODE_DESCONTO = "pode_desconto"

    // Servidor ATIVO desta execução (resolvido 1x no arranque por resolverBase):
    // o LOCAL da loja se ele responder agora, senão o configurado (Funnel). Fica
    // em memória — some ao matar o app, é recalculado no próximo arranque.
    @Volatile private var baseAtiva: String? = null

    // RESERVA pra quando a descoberta automática não achar nada (VPN, rede
    // errada) — o caminho normal é a varredura da sub-rede (Descoberta.kt),
    // que mostra o nome que o próprio servidor reporta.
    val SERVIDORES = listOf(
        Pair("Prainha Bar (10.0.0.252)", "http://10.0.0.252:8790"),
        Pair("Tabuará (192.168.10.60)", "http://192.168.10.60:8790"),
    )

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(ctx: Context, token: String, login: String, nome: String?, podeDesconto: Boolean) {
        prefs(ctx).edit()
            .putString(K_TOKEN, token)
            .putString(K_LOGIN, login)
            .putString(K_NOME, nome)
            .putBoolean(K_PODE_DESCONTO, podeDesconto)
            .apply()
    }

    fun saveServidor(ctx: Context, base: String, loja: String) {
        prefs(ctx).edit().putString(K_SERVIDOR, base.trimEnd('/')).putString(K_LOJA, loja).apply()
    }

    /** Limites de numeração da loja (GET /api/config) — defaults do Prainha Bar. */
    fun saveConfig(ctx: Context, c: Api.ConfigLoja) {
        prefs(ctx).edit()
            .putInt("mesa_max", c.mesaMax)
            .putBoolean("comanda_ativa", c.comandaAtiva)
            .putInt("comanda_min", c.comandaMin)
            .putInt("comanda_max", c.comandaMax)
            .putInt("numero_max", c.numeroMax)
            .putString("taxa_servico", c.taxaServico.toString())
            .putString("adquirente", if (c.adquirente == "rede") "rede" else "cielo")
            .apply()
        saveLan(ctx, c.lan) // aprende o IP local da loja (pra preferir local dentro)
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
    fun servidor(ctx: Context): String =
        baseAtiva ?: prefs(ctx).getString(K_SERVIDOR, null) ?: BuildConfig.API_BASE

    /** O que o usuário configurou (Funnel/custom), ignorando o ativo. */
    fun servidorConfigurado(ctx: Context): String = prefs(ctx).getString(K_SERVIDOR, null) ?: BuildConfig.API_BASE

    fun lan(ctx: Context): String? = prefs(ctx).getString(K_LAN, null)?.takeIf { it.isNotBlank() }
    /** Código da empresa digitado no login (ex.: 'prainha') — o app busca as
     *  filiais/túneis no Concilia com ele e deixa a lista pronta na próxima vez. */
    fun codigoEmpresa(ctx: Context): String? = prefs(ctx).getString("codigo_empresa", null)?.takeIf { it.isNotBlank() }
    fun saveCodigoEmpresa(ctx: Context, codigo: String?) {
        prefs(ctx).edit().putString("codigo_empresa", codigo?.trim()?.lowercase()).apply()
    }
    fun saveLan(ctx: Context, lan: String?) {
        if (lan.isNullOrBlank()) return // servidor antigo não manda lan: não apaga o que já sabíamos
        prefs(ctx).edit().putString(K_LAN, lan.trim()).apply()
    }

    /** Escolhe o servidor ATIVO: se souber o LOCAL da loja e ele responder AGORA,
     *  usa ele (rápido, http direto, funciona offline); senão o configurado
     *  (Funnel). CHAMAR EM THREAD DE TRABALHO (faz rede). Pior caso = configurado
     *  (nunca fica pior que antes). */
    fun resolverBase(ctx: Context): String {
        val configurado = servidorConfigurado(ctx)
        val lan = lan(ctx)
        if (!lan.isNullOrBlank()) {
            val local = "http://$lan"
            if (local == configurado) { baseAtiva = configurado; return configurado }
            if (Api.vivo(local)) { baseAtiva = local; return local }
        }
        baseAtiva = configurado
        return configurado
    }
    fun loja(ctx: Context): String = prefs(ctx).getString(K_LOJA, null) ?: SERVIDORES.first().first
    fun isLoggedIn(ctx: Context): Boolean = !token(ctx).isNullOrBlank()

    /** Sai mas preserva servidor/loja escolhidos (conveniência do próximo login). */
    fun clear(ctx: Context) {
        prefs(ctx).edit()
            .remove(K_TOKEN).remove(K_LOGIN).remove(K_NOME).remove(K_PODE_DESCONTO)
            .apply()
    }
}
