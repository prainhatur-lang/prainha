package com.concilia.garcom

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
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

    /** Hosts IPv4 das redes locais do aparelho, pela MÁSCARA REAL da interface
     *  (a Prainha Mar é /22: 192.168.4.0–7.255 — varrer só o /24 do aparelho não
     *  achava o servidor .4.100 quando a máquina pegava IP em .5/.6/.7). Rede
     *  maior que /22 é cortada no /22 em volta do aparelho (1022 hosts). Ordem:
     *  o /24 do próprio aparelho primeiro, depois o resto. */
    fun hostsLocais(): List<String> {
        val perto = LinkedHashSet<String>()
        val resto = LinkedHashSet<String>()
        try {
            val ifs = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
            for (ni in ifs) {
                if (!ni.isUp || ni.isLoopback) continue
                for (addr in ni.interfaceAddresses) {
                    val a = addr.address as? Inet4Address ?: continue
                    val ip = a.hostAddress ?: continue
                    if (!ipPrivado(ip)) continue
                    val b = a.address
                    val meu = ((b[0].toLong() and 0xff) shl 24) or ((b[1].toLong() and 0xff) shl 16) or
                        ((b[2].toLong() and 0xff) shl 8) or (b[3].toLong() and 0xff)
                    val pl = addr.networkPrefixLength.toInt().let { if (it in 22..30) it else if (it < 22) 22 else 24 }
                    val mask = (0xffffffffL shl (32 - pl)) and 0xffffffffL
                    val rede = meu and mask
                    val bcast = rede or (mask.inv() and 0xffffffffL)
                    val meu24 = meu and 0xffffff00L
                    for (h in (rede + 1) until bcast) {
                        if (h == meu) continue
                        val s = "${(h shr 24) and 0xff}.${(h shr 16) and 0xff}.${(h shr 8) and 0xff}.${h and 0xff}"
                        if ((h and 0xffffff00L) == meu24) perto.add(s) else resto.add(s)
                    }
                }
            }
        } catch (_: Exception) { }
        return (perto + resto).toList()
    }

    /** Rede Wi-Fi/cabo do aparelho. Wi-Fi SEM internet (hotspot antes de
     *  autorizar, rede só da loja) faz o Android mandar o tráfego pelo chip —
     *  e a varredura saía pelo 4G, onde 192.168.x não existe. Amarrando as
     *  conexões na rede local isso não acontece. */
    @Suppress("DEPRECATION")
    fun redeLocal(ctx: Context): Network? = try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.allNetworks.firstOrNull { n ->
            val c = cm.getNetworkCapabilities(n)
            c != null && (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        }
    } catch (_: Exception) { null }

    /** RFC1918 — a trava de segurança do cleartext: http:// SÓ pra rede local. */
    fun ipPrivado(host: String): Boolean {
        val p = host.split('.')
        if (p.size != 4) return false
        val a = p[0].toIntOrNull() ?: return false
        val b = p[1].toIntOrNull() ?: return false
        return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
    }

    /** Há um vendas-local em `base`? Devolve o nome real da loja (ou o host). */
    fun sonda(base: String, rede: Network? = null): Servidor? {
        val v = httpGet("$base/api/versao", 2000, rede) ?: return null
        if (!v.has("versao")) return null
        val cfg = httpGet("$base/api/config", 2000, rede)
        val nome = cfg?.optString("loja")?.takeIf { it.isNotBlank() && cfg.optBoolean("ok") }
            ?: nomePelaPagina(base, rede)
            ?: base.removePrefix("http://").removePrefix("https://")
        return Servidor(base, nome)
    }

    /** Servidor antigo (sem /api/config): o nome sai do <title> da página
     *  /venda — "Prainha Bar — Venda" vira "Prainha Bar". */
    private fun nomePelaPagina(base: String, rede: Network?): String? = try {
        val c = abrir("$base/venda", rede)
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
     * Varre as redes locais + os `extras` (IPs conhecidos/salvos, testados
     * primeiro). Chama onAchado (em thread de trabalho) pra cada servidor
     * confirmado e onFim ao terminar — até ~15s num /22. Sem rede local: só os
     * extras são testados.
     */
    fun procurar(ctx: Context, extras: List<String>, onAchado: (Servidor) -> Unit, onFim: () -> Unit) {
        Thread {
            val rede = redeLocal(ctx)
            val candidatos = LinkedHashSet<String>()
            extras.filter { ipPrivado(it) }.forEach { candidatos.add(it) }
            candidatos.addAll(hostsLocais())
            val pool = Executors.newFixedThreadPool(96)
            val achados = java.util.Collections.synchronizedSet(mutableSetOf<String>())
            candidatos.forEach { host ->
                pool.execute {
                    if (!portaAberta(host, PORTA, 500, rede)) return@execute
                    val s = sonda("http://$host:$PORTA", rede) ?: return@execute
                    if (achados.add(s.base)) onAchado(s)
                }
            }
            pool.shutdown()
            try { pool.awaitTermination(25, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
            onFim()
        }.start()
    }

    private fun portaAberta(host: String, porta: Int, timeoutMs: Int, rede: Network?): Boolean =
        try {
            val sock = rede?.socketFactory?.createSocket() ?: Socket()
            sock.use { it.connect(InetSocketAddress(host, porta), timeoutMs); true }
        } catch (_: Exception) { false }

    private fun abrir(url: String, rede: Network?): HttpURLConnection {
        val u = URL(url)
        val c = (rede?.openConnection(u) ?: u.openConnection()) as HttpURLConnection
        c.connectTimeout = 2000
        c.readTimeout = 2000
        return c
    }

    private fun httpGet(url: String, timeout: Int, rede: Network? = null): JSONObject? = try {
        val c = abrir(url, rede)
        c.connectTimeout = timeout
        c.readTimeout = timeout
        val txt = c.inputStream.bufferedReader().use { it.readText() }
        c.disconnect()
        JSONObject(txt)
    } catch (_: Exception) { null }
}
