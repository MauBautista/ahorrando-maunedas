package com.maubautista.maunedas.core.camera

/** What a read becomes before it is looked up: digits only, 6 to 14 of them, as `barcodes.code` (03 §8). */
object ScanCodes {
    private val SEPARATORS = Regex("[\\s-]")
    private val VALID = Regex("^[0-9]{6,14}$")

    /** Null for anything that is not a product code (a Code 128 with letters, a URL…). */
    fun normalize(raw: String): String? = raw.replace(SEPARATORS, "").takeIf { VALID.matches(it) }
}

/**
 * S-11: "Ignora el mismo código durante 2 s". The camera reads the same label many times per second; only the first
 * read of a code counts until [quietMs] pass without seeing it again... or another code is read.
 */
class ScanGate(
    private val quietMs: Long = 2_000,
) {
    private var lastCode: String? = null
    private var lastAt = Long.MIN_VALUE

    /** True when this read should be reported. */
    fun accept(
        code: String,
        now: Long,
    ): Boolean {
        val repeated = code == lastCode && now - lastAt < quietMs
        lastCode = code
        lastAt = now
        return !repeated
    }
}
