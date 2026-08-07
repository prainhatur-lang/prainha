package com.concilia.garcom

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// Descoberta automática do vendas-local: varre a(s) sub-rede(s) IPv4 em que o
// aparelho está (porta 8790) e confirma com GET /api/versao — rota que existe
// em QUALQUER versão do servidor da loja. O nome exibido vem do próprio
// servidor (GET /api/config; servidor antigo sem a rota vira "IP:porta").
// Assim loja nova / IP trocado aparece sozinho, sem lista fixa no app.
object Descoberta {
    const val PORTA = 8790

    data class Servidor(val base: String, val nome: String)

    /** Prefixos /24 das redes locais do aparelho (ex.: "192.168.10"). */
    fun prefixosLocais(): List<String> {
        val out = mutableListOf<String>()
        try {
            val ifs = NetworkInterface.getNetworkInterfaces() ?: return out
            for (ni in ifs) {
                if (!ni.isUp || ni.isLoopback) continue
                for (addr in ni.interfaceAddresses) {
                    val ip = addr.address.hostAddress ?: continue
                    if (!ip.contains('.') || ip.startsWith("127.")) continue
                    if (!ipPrivado(ip)) continue
                    out.add(ip.substringBeforeLast('.'))
                }
            }
        } catch (_: Exception) { }
        return out.distinct()
    }

    /** RFC1918 — a trava de segurança do cleartext: http:// SÓ pra rede local. */
    fun ipPrivado(host: String): Boolean {
        val p = host.split('.')
        if (p.size != 4) return false
        val a = p[0].toIntOrNull() ?: return false
        val b = p[1].toIntOrNull() ?: return false
        return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
    }

    /** Há um vendas-local em `base`? Devolve o nome real da loja (ou o host). */
    fun sonda(base: String): Servidor? {
        val v = httpGet("$base/api/versao", 1500) ?: return null
        if (!v.has("versao")) return null
        val cfg = httpGet("$base/api/config", 1500)
        val nome = cfg?.optString("loja")?.takeIf { it.isNotBlank() && cfg.optBoolean("ok") }
            ?: nomePelaPagina(base)
            ?: base.removePrefix("http://").removePrefix("https://")
        return Servidor(base, nome)
    }

    /** Servidor antigo (sem /api/config): o nome sai do <title> da página
     *  /venda — "Prainha Bar — Venda" vira "Prainha Bar". */
    private fun nomePelaPagina(base: String): String? = try {
        val c = URL("$base/venda").openConnection() as HttpURLConnection
        c.connectTimeout = 1500
        c.readTimeout = 1500
        val inicio = ByteArray(4096)
        val lidos = c.inputStream.use { it.read(inicio) }
        c.disconnect()
        if (lidos <= 0) null else {
            val html = String(inicio, 0, lidos, Charsets.UTF_8)
            Regex("<title>([^<]+)</title>").find(html)?.groupValues?.get(1)
                ?.replace(Regex("\\s*[—–-]\\s*(Venda|KDS)\\s*$"), "")
                ?.trim()?.takeIf { it.isNotBlank() }
        }
    } catch (_: Exception) { null }

    /**
     * Varre as sub-redes locais + os `extras` (IPs conhecidos/salvos). Chama
     * onAchado (em thread de trabalho) pra cada servidor confirmado e onFim ao
     * terminar — ~3-8s no pior caso. Sem rede local: só os extras são testados.
     */
    fun procurar(extras: List<String>, onAchado: (Servidor) -> Unit, onFim: () -> Unit) {
        Thread {
            val candidatos = LinkedHashSet<String>()
            extras.filter { ipPrivado(it) }.forEach { candidatos.add(it) }
            prefixosLocais().forEach { pfx -> (1..254).forEach { candidatos.add("$pfx.$it") } }
            val pool = Executors.newFixedThreadPool(48)
            val achados = java.util.Collections.synchronizedSet(mutableSetOf<String>())
            candidatos.forEach { host ->
                pool.execute {
                    if (!portaAberta(host, PORTA, 400)) return@execute
                    val s = sonda("http://$host:$PORTA") ?: return@execute
                    if (achados.add(s.base)) onAchado(s)
                }
            }
            pool.shutdown()
            try { pool.awaitTermination(10, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
            onFim()
        }.start()
    }

    private fun portaAberta(host: String, porta: Int, timeoutMs: Int): Boolean =
        try { Socket().use { it.connect(InetSocketAddress(host, porta), timeoutMs); true } }
        catch (_: Exception) { false }

    private fun httpGet(url: String, timeout: Int): JSONObject? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = timeout
        c.readTimeout = timeout
        val txt = c.inputStream.bufferedReader().use { it.readText() }
        c.disconnect()
        JSONObject(txt)
    } catch (_: Exception) { null }
}
