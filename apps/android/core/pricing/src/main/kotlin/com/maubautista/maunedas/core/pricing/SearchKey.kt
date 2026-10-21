package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.trimJs

private val NOT_ALNUM = Regex("[^a-z0-9]+")

/** Catalog search key (`products.search_key`): "Café Legal 1.5 kg" → "cafe legal 1 5 kg" (textos.json). */
object SearchKey {
    fun of(input: String): String = foldAccents(input).lowercase().replace(NOT_ALNUM, " ").trimJs()
}
