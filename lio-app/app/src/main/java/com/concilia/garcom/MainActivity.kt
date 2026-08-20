package com.concilia.garcom

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

// Entrada do app: decide pra onde ir conforme a sessão.
//   logado -> MesasActivity (grade de mesas/comandas)
//   sem sessão (ou token de 16h vencido — a API derruba depois) -> LoginActivity
// Sem UI própria — apenas roteia e encerra.
//
// Antes de abrir as mesas (logado), ESCOLHE o servidor ativo: o LOCAL da loja
// se ele responder agora (rápido, http direto, offline), senão o configurado
// (URL do Funnel). Assim dentro da loja o app vai DIRETO no servidor local e
// só usa a internet quando está fora — uma config só, sem trocar nada.
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Session.isLoggedIn(this)) { irPara(LoginActivity::class.java); return }
        Thread {
            try { Session.resolverBase(this) } catch (_: Exception) {}
            runOnUiThread { if (!isFinishing) irPara(MesasActivity::class.java) }
        }.start()
    }
    private fun irPara(c: Class<*>) { startActivity(Intent(this, c)); finish() }
}
