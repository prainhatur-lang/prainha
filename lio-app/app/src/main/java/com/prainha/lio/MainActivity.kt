package com.prainha.lio

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

// Entrada do app: decide pra onde ir conforme a sessão.
//   logado -> MesasActivity (grade de mesas/comandas)
//   sem sessão (ou token de 16h vencido — a API derruba depois) -> LoginActivity
// Sem UI própria — apenas roteia e encerra.
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val next = if (Session.isLoggedIn(this)) MesasActivity::class.java else LoginActivity::class.java
        startActivity(Intent(this, next))
        finish()
    }
}
