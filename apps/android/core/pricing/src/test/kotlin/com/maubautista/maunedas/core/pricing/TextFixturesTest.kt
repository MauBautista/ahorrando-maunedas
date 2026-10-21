package com.maubautista.maunedas.core.pricing

import org.junit.Assert.assertEquals
import org.junit.Test

class TextFixturesTest {
    private val fixture = Fixtures.load("textos.json")

    @Test
    fun searchKey() =
        checkAll(fixture("search_key").array().map { it.obj() }, { "\"${it("entrada").str()}\"" }) {
            assertEquals(it("esperado").str(), SearchKey.of(it("entrada").str()))
        }

    @Test
    fun rawTextNorm() =
        checkAll(fixture("raw_text_norm").array().map { it.obj() }, { "\"${it("entrada").str()}\"" }) {
            assertEquals(it("esperado").str(), ReceiptText.normalize(it("entrada").str()))
        }
}
