package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.Measure

/** Units of the content assistant (S-10): what is typed and how many base units (g, ml, pz) one holds. */
enum class ContentUnit(
    val label: String,
    val measure: Measure,
    val factor: Int,
    /** Pieces are counted, never split. */
    val integer: Boolean,
) {
    G("g", Measure.MASS, 1, false),
    KG("kg", Measure.MASS, 1000, false),
    ML("ml", Measure.VOLUME, 1, false),
    L("L", Measure.VOLUME, 1000, false),
    PZ("pz", Measure.COUNT, 1, true),
    ;

    companion object {
        fun of(measure: Measure): List<ContentUnit> = entries.filter { it.measure == measure }
    }
}

/** `[pack_count] × [cantidad] [unidad]` ↔ `unit_amount` in base units (RF-CAT-02, S-10). */
object Content {
    /** Base units of [amount] [unit], to three decimals so 1.1 kg is 1100 g and not 1100.0000000000002. */
    fun toBase(
        amount: Double,
        unit: ContentUnit,
    ): Double = roundHalfUp(amount * unit.factor * 1000) / 1000.0

    /** How the assistant shows a saved amount: kg or L from 1000 up, as [QuantityParser.suggestVariantLabel] does. */
    fun forEditing(
        measure: Measure,
        unitAmount: Double,
    ): Pair<ContentUnit, Double> =
        when (measure) {
            Measure.MASS -> if (unitAmount >= 1000) ContentUnit.KG to unitAmount / 1000 else ContentUnit.G to unitAmount
            Measure.VOLUME -> if (unitAmount >= 1000) ContentUnit.L to unitAmount / 1000 else ContentUnit.ML to unitAmount
            Measure.COUNT -> ContentUnit.PZ to unitAmount
        }

    /** "A granel" sells by the kilo: 1000 g in a pack of one (the rule of `VariantRowSchema`). */
    const val BULK_GRAMS = 1000.0

    /** Label of a variant sold by weight (glossary). */
    const val BULK_LABEL = "A granel (kg)"
}
