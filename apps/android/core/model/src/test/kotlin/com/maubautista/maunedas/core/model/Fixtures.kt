package com.maubautista.maunedas.core.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Repository-level shared vectors copied by `copyFixtures` (CLAUDE.md rule 7). Never edited to pass a test. */
internal object Fixtures {
    fun load(name: String): JsonObject {
        val url = Fixtures::class.java.getResource("/fixtures/$name") ?: error("Falta fixtures/$name en los recursos de prueba")
        return Json.parseToJsonElement(url.readText()).jsonObject
    }

    fun names(): List<String> {
        val dir = Fixtures::class.java.getResource("/fixtures") ?: error("Faltan los fixtures en los recursos de prueba")
        return java.io.File(dir.toURI()).list()!!.filter { it.endsWith(".json") }.sorted()
    }
}

internal operator fun JsonObject.invoke(key: String): JsonElement = this[key] ?: error("Falta $key en $this")

internal fun JsonElement.array(): JsonArray = jsonArray

internal fun JsonElement.obj(): JsonObject = jsonObject

internal fun JsonElement.str(): String = jsonPrimitive.content

internal fun JsonElement.num(): Double = jsonPrimitive.content.toDouble()

internal fun JsonElement.isString(): Boolean = this is JsonPrimitive && isString

/** Runs every case and reports all the failures at once, each with its name. */
internal fun <T> checkAll(
    cases: List<T>,
    name: (T) -> String,
    check: (T) -> Unit,
) {
    val failures = cases.mapNotNull { case -> runCatching { check(case) }.exceptionOrNull()?.let { "${name(case)}: ${it.message}" } }
    if (failures.isNotEmpty()) throw AssertionError(failures.joinToString("\n"))
}
