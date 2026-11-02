package com.maubautista.maunedas.feature.tracking

import androidx.annotation.StringRes
import com.maubautista.maunedas.core.data.AlertScope
import com.maubautista.maunedas.core.data.AlertType
import com.maubautista.maunedas.core.data.VariantOption
import com.maubautista.maunedas.core.model.Quantities

/** S-22's form: what the screen edits before it becomes a rule (the web's `RuleDialog`, T-223). */
data class RuleFormState(
    val id: String? = null,
    val variant: VariantOption? = null,
    /** The variant of a saved rule does not change: a rule for another one is a new rule. */
    val variantLocked: Boolean = false,
    val type: AlertType = AlertType.BELOW_PRICE,
    val priceCents: Long? = null,
    val pct: String = "10",
    val scope: AlertScope = AlertScope.VARIANT_WEB,
    val listingId: String? = null,
    val cooldown: String = "24",
    val active: Boolean = true,
    @StringRes val problem: Int? = null,
    val query: String = "",
    val results: List<VariantOption> = emptyList(),
    val searched: Boolean = false,
    /** The variant's followed links, for "Solo {tienda}": listing id to store name. */
    val stores: List<Pair<String, String>> = emptyList(),
    val saving: Boolean = false,
)

object RuleForm {
    const val MAX_COOLDOWN_HOURS = 720L
    private val DIGITS = Regex("\\d+")

    /** What the form checks before writing; the server checks the same (`AlertRuleRowSchema`). */
    @StringRes
    fun problem(form: RuleFormState): Int? {
        if (form.variant == null) return R.string.alerts_problem_variant
        if (form.type == AlertType.BELOW_PRICE && (form.priceCents ?: 0) <= 0) return R.string.alerts_problem_price
        if (form.type == AlertType.DROP_PCT && pct(form.pct) == null) return R.string.alerts_problem_pct
        if (cooldown(form.cooldown) == null) return R.string.alerts_problem_cooldown
        return null
    }

    /** "10" or "12.5" → a percentage in (0, 100]; null otherwise. */
    fun pct(text: String): Double? = Quantities.parse(text)?.takeIf { it <= 100.0 }

    fun cooldown(text: String): Long? = text.trim().takeIf { DIGITS.matches(it) }?.toLongOrNull()?.takeIf { it <= MAX_COOLDOWN_HOURS }
}
