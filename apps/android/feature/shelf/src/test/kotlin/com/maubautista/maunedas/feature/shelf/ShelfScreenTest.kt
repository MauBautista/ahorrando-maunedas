package com.maubautista.maunedas.feature.shelf

import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** A 360 × 800 dp phone with native graphics, as in the design system tests (T-106). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShelfScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val shampoo = LineVariant("v", "p", "Shampoo Sedal", "400 ml", "Sedal", Measure.VOLUME, 400.0, 1, false, DisplayUnit.L)
    private val stores = listOf(StoreChoice("s", "Soriana"), StoreChoice("c", "Costco"))
    private val branches = listOf(BranchChoice("b", "Centro", "Puebla"))

    private fun show(
        state: ShelfState,
        actions: ShelfActions = ShelfActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { ShelfScreen(state, stores, branches, "Puebla", actions) } }
        }
    }

    @Test
    fun aTwoForOneShowsWhatOneCostsAndSavesHowItReads() {
        val saves = mutableListOf<Pair<Boolean, String?>>()
        show(
            ShelfState(loading = false, variant = shampoo, storeId = "s", branchId = "b", priceCents = 8_900, promoType = PromoType.NXM, params = PromoParams(n = 2.0, m = 1.0)),
            ShelfActions(onSave = { a, t -> saves += a to t }),
        )
        compose.onNodeWithText("Shampoo Sedal · 400 ml").assertExists()
        compose.onNodeWithText("Soriana").assertExists()
        compose.onNodeWithText("Sucursal: Centro").assertExists()
        // $44.50 for 400 ml is $111.25 per liter.
        compose.onNodeWithText("Con la promoción: $44.50 cada uno · $111.25/L").performScrollTo().assertExists()
        compose.onNodeWithText("Guardar").performScrollTo().performClick()
        compose.onNodeWithText("Guardar y otro").performScrollTo().performClick()
        assertEquals(listOf(false to "2x1", true to "2x1"), saves)
    }

    @Test
    fun withoutAPromotionItShowsThePricePerUnitAndMsiSaysItChangesNothing() {
        val saves = mutableListOf<String?>()
        show(ShelfState(loading = false, variant = shampoo, storeId = "s", priceCents = 3_000), ShelfActions(onSave = { _, t -> saves += t }))
        compose.onNodeWithText("Por unidad: $75.00/L").performScrollTo().assertExists()
        compose.onNodeWithText("Sucursal: Sin sucursal").assertExists()
        compose.onNodeWithText("Guardar").performScrollTo().performClick()
        assertEquals(listOf<String?>(null), saves)
    }

    @Test
    fun msiChangesNothing() {
        show(ShelfState(loading = false, variant = shampoo, storeId = "s", priceCents = 899_900, promoType = PromoType.MSI, params = PromoParams(months = 12.0)))
        compose.onNodeWithText("Los meses sin intereses no cambian el precio.").performScrollTo().assertExists()
    }

    @Test
    fun withoutAVariantThereIsASearchAScanAndANoteForUnknownCodes() {
        val chosen = mutableListOf<String>()
        var photo = false
        show(
            ShelfState(loading = false, query = "sham", results = listOf(VariantChoice(shampoo, null)), unknownCode = "12345678", error = R.string.shelf_need_store),
            ShelfActions(onChoose = { chosen += it.variant.id }, onTakePhoto = { photo = true }),
        )
        compose.onNodeWithText("Escanear código").assertExists()
        compose.onNodeWithText("El código 12345678 no está en tu catálogo", substring = true).assertExists()
        compose.onNodeWithText("Elegir tienda").assertExists()
        compose.onNodeWithText("Sucursal", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Elige la tienda.").performScrollTo().assertExists()
        compose.onNodeWithText("Shampoo Sedal · 400 ml").performClick()
        compose.onNodeWithText("Tomar foto del anaquel").performScrollTo().performClick()
        assertEquals(listOf("v"), chosen)
        assertTrue(photo)
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(
            ShelfState(loading = false, variant = shampoo, storeId = "s", branchId = "b", priceCents = 8_900, promoType = PromoType.NXM, params = PromoParams(n = 2.0, m = 1.0)),
            fontScale = 2f,
        )
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 8)
        val cut =
            texts.mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
                layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
            }
        assertEquals("textos cortados al 200 %", emptyList<String>(), cut)
    }
}

/** As in the other screen tests: height, line limit, ellipsis or narrower than the text itself. */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
