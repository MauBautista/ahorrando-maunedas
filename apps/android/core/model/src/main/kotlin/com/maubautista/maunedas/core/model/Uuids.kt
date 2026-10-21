package com.maubautista.maunedas.core.model

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID

/** Ids of SDD 04 §2.1, same as `packages/shared/src/util/uuid.ts`; vectors in fixtures/ids.json. */
object Uuids {
    // Fixed forever: changing them would change every deterministic id.
    val NS_PRODUCT_TAGS: UUID = UUID.fromString("2bbba539-5872-4d57-8ff4-222c52764194")
    val NS_RECEIPT_ALIASES: UUID = UUID.fromString("1258c7ae-83bc-44c3-be9d-5e4ce482dbb8")

    private val random = SecureRandom()
    private const val HEX = "0123456789abcdef"

    /** Client-generated, time-ordered id (RFC 9562 v7): 48-bit Unix ms, version, 74 random bits. */
    fun v7(nowMs: Long = System.currentTimeMillis()): String {
        require(nowMs in 0..0xFFFF_FFFF_FFFFL) { "Marca de tiempo fuera de rango" }
        val bytes = ByteArray(16).also(random::nextBytes)
        for (i in 0 until 6) bytes[i] = (nowMs ushr (40 - 8 * i)).toByte()
        bytes[6] = ((bytes[6].toInt() and 0x0F) or 0x70).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3F) or 0x80).toByte()
        return format(bytes)
    }

    /** Name-based id (RFC 9562 v5, SHA-1); the name is encoded as UTF-8. */
    fun v5(
        name: String,
        namespace: UUID,
    ): String {
        val ns = ByteBuffer.allocate(16).putLong(namespace.mostSignificantBits).putLong(namespace.leastSignificantBits)
        val sha1 = MessageDigest.getInstance("SHA-1")
        sha1.update(ns.array())
        sha1.update(name.toByteArray(Charsets.UTF_8))
        val bytes = sha1.digest().copyOf(16)
        bytes[6] = ((bytes[6].toInt() and 0x0F) or 0x50).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3F) or 0x80).toByte()
        return format(bytes)
    }

    fun productTagId(
        productId: String,
        tagId: String,
    ): String = v5("$productId:$tagId", NS_PRODUCT_TAGS)

    fun receiptAliasId(
        storeId: String,
        rawTextNorm: String,
    ): String = v5("$storeId:$rawTextNorm", NS_RECEIPT_ALIASES)

    private fun format(bytes: ByteArray): String {
        val hex = bytes.joinToString("") { HEX[(it.toInt() ushr 4) and 0xF].toString() + HEX[it.toInt() and 0xF] }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }
}
