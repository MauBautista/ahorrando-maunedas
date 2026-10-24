package com.maubautista.maunedas.feature.catalog

import androidx.annotation.StringRes
import com.maubautista.maunedas.core.data.VariantDraft
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.model.Quantities
import com.maubautista.maunedas.core.pricing.Content
import com.maubautista.maunedas.core.pricing.ContentUnit
import com.maubautista.maunedas.core.pricing.ParsedQuantity
import com.maubautista.maunedas.core.pricing.QuantityParser
import kotlin.math.floor

/**
 * S-10 as typed: `[pack] × [amount] [unit]`, "a granel", the label and the barcodes. The label follows the
 * suggestion ("6 × 1 L") until someone writes their own; clearing it brings the suggestion back.
 */
data class VariantForm(
    val id: String? = null,
    val measure: Measure = Measure.VOLUME,
    val bulk: Boolean = false,
    val pack: String = "1",
    val amount: String = "",
    val unit: ContentUnit = ContentUnit.L,
    val label: String = "",
    val labelEdited: Boolean = false,
    val codes: List<String> = emptyList(),
    /** Codes that came from the scanner keep `source = 'scan'` (05 §5 S-12). */
    val codeSources: Map<String, String> = emptyMap(),
    val codeInput: String = "",
    /** Where [codeInput] came from: `scan` when the camera read it, `manual` when typed. */
    val codeInputSource: String = "manual",
    @StringRes val codeError: Int? = null,
    /** "Producto · presentación" that already has the typed code, and its id (an admin can merge into it). */
    val codeOwner: String? = null,
    val codeOwnerId: String? = null,
    @StringRes val packError: Int? = null,
    @StringRes val amountError: Int? = null,
    @StringRes val labelError: Int? = null,
) {
    fun withMeasure(value: Measure): VariantForm =
        copy(
            measure = value,
            unit = if (unit.measure == value) unit else ContentUnit.of(value).first(),
            bulk = bulk && value == Measure.MASS,
            amountError = null,
        ).relabeled()

    /** Only by mass: one kilo in a pack of one (`VariantRowSchema`). */
    fun withBulk(value: Boolean): VariantForm = copy(bulk = value && measure == Measure.MASS, packError = null, amountError = null).relabeled()

    fun withPack(value: String): VariantForm = copy(pack = value, packError = null).relabeled()

    fun withAmount(value: String): VariantForm = copy(amount = value, amountError = null).relabeled()

    fun withUnit(value: ContentUnit): VariantForm = copy(unit = value, measure = value.measure, amountError = null).relabeled()

    fun withLabel(value: String): VariantForm =
        if (value.isBlank()) copy(labelEdited = false, labelError = null).relabeled() else copy(label = value, labelEdited = true, labelError = null)

    fun withCodeInput(
        value: String,
        source: String = "manual",
    ): VariantForm = copy(codeInput = value, codeInputSource = source, codeError = null, codeOwner = null, codeOwnerId = null)

    fun withoutCode(code: String): VariantForm = copy(codes = codes - code, codeSources = codeSources - code)

    /** The typed code as the server stores it (spaces and dashes dropped), or why it cannot be added. */
    fun checkCode(): Result<String> {
        val code = codeInput.replace(Regex("[\\s-]"), "")
        return when {
            !CODE.matches(code) -> Result.failure(CodeProblem(R.string.editor_code_format))
            code in codes -> Result.failure(CodeProblem(R.string.editor_code_repeated))
            else -> Result.success(code)
        }
    }

    fun withCode(code: String): VariantForm =
        copy(
            codes = if (code in codes) codes else codes + code,
            codeSources = if (codeInputSource == "manual") codeSources else codeSources + (code to codeInputSource),
            codeInput = "",
            codeInputSource = "manual",
            codeError = null,
            codeOwner = null,
            codeOwnerId = null,
        )

    fun withCodeProblem(
        @StringRes error: Int,
        owner: String? = null,
        ownerId: String? = null,
    ): VariantForm = copy(codeError = error, codeOwner = owner, codeOwnerId = ownerId)

    /** "6 × 1 L", "946 ml", "A granel (kg)"; null while the content is not a number yet. */
    fun suggestedLabel(): String? {
        if (bulk) return Content.BULK_LABEL
        val base = baseAmount() ?: return null
        val packs = packCount() ?: return null
        return QuantityParser.suggestVariantLabel(ParsedQuantity(measure, base, packs))
    }

    /** The draft to save, or this form with its errors. */
    fun validate(): Pair<VariantDraft?, VariantForm> {
        val packs = if (bulk) 1 else packCount()
        val base = if (bulk) Content.BULK_GRAMS else baseAmount()
        val amountProblem =
            when {
                bulk -> null
                Quantities.parse(amount) == null -> R.string.editor_error_amount
                unit.integer && base != null && base != floor(base) -> R.string.editor_error_pieces
                else -> null
            }
        val checked =
            copy(
                packError = if (packs == null) R.string.editor_error_pack else null,
                amountError = amountProblem,
                labelError = if (label.trim().length !in 1..100) R.string.editor_error_label else null,
            )
        if (packs == null || base == null || amountProblem != null || checked.labelError != null) return null to checked
        return VariantDraft(id, label.trim(), measure, base, packs, bulk, codes, codeSources.filterKeys { it in codes }) to checked
    }

    private fun packCount(): Int? = pack.trim().toIntOrNull()?.takeIf { it >= 1 }

    private fun baseAmount(): Double? = Quantities.parse(amount)?.let { Content.toBase(it, unit) }

    private fun relabeled(): VariantForm = if (labelEdited) this else copy(label = suggestedLabel().orEmpty())

    class CodeProblem(
        @StringRes val reason: Int,
    ) : Exception()

    companion object {
        private val CODE = Regex("^[0-9]{6,14}$")

        /** A saved variant in the assistant: kg or L from 1000 up; its own label counts as written by someone. */
        fun of(draft: VariantDraft): VariantForm {
            val (unit, amount) = Content.forEditing(draft.measure, draft.unitAmount)
            return VariantForm(
                id = draft.id,
                measure = draft.measure,
                bulk = draft.soldByWeight,
                pack = draft.packCount.toString(),
                amount = if (draft.soldByWeight) "" else plain(amount),
                unit = unit,
                label = draft.label,
                labelEdited = true,
                codes = draft.codes,
            )
        }

        /**
         * A new variant from the scanner (S-12): the code read and, when an open catalog knew it, its content. Pieces
         * are counted per unit, so `unitAmount` comes in base units as `parsed` does.
         */
        fun prefilled(
            measure: Measure,
            code: String?,
            unitAmount: Double? = null,
            packCount: Int? = null,
        ): VariantForm {
            var form = VariantForm().withMeasure(measure)
            if (unitAmount != null && unitAmount > 0) {
                val (unit, amount) = Content.forEditing(measure, unitAmount)
                form = form.withUnit(unit).withAmount(plain(amount))
            }
            if (packCount != null && packCount >= 1) form = form.withPack(packCount.toString())
            return if (code == null) form else form.copy(codes = listOf(code), codeSources = mapOf(code to "scan"))
        }

        private fun plain(x: Double): String = if (x == floor(x)) x.toLong().toString() else x.toBigDecimal().stripTrailingZeros().toPlainString()
    }
}
