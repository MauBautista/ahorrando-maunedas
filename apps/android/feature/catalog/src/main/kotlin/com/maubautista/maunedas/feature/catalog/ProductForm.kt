package com.maubautista.maunedas.feature.catalog

import androidx.annotation.StringRes
import com.maubautista.maunedas.core.data.ProductDraft
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.Units

/**
 * S-09 as typed. The display unit follows the measure of the first variant (kg, L or pz) until someone picks
 * one; tags typed with "alta rápida" stay as names until the product is saved.
 */
data class ProductForm(
    val id: String? = null,
    val name: String = "",
    val brand: String = "",
    val categoryId: String? = null,
    val tagIds: Set<String> = emptySet(),
    val newTags: List<String> = emptyList(),
    val tagInput: String = "",
    val displayUnit: DisplayUnit = DisplayUnit.L,
    val unitChosen: Boolean = false,
    val notes: String = "",
    @StringRes val nameError: Int? = null,
) {
    fun withName(value: String) = copy(name = value, nameError = null)

    fun withUnit(value: DisplayUnit) = copy(displayUnit = value, unitChosen = true)

    fun followingMeasure(measure: Measure) = if (unitChosen) this else copy(displayUnit = Units.defaultDisplayUnit(measure))

    fun toggleTag(id: String) = copy(tagIds = if (id in tagIds) tagIds - id else tagIds + id)

    fun withoutNewTag(name: String) = copy(newTags = newTags - name)

    /** An existing tag with that name (any case) is selected; otherwise the name waits to be created. */
    fun addTypedTag(existing: List<TagItem>): ProductForm {
        val name = tagInput.trim().take(100)
        if (name.isEmpty()) return copy(tagInput = "")
        val match = existing.firstOrNull { it.name.trim().equals(name, ignoreCase = true) }
        return when {
            match != null -> copy(tagIds = tagIds + match.id, tagInput = "")
            newTags.any { it.equals(name, ignoreCase = true) } -> copy(tagInput = "")
            else -> copy(newTags = newTags + name, tagInput = "")
        }
    }

    fun validate(): Pair<ProductDraft?, ProductForm> {
        if (name.trim().length !in 1..200) return null to copy(nameError = R.string.editor_error_name)
        return ProductDraft(id, name.trim(), brand.trim().take(200), categoryId, tagIds, newTags, displayUnit, notes.trim().take(2000)) to this
    }

    companion object {
        fun of(draft: ProductDraft) =
            ProductForm(
                id = draft.id,
                name = draft.name,
                brand = draft.brand,
                categoryId = draft.categoryId,
                tagIds = draft.tagIds,
                displayUnit = draft.displayUnit,
                unitChosen = true,
                notes = draft.notes,
            )
    }
}
