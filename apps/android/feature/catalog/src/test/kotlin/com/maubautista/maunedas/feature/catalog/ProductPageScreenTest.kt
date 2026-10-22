package com.maubautista.maunedas.feature.catalog

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
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.MergeCandidate
import com.maubautista.maunedas.core.data.PageComparison
import com.maubautista.maunedas.core.data.PagePrice
import com.maubautista.maunedas.core.data.PageVariant
import com.maubautista.maunedas.core.data.ProductPage
import com.maubautista.maunedas.core.data.VariantDraft
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant

/** A 360 × 800 dp phone with native graphics, as in the design system tests (T-106). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ProductPageScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()
    private val day = 86_400_000L

    private fun price(
        store: String,
        source: String,
        cents: Long,
        perUnit: Long,
        daysAgo: Long,
        unit: DisplayUnit = DisplayUnit.L,
    ) = PagePrice(store.lowercase(), store, source, cents, perUnit, unit, now - daysAgo * day)

    private val page =
        ProductPage(
            id = "leche",
            name = "Leche Lala Entera",
            brand = "Lala",
            categoryPath = "Refrigerados › Lácteos",
            tags = listOf("Básicos"),
            displayUnit = DisplayUnit.L,
            variants =
                listOf(
                    PageVariant("l1", "1 L", "1 L", Measure.VOLUME, listOf("7501020515343"), listOf(price("Walmart", "shelf", 2_850, 2_850, 2), price("Walmart", "purchase", 2_900, 2_900, 3))),
                    PageVariant("l6", "Six pack", "6 × 1 L", Measure.VOLUME, emptyList(), emptyList()),
                ),
            comparison =
                listOf(
                    PageComparison("l6", "Six pack", "costco", "Costco", DisplayUnit.L, price("Costco", "shelf", 15_900, 2_650, 1), 2_500, now - 30 * day, 2_575, 2, best = true, comparable = true),
                    PageComparison("l1", "1 L", "walmart", "Walmart", DisplayUnit.L, price("Walmart", "shelf", 2_850, 2_850, 2), 2_600, now - 40 * day, 2_817, 3, best = false, comparable = true),
                    PageComparison("pz", "100 vasos", "costco", "Costco", DisplayUnit.PZ, price("Costco", "shelf", 100, 1, 1, DisplayUnit.PZ), 1, now - day, 1, 1, best = false, comparable = false),
                ),
        )

    private fun show(
        isAdmin: Boolean = false,
        actions: ProductPageActions = ProductPageActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { ProductPageScreen(page, isAdmin, now, actions) } }
        }
    }

    private fun scrollTo(text: String) = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollToIndex)).performScrollToNode(hasText(text, substring = true))

    @Test
    fun presentationsShowContentCodesAndTheLatestPricePerStoreAndSource() {
        show()
        for (text in listOf("Lala · Refrigerados › Lácteos", "Básicos", "1 L", "Códigos: 7501020515343", "$28.50  $28.50/L", "Walmart · hace 2 días", "$29.00  $29.00/L", "Walmart · hace 3 días", "Six pack", "6 × 1 L", "Sin precios registrados.")) {
            scrollTo(text)
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun theComparatorHighlightsTheCheapestAndSetsAsideOtherMeasures() {
        show()
        compose.onNodeWithText("Comparar").performClick()
        for (text in listOf(
            "Más barato",
            "Six pack · Costco",
            "$26.50/L",
            "Mínimo: $25.00/L",
            "Promedio de 90 días: $25.75/L · 2 precios",
            "Promedio de 90 días: $28.17/L · 3 precios",
            "Otras medidas (no se comparan)",
            "100 vasos · Costco",
            "Promedio de 90 días: $0.01/pz · 1 precio",
        )) {
            scrollTo(text)
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun membersDoNotSeeMergeNorDelete() {
        show(isAdmin = false)
        for (text in listOf("Fusionar con otro producto", "Eliminar", "Fusionar con otra presentación")) compose.onNodeWithText(text).assertDoesNotExist()
    }

    @Test
    fun anAdminCanEditAddMergeAndDelete() {
        val calls = mutableListOf<String>()
        show(
            isAdmin = true,
            actions =
                ProductPageActions(
                    onEdit = { calls += "edit" },
                    onAddVariant = { calls += "add" },
                    onOpenVariant = { calls += "open:$it" },
                    onMergeProduct = { calls += "merge" },
                    onMergeVariant = { calls += "mergeVariant:${it.id}" },
                    onDelete = { calls += "delete" },
                ),
        )
        listOf("Editar", "Agregar presentación", "Fusionar con otro producto", "Eliminar").forEach { compose.onNodeWithText(it).performClick() }
        scrollTo("Códigos: 7501020515343")
        compose.onNodeWithText("Códigos: 7501020515343").performClick()
        scrollTo("Fusionar con otra presentación")
        compose.onAllNodes(hasText("Fusionar con otra presentación"))[0].performClick()
        assertEquals(listOf("edit", "add", "merge", "delete", "open:l1", "mergeVariant:l1"), calls)
    }

    @Test
    fun theMergeSheetListsCandidatesAndConfirmsWhatMoves() {
        val picked = mutableListOf<String?>()
        var confirmed = false
        compose.setContent {
            MaunedasTheme {
                MergeSheet(
                    state = MergeState(MergeKind.PRODUCT, "leche", "Leche Lala", target = MergeCandidate("alpura", "Leche Alpura", "Alpura")),
                    candidates = listOf(MergeCandidate("alpura", "Leche Alpura", "Alpura")),
                    onQuery = {},
                    onPick = { picked += it?.id },
                    onConfirm = { confirmed = true },
                    onDismiss = {},
                )
            }
        }
        compose.onNodeWithText("Fusionar «Leche Lala» con…").assertExists()
        compose.onNodeWithText(
            "¿Fusionar «Leche Lala» en «Leche Alpura»? Sus presentaciones, fotos y etiquetas pasan a «Leche Alpura», y «Leche Lala» se elimina. No se puede deshacer.",
        ).assertExists()
        compose.onNodeWithText("Fusionar").performClick()
        assertTrue(confirmed)
    }

    @Test
    fun aCodeOfAnotherVariantOffersTheAdminToMergeIntoIt() {
        val form =
            VariantForm.of(VariantDraft("v1", "1 L", Measure.VOLUME, 1000.0, 1, false, emptyList()))
                .withCodeProblem(R.string.editor_code_taken, "Leche Alpura · 1 L", "w1")
        var asked = false
        compose.setContent {
            MaunedasTheme { VariantEditorScreen(VariantEditorState(loading = false, variant = form), isAdmin = true, actions = VariantEditorActions(onAskMerge = { asked = true })) }
        }
        compose.onNodeWithText("Fusionar esta presentación con «Leche Alpura · 1 L»").performClick()
        assertTrue(asked)
    }

    @Test
    fun membersAndNewVariantsAreNotOfferedThatMerge() {
        val form = VariantForm().withCodeProblem(R.string.editor_code_taken, "Leche Alpura · 1 L", "w1")
        compose.setContent { MaunedasTheme { VariantEditorScreen(VariantEditorState(loading = false, variant = form), isAdmin = true, actions = VariantEditorActions()) } }
        compose.onNodeWithText("Fusionar esta presentación con «Leche Alpura · 1 L»").assertDoesNotExist()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of either tab is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(isAdmin = true, fontScale = 2f)
        assertEquals("textos cortados al 200 %", emptyList<String>(), cutTexts())
        compose.onNodeWithText("Comparar").performClick()
        assertEquals("textos cortados al 200 % (Comparar)", emptyList<String>(), cutTexts())
    }

    private fun cutTexts(): List<String?> {
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 8)
        return texts.mapNotNull { node ->
            val layouts = mutableListOf<TextLayoutResult>()
            node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
            layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
        }
    }
}

/** As in the other screen tests: height, line limit, ellipsis or narrower than the text itself. */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
