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
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.maubautista.maunedas.core.data.BestPrice
import com.maubautista.maunedas.core.data.CatalogItem
import com.maubautista.maunedas.core.data.CategoryNode
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.DisplayUnit
import kotlinx.coroutines.flow.flowOf
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
class CatalogScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()
    private val day = 86_400_000L

    private val items =
        listOf(
            CatalogItem("leche", "Leche Lala Entera", "Lala", 2, BestPrice("6 × 1 L", 2_650, DisplayUnit.L, "Costco", "purchase", now - 3 * day)),
            CatalogItem("cafe", "Café Legal", null, 1, BestPrice("1 kg", 30_000, DisplayUnit.KG, null, "shelf", now)),
            CatalogItem("coca", "Coca-Cola 600ml", "Coca-Cola", 1, null),
        )
    private val categories = listOf(CategoryNode("refri", "Refrigerados", 0), CategoryNode("lacteos", "Lácteos", 1))
    private val tags = listOf(TagItem("basicos", "Básicos"))

    /** What a Room query that already answered reports. */
    private val loaded = LoadStates(LoadState.NotLoading(false), LoadState.NotLoading(true), LoadState.NotLoading(true))

    private fun show(
        products: List<CatalogItem> = items,
        filters: CatalogFilters = CatalogFilters(),
        hasProducts: Boolean? = true,
        actions: CatalogActions = CatalogActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    CatalogScreen(filters, flowOf(PagingData.from(products, loaded)).collectAsLazyPagingItems(), categories, tags, hasProducts, now, actions)
                }
            }
        }
    }

    @Test
    fun cardsShowBrandPresentationsAndTheBestPricePerUnitWithStoreSourceAndAge() {
        show()
        for (text in listOf(
            "Leche Lala Entera",
            "Lala · 2 presentaciones",
            "$26.50/L",
            "6 × 1 L en Costco · hace 3 días",
            "1 presentación",
            "$300.00/kg",
            "1 kg en tienda sin sincronizar · hoy",
            "Coca-Cola · 1 presentación",
            "Sin precios en los últimos 90 días",
        )) {
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
        compose.onNodeWithContentDescription("Pagado", useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription("Anaquel", useUnmergedTree = true).assertExists()
    }

    @Test
    fun searchingFilteringAndOpeningReachTheViewModel() {
        val calls = mutableListOf<String>()
        show(
            actions =
                CatalogActions(
                    onQueryChange = { calls += "q:$it" },
                    onCategory = { calls += "cat:${it?.id}" },
                    onTag = { calls += "tag:${it?.id}" },
                    onOpenProduct = { calls += "open:$it" },
                ),
        )
        compose.onNodeWithText("Buscar por nombre, marca o código").performTextInput("leche")
        compose.onNodeWithText("Categoría").performClick()
        compose.onNodeWithText("Lácteos").performClick()
        compose.onNodeWithText("Etiqueta").performClick()
        compose.onNodeWithText("Básicos").performClick()
        compose.onNodeWithText("Café Legal").performClick()
        assertEquals(listOf("q:leche", "cat:lacteos", "tag:basicos", "open:cafe"), calls)
    }

    @Test
    fun aChosenFilterShowsItsNameAndTheSheetCanClearIt() {
        val calls = mutableListOf<String>()
        show(
            filters = CatalogFilters(query = "lala", category = categories[1]),
            actions = CatalogActions(onQueryChange = { calls += "q:$it" }, onCategory = { calls += "cat:${it?.id}" }),
        )
        compose.onNodeWithText("Lácteos").performClick()
        compose.onNodeWithText("Todas las categorías").performClick()
        compose.onNodeWithContentDescription("Borrar búsqueda").performClick()
        assertEquals(listOf("cat:null", "q:"), calls)
    }

    @Test
    fun anEmptyCatalogAndAnEmptySearchSayDifferentThings() {
        show(products = emptyList(), hasProducts = false)
        compose.onNodeWithText("Aún no hay productos. Se agregan al escanear un código o al registrar una compra.").assertExists()
    }

    @Test
    fun aSearchWithoutResultsSaysSo() {
        show(products = emptyList(), filters = CatalogFilters(query = "xyz"), hasProducts = true)
        compose.onNodeWithText("Ningún producto coincide con la búsqueda.").assertExists()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text is cut and the filters stay ≥ 48 dp. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(fontScale = 2f)
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 8)
        val cut =
            texts.mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
                layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
            }
        assertEquals("textos cortados al 200 %", emptyList<String>(), cut)
        for (label in listOf("Categoría", "Etiqueta")) {
            compose.onNodeWithText(label).assertHeightIsAtLeast(Spacing.touchTarget)
        }
    }
}

/** As in the design system and home tests: height, line limit, ellipsis or narrower than the text itself. */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
