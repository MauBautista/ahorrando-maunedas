package com.maubautista.maunedas

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Library resources are merged into the app: two modules with the same string name end up as one, and one of the
 * screens shows the other's text (it happened with "Eliminar" and "Eliminar compra").
 */
class StringNamesTest {
    @Test
    fun noStringNameIsInTwoModules() {
        val root = File("..").canonicalFile
        val files = root.walkTopDown().filter { it.path.endsWith("src/main/res/values/strings.xml") && "/build/" !in it.path }.toList()
        val owners = mutableMapOf<String, MutableList<String>>()
        for (file in files) {
            val module = file.relativeTo(root).path.substringBefore("/src/")
            Regex("""<(?:string|plurals) name="([^"]+)"""").findAll(file.readText()).forEach { owners.getOrPut(it.groupValues[1]) { mutableListOf() } += module }
        }
        assertEquals("se leyeron los módulos", true, files.size >= 10)
        assertEquals(emptyMap<String, List<String>>(), owners.filterValues { it.size > 1 })
    }
}
