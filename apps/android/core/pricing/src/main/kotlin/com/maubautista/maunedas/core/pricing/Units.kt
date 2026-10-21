package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure

/** Price per unit (normalizacion.json), same operations as `packages/shared/src/pricing/units.ts`. */
object Units {
    /** Cents per g / ml / pz, not rounded. Throws if the base content is not positive. */
    fun centsPerBase(
        paidCents: Double,
        quantity: Double,
        unitAmount: Double,
        packCount: Int,
    ): Double {
        val base = quantity * unitAmount * packCount
        require(base > 0) { "Contenido base inválido" }
        return paidCents / base
    }

    /** Cents per display unit, rounded half-up. Throws if the display unit does not apply to the measure. */
    fun displayCents(
        centsPerBase: Double,
        measure: Measure,
        unit: DisplayUnit,
    ): Long {
        require(unit.measure == measure) { "${unit.wire} no aplica a ${measure.wire}" }
        return roundHalfUp(centsPerBase * unit.base)
    }

    /** Display unit suggested for a measure (S-09): kg, L or pz. */
    fun defaultDisplayUnit(measure: Measure): DisplayUnit =
        when (measure) {
            Measure.MASS -> DisplayUnit.KG
            Measure.VOLUME -> DisplayUnit.L
            Measure.COUNT -> DisplayUnit.PZ
        }
}
