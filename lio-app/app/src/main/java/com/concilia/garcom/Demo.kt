package com.concilia.garcom

/**
 * Servidor de demonstração (/api/config demo=true): tudo o que a maquininha
 * imprime — conta, conferência, recibo, ticket, fechamento — sai com
 * DEMONSTRAÇÃO bem grande em cima e embaixo, e uma faixa no meio a cada
 * poucos blocos (cortar o topo e o pé não tira a marca). É pra ninguém usar
 * a demo de má-fé, como se fosse conta de restaurante de verdade.
 * Fora da demo nada passa por aqui: as lojas imprimem igual.
 */
object Demo {
    // Papel de 58 mm: tamanho 20 ≈ 32 colunas, 26 ≈ 24. No 44 cabem ~14,
    // e "DEMONSTRAÇÃO" tem 12 — o maior que sai numa linha só.
    private const val GRANDE = 44
    private const val A_CADA = 4          // faixa do meio a cada N blocos do documento
    private const val AVANCO_MIN = 4      // linhas em branco no fim, pra rasgar
    private val FAIXA = "=".repeat(32)    // no tamanho 20 = largura do papel

    private fun carimbo() = listOf(
        Bloco(FAIXA, negrito = true, tamanho = 20),
        Bloco("DEMONSTRAÇÃO", negrito = true, tamanho = GRANDE),
        Bloco("SEM VALOR · SÓ PARA TESTE", negrito = true, tamanho = 22),
        Bloco(FAIXA, negrito = true, tamanho = 20),
    )

    private fun faixaMeio() = Bloco("*** DEMONSTRAÇÃO ***", negrito = true, tamanho = 26)

    fun marcar(blocos: List<Bloco>): List<Bloco> {
        if (blocos.isEmpty()) return blocos
        // O avanço de papel do fim (o "\n\n\n…" do último bloco) fica DEPOIS
        // do carimbo de baixo — senão o carimbo sai no pedaço que se rasga.
        val corpo = blocos.toMutableList()
        var avanco = AVANCO_MIN
        val ult = corpo.last()
        if (ult.qr == null) {
            val semAvanco = ult.texto.trimEnd('\n')
            avanco = maxOf(AVANCO_MIN, ult.texto.length - semAvanco.length)
            if (semAvanco.isBlank()) corpo.removeAt(corpo.size - 1)
            else corpo[corpo.size - 1] = ult.copy(texto = semAvanco)
        }
        val out = mutableListOf<Bloco>()
        out += carimbo()
        corpo.forEachIndexed { i, b ->
            if (i > 0 && i % A_CADA == 0) out += faixaMeio()
            out += b
        }
        // Carimbo de baixo com o avanço colado na última faixa, como o
        // "Emitido …\n\n\n" do cupom (bloco só de quebras pode não sair).
        val pe = carimbo().toMutableList()
        pe[pe.size - 1] = pe.last().copy(texto = pe.last().texto + "\n".repeat(avanco))
        out += pe
        return out
    }
}
