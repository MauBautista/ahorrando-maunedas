package com.maubautista.maunedas.core.model

import java.text.Normalizer

/** Same rules as `packages/shared/src/auth/username.ts` (SDD 02 §3); vectors in fixtures/usuarios.json. */
object Usernames {
    const val SYNTHETIC_EMAIL_DOMAIN_DEFAULT = "maunedas.local"

    /** 3 to 32 characters. */
    val USERNAME_RE = Regex("^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$")

    fun normalize(input: String): String = Normalizer.normalize(input, Normalizer.Form.NFKC).trimJs().lowercase()

    fun isValid(username: String): Boolean = USERNAME_RE.matches(username)

    /** `usuario@dominio` used as the Firebase e-mail; throws when the username is not valid. */
    fun syntheticEmail(
        username: String,
        domain: String = SYNTHETIC_EMAIL_DOMAIN_DEFAULT,
    ): String {
        val u = normalize(username)
        require(isValid(u)) { "USERNAME_INVALID" }
        return "$u@$domain"
    }
}
