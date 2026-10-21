package com.maubautista.maunedas.core.pricing

import java.text.Normalizer

private val MARKS = Regex("\\p{M}+")

/** Removes diacritics: NFKD decomposition without combining marks ("Ñoquis" → "Noquis"). */
fun foldAccents(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFKD).replace(MARKS, "")
