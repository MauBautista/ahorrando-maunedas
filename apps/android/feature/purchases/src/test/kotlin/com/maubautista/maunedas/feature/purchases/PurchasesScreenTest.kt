package com.maubautista.maunedas.feature.purchases

import android.content.Context
import android.provider.Settings
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
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.data.StoreOption
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.HouseholdTime
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
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
class PurchasesScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    private val now = at("2026-10-22T18:00:00Z")

    /** What a Room query that already answered reports. */
    private val loaded = LoadStates(LoadState.NotLoading(false), LoadState.NotLoading(true), LoadState.NotLoading(true))

    private val today = at("2026-10-22T16:30:00Z")
    private val older = at("2026-10-20T20:05:00Z")
    private val rows =
        listOf(
            PurchaseListItem.Day(HouseholdTime.epochDay(today), today),
            PurchaseListItem.Row(PurchaseSummary("p1", "Soriana", "Centro", today, 23_000, 3, draft = true)),
            PurchaseListItem.Day(HouseholdTime.epochDay(older), older),
            PurchaseListItem.Row(PurchaseSummary("p2", null, null, older, 15_990, 1, draft = false)),
        )
    private val stores = listOf(StoreOption("costco", "Costco"), StoreOption("soriana", "Soriana"))

    @Before
    fun twentyFourHourClock() {
        Settings.System.putString(ApplicationProvider.getApplicationContext<Context>().contentResolver, Settings.System.TIME_12_24, "24")
    }

    private fun show(
        items: List<PurchaseListItem> = rows,
        filters: PurchaseFilters = PurchaseFilters(),
        hasPurchases: Boolean? = true,
        actions: PurchasesActions = PurchasesActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    PurchasesScreen(filters, flowOf(PagingData.from(items, loaded)).collectAsLazyPagingItems(), stores, hasPurchases, now, actions)
                }
            }
        }
    }

    @Test
    fun purchasesShowUnderTheirDayWithStoreTimeLinesTotalAndDraft() {
        show()
        for (text in listOf("Hoy", "Soriana · Centro", "10:30 · 3 productos", "$230.00", "Borrador", "martes 20 de octubre", "Tienda sin sincronizar", "14:05 · 1 producto", "$159.90")) {
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun filtersOpenTheirChoicesAndRowsOpenThePurchase() {
        val calls = mutableListOf<String>()
        show(
            actions =
                PurchasesActions(
                    onStore = { calls += "store:${it?.id}" },
                    onRange = { calls += "range:$it" },
                    onStatus = { calls += "status:$it" },
                    onOpenPurchase = { calls += "open:$it" },
                    onNewPurchase = { calls += "new" },
                ),
        )
        compose.onNodeWithText("Tienda").performClick()
        compose.onNodeWithText("Costco").performClick()
        compose.onNodeWithText("Fechas").performClick()
        compose.onNodeWithText("Mes pasado").performClick()
        compose.onNodeWithText("Estado").performClick()
        compose.onNodeWithText("Borradores").performClick()
        compose.onNodeWithText("Soriana · Centro").performClick()
        compose.onNodeWithText("Nueva compra").performClick()
        assertEquals(listOf("store:costco", "range:LastMonth", "status:draft", "open:p1", "new"), calls)
    }

    @Test
    fun chosenFiltersNameThemselves() {
        show(filters = PurchaseFilters(store = stores[1], range = DateRange.ThisMonth, status = "confirmed"))
        for (text in listOf("Soriana", "Este mes", "Confirmadas")) compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
    }

    @Test
    fun anEmptyHistoryAndAnEmptyFilterSayDifferentThings() {
        show(items = emptyList(), hasPurchases = false)
        compose.onNodeWithText("Aún no hay compras. Toca + para registrar la primera.").assertExists()
    }

    @Test
    fun aFilterWithoutResultsSaysSo() {
        show(items = emptyList(), filters = PurchaseFilters(status = "draft"), hasPurchases = true)
        compose.onNodeWithText("Ninguna compra coincide con los filtros.").assertExists()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text is cut and the filters stay ≥ 48 dp. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(fontScale = 2f)
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 6)
        val cut =
            texts.mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
                layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
            }
        assertEquals("textos cortados al 200 %", emptyList<String>(), cut)
        for (label in listOf("Tienda", "Fechas", "Estado")) compose.onNodeWithText(label).assertHeightIsAtLeast(Spacing.touchTarget)
    }
}

/** As in the other screen tests: height, line limit, ellipsis or narrower than the text itself. */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
