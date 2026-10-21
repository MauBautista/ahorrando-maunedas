package com.maubautista.maunedas.core.model

/** Wall clock in epoch ms UTC (CLAUDE.md rule 2); tests pass a fixed one. */
fun interface Clock {
    fun nowMillis(): Long

    companion object {
        val SYSTEM = Clock { System.currentTimeMillis() }
    }
}

/** Id of the signed-in user (`users.id`), or null without a session. `core:auth` backs it (T-110). */
fun interface CurrentUser {
    fun id(): String?
}
