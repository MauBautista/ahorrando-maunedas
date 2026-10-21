package com.maubautista.maunedas.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class UuidsFixturesTest {
    private val fixture = Fixtures.load("ids.json")

    @Test
    fun namespacesAreTheFixedOnes() {
        val ns = fixture("namespaces").obj()
        assertEquals(ns("NS_PRODUCT_TAGS").str(), Uuids.NS_PRODUCT_TAGS.toString())
        assertEquals(ns("NS_RECEIPT_ALIASES").str(), Uuids.NS_RECEIPT_ALIASES.toString())
    }

    @Test
    fun uuidv5() =
        checkAll(fixture("uuidv5").array().map { it.obj() }, { it("nombre").str() }) {
            assertEquals(it("esperado").str(), Uuids.v5(it("entrada").str(), UUID.fromString(it("namespace").str())))
        }

    @Test
    fun productTagId() =
        checkAll(fixture("product_tag_id").array().map { it.obj() }, { it("nombre").str() }) {
            assertEquals(it("esperado").str(), Uuids.productTagId(it("product_id").str(), it("tag_id").str()))
        }

    @Test
    fun receiptAliasId() =
        checkAll(fixture("receipt_alias_id").array().map { it.obj() }, { it("nombre").str() }) {
            assertEquals(it("esperado").str(), Uuids.receiptAliasId(it("store_id").str(), it("raw_text_norm").str()))
        }

    @Test
    fun v7CarriesTheTimeVersionAndVariant() {
        val ms = 1_792_389_600_000L
        val id = Uuids.v7(ms)
        val uuid = UUID.fromString(id)
        assertEquals(7, uuid.version())
        assertEquals(2, uuid.variant())
        assertEquals(ms, uuid.mostSignificantBits ushr 16)
        assertEquals(id, id.lowercase())
        assertNotEquals(id, Uuids.v7(ms))
        assertTrue("ordered by time", Uuids.v7(ms) < Uuids.v7(ms + 1))
    }
}
