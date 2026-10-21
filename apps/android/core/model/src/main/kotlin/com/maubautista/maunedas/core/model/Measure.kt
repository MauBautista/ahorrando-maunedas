package com.maubautista.maunedas.core.model

/** How a variant is measured; its base unit is g, ml or pz (ARQUITECTURA §3.1). [wire] is the SQL/JSON value. */
enum class Measure(val wire: String) {
    MASS("mass"),
    VOLUME("volume"),
    COUNT("count"),
    ;

    companion object {
        fun fromWire(value: String): Measure =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("Medida desconocida: $value")
    }
}

/** Unit a product's price is shown in, with how many base units it holds. */
enum class DisplayUnit(val wire: String, val measure: Measure, val base: Int) {
    KG("kg", Measure.MASS, 1000),
    G100("100g", Measure.MASS, 100),
    L("L", Measure.VOLUME, 1000),
    ML100("100ml", Measure.VOLUME, 100),
    PZ("pz", Measure.COUNT, 1),
    ;

    companion object {
        fun fromWire(value: String): DisplayUnit =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("Unidad desconocida: $value")
    }
}
