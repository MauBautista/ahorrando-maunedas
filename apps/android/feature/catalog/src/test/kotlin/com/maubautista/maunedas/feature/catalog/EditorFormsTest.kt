package com.maubautista.maunedas.feature.catalog

import com.maubautista.maunedas.core.data.ProductDraft
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.data.VariantDraft
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.ContentUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class EditorFormsTest {
    @Test
    fun theLabelFollowsTheContentUntilSomeoneWritesOne() {
        var f = VariantForm().withMeasure(Measure.VOLUME).withUnit(ContentUnit.L).withAmount("1").withPack("6")
        assertEquals("6 × 1 L", f.label)
        f = f.withUnit(ContentUnit.ML).withAmount("355").withPack("12")
        assertEquals("12 × 355 ml", f.label)
        f = f.withLabel("Lata 355").withAmount("600")
        assertEquals("Lata 355", f.label)
        // Clearing the label brings the suggestion back.
        assertEquals("12 × 600 ml", f.withLabel("").label)
    }

    @Test
    fun rfCat02SixTimesOneLiterIsSavedInBaseUnits() {
        val (draft, _) = VariantForm().withUnit(ContentUnit.L).withAmount("1").withPack("6").validate()
        assertEquals(VariantDraft(null, "6 × 1 L", Measure.VOLUME, 1000.0, 6, false, emptyList()), draft)
        // A comma works as the decimal point too.
        assertEquals(1500.0, VariantForm().withUnit(ContentUnit.KG).withAmount("1,5").validate().first?.unitAmount)
    }

    @Test
    fun bulkIsOnlyByMassAndFixesOneKilo() {
        val bulk = VariantForm().withMeasure(Measure.MASS).withAmount("250").withPack("3").withBulk(true)
        assertEquals("A granel (kg)", bulk.label)
        assertEquals(VariantDraft(null, "A granel (kg)", Measure.MASS, 1000.0, 1, true, emptyList()), bulk.validate().first)
        assertFalse(VariantForm().withMeasure(Measure.VOLUME).withBulk(true).bulk)
        // Leaving mass turns it off.
        assertFalse(bulk.withMeasure(Measure.COUNT).bulk)
        assertEquals(ContentUnit.PZ, bulk.withMeasure(Measure.COUNT).unit)
    }

    @Test
    fun invalidContentSaysWhatToFix() {
        val (draft, f) = VariantForm().withMeasure(Measure.COUNT).withAmount("1.5").withPack("0").withLabel("x".repeat(101)).validate()
        assertNull(draft)
        assertEquals(R.string.editor_error_pack, f.packError)
        assertEquals(R.string.editor_error_pieces, f.amountError)
        assertEquals(R.string.editor_error_label, f.labelError)
        assertEquals(R.string.editor_error_amount, VariantForm().withAmount("0").validate().second.amountError)
        assertEquals(R.string.editor_error_label, VariantForm().validate().second.labelError)
    }

    @Test
    fun codesAreNormalizedAndCheckedBeforeAsking() {
        val f = VariantForm(codes = listOf("7501020515343"))
        assertEquals("7501020515350", f.withCodeInput("750-1020 515350").checkCode().getOrNull())
        assertEquals(R.string.editor_code_format, (f.withCodeInput("12345").checkCode().exceptionOrNull() as VariantForm.CodeProblem).reason)
        assertEquals(R.string.editor_code_format, (f.withCodeInput("75010205153a").checkCode().exceptionOrNull() as VariantForm.CodeProblem).reason)
        assertEquals(R.string.editor_code_repeated, (f.withCodeInput("7501020515343").checkCode().exceptionOrNull() as VariantForm.CodeProblem).reason)
        val added = f.withCodeInput("12345678").withCode("12345678")
        assertEquals(listOf("7501020515343", "12345678") to "", added.codes to added.codeInput)
    }

    @Test
    fun aSavedVariantComesBackAsTyped() {
        val f = VariantForm.of(VariantDraft("v1", "Six pack", Measure.VOLUME, 1500.0, 6, false, listOf("12345678")))
        assertEquals(listOf("1.5", "6", "Six pack"), listOf(f.amount, f.pack, f.label))
        assertEquals(ContentUnit.L, f.unit)
        // Editing the content keeps a label someone wrote.
        assertEquals("Six pack", f.withAmount("2").label)
    }

    @Test
    fun theDisplayUnitFollowsTheFirstVariantUntilChosen() {
        val p = ProductForm()
        assertEquals(DisplayUnit.KG, p.followingMeasure(Measure.MASS).displayUnit)
        assertEquals(DisplayUnit.PZ, p.followingMeasure(Measure.COUNT).displayUnit)
        assertEquals(DisplayUnit.ML100, p.withUnit(DisplayUnit.ML100).followingMeasure(Measure.MASS).displayUnit)
    }

    @Test
    fun typedTagsReuseExistingOnesIgnoringCase() {
        val existing = listOf(TagItem("t1", "Básicos"))
        var p = ProductForm().copy(tagInput = " básicos ").addTypedTag(existing)
        assertEquals(setOf("t1") to emptyList<String>(), p.tagIds to p.newTags)
        p = p.copy(tagInput = "Lácteos").addTypedTag(existing).copy(tagInput = "LÁCTEOS").addTypedTag(existing)
        assertEquals(listOf("Lácteos"), p.newTags)
        assertEquals(emptyList<String>(), p.withoutNewTag("Lácteos").newTags)
        assertEquals("", p.tagInput)
    }

    @Test
    fun aProductNeedsAName() {
        assertEquals(R.string.editor_error_name, ProductForm().withName("   ").validate().second.nameError)
        val (draft, _) = ProductForm(brand = " Lala ", notes = " fría ").withName(" Leche ").validate()
        assertEquals(ProductDraft(null, "Leche", "Lala", null, emptySet(), emptyList(), DisplayUnit.L, "fría"), draft)
    }
}
