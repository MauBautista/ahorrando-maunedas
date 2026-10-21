package com.maubautista.maunedas.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class UsernamesFixturesTest {
    private val fixture = Fixtures.load("usuarios.json")

    @Test
    fun syntheticEmail() {
        val domain = fixture("dominio").str()
        checkAll(fixture("casos").array().map { it.obj() }, { "\"${it("entrada").str()}\"" }) {
            val input = it("entrada").str()
            val expected = it("esperado").str()
            if (expected == "error") {
                assertThrows(IllegalArgumentException::class.java) { Usernames.syntheticEmail(input, domain) }
            } else {
                assertEquals(expected, Usernames.syntheticEmail(input, domain))
            }
        }
    }

    @Test
    fun normalizesWithNfkcLikeTypeScript() {
        // Full-width letters (a phone keyboard in full-width mode) are the same username (02 §3).
        assertEquals("mau@maunedas.local", Usernames.syntheticEmail("\uFF2D\uFF41\uFF55"))
    }

    @Test
    fun jsTrimKeepsCharactersJavaScriptDoesNotTrim() {
        // U+001F is white space for Java's trim(), not for JavaScript's.
        assertEquals("\u001Fmau", "  \u001Fmau ".trimJs())
    }
}
