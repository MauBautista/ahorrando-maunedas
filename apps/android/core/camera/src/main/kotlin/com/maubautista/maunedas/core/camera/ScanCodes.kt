package com.maubautista.maunedas.core.camera

/** What a read becomes before it is looked up: digits only, 6 to 14 of them, as `barcodes.code` (03 §8). */
object ScanCodes {
    private val SEPARATORS = Regex("[\\s-]")
    private val VALID = Regex("^[0-9]{6,14}$")

    /** Null for anything that is not a product code (a Code 128 with letters, a URL…). */
    fun normalize(raw: String): String? = raw.replace(SEPARATORS, "").takeIf { VALID.matches(it) }
}

/**
 * Which reads of the camera count (S-11).
 * - **Confirmed:** a code counts once it was read [confirmations] times within [windowMs]. A blurry or dark frame can
 *   decode a wrong code that even passes the check digit, but only for one frame, while a real label is read again
 *   right away (T-122, seen on a Galaxy A53).
 * - **"Ignora el mismo código durante 2 s":** the code reported stays quiet while it is still read within [quietMs]
 *   of the last time; another code is reported as soon as it is confirmed.
 */
class ScanGate(
    private val quietMs: Long = 2_000,
    private val confirmations: Int = 2,
    private val windowMs: Long = 1_000,
) {
    private var lastCode: String? = null
    private var lastAt = Long.MIN_VALUE
    private val recent = ArrayDeque<Pair<String, Long>>()

    /** True when this read should be reported. */
    fun accept(
        code: String,
        now: Long,
    ): Boolean {
        if (code == lastCode && now - lastAt < quietMs) {
            lastAt = now
            return false
        }
        while (recent.isNotEmpty() && now - recent.first().second > windowMs) recent.removeFirst()
        recent.addLast(code to now)
        if (recent.count { it.first == code } < confirmations) return false
        recent.removeAll { it.first == code }
        lastCode = code
        lastAt = now
        return true
    }
}
