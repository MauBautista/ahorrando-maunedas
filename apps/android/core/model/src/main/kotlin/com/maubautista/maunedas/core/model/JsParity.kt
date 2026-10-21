package com.maubautista.maunedas.core.model

/**
 * Helpers that make Kotlin text handling behave like the TypeScript rules it mirrors (CLAUDE.md rule 7):
 * the same characters count as white space in both.
 */

/** JavaScript's `\s` as a Java regex character class (white space and line terminators of ECMAScript). */
const val JS_SPACE = "[\\t\\n\\x0B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"

/** `String.prototype.trim` of JavaScript. */
fun String.trimJs(): String = trim { it.isJsWhitespace() }

fun Char.isJsWhitespace(): Boolean =
    this == '\t' || this == '\n' || this == '\u000B' || this == '\u000C' || this == '\r' || this == '\uFEFF' ||
        this == '\u2028' || this == '\u2029' || Character.getType(this) == Character.SPACE_SEPARATOR.toInt()
