package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.HistoryFilter
import com.maubautista.maunedas.core.data.HistoryPeriod
import com.maubautista.maunedas.core.data.HistoryPoint
import com.maubautista.maunedas.core.data.HistoryStore
import com.maubautista.maunedas.core.data.PageVariant
import com.maubautista.maunedas.core.data.VariantHistory
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
class HistoryTabTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()

    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    private val points =
        listOf(
            HistoryPoint("p1", "purchase", "walmart", "Walmart", at("2025-12-26T18:00:00Z"), 2_850, 2_565, 2_565, true),
            HistoryPoint("p2", "purchase", "walmart", "Walmart", at("2026-10-17T18:00:00Z"), 2_850, 1_425, 1_425, true),
            HistoryPoint("p3", "shelf", "walmart", "Walmart", at("2026-10-19T18:00:00Z"), 2_700, 2_700, 2_700, true),
            HistoryPoint("p4", "web", "amazon", "Amazon", at("2026-10-20T18:00:00Z"), 2_600, 2_600, 2_600, false),
        )
    private val history = VariantHistory(DisplayUnit.L, points, listOf(HistoryStore("amazon", "Amazon"), HistoryStore("walmart", "Walmart")))
    private val variants = listOf(PageVariant("l1", "1 L", "1 L", Measure.VOLUME, emptyList(), emptyList()), PageVariant("l6", "6 × 1 L", "6 × 1 L", Measure.VOLUME, emptyList(), emptyList()))

    @Test
    fun theChartHasOneSeriesPerSourceInPesosByMexicoCityDay() {
        val series = chartSeries(points)
        assertEquals(listOf("purchase", "shelf", "web"), series.map { it.source })
        // 2025-12-26 and 2026-10-17 in Mexico City.
        assertEquals(listOf(20_448L, 20_743L), series[0].x)
        assertEquals(listOf(25.65, 14.25), series[0].y)
        assertEquals(listOf("shelf"), chartSeries(points.filter { it.source == "shelf" }).map { it.source })
        assertEquals(emptyList<ChartSeries>(), chartSeries(emptyList()))
    }

    private fun show(
        tab: HistoryTabState,
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { LazyColumn { historyTab(variants, tab, now) } } }
        }
    }

    private fun scrollTo(text: String) = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollToIndex)).performScrollToNode(hasText(text, substring = true))

    @Test
    fun theChartIsDescribedAndEveryPriceIsListedNewestFirst() {
        show(HistoryTabState("l1", HistoryFilter(), history))
        compose.onNodeWithContentDescription(
            "Gráfica de 4 precios por L, del 26 dic 2025 al 20 oct. El más bajo: $14.25/L; el más alto: $27.00/L.",
        ).assertExists()
        for (text in listOf("20 oct · Amazon", "$26.00  $26.00/L", "19 oct · Walmart", "$14.25  $14.25/L", "26 dic 2025 · Walmart", "$25.65  $25.65/L")) {
            scrollTo(text)
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
        assertEquals(3, compose.onAllNodes(hasText("Con promoción"), useUnmergedTree = true).fetchSemanticsNodes().size)
        // Newest first under the chart.
        scrollTo("Precios")
        val rows = compose.onAllNodes(hasText(" · ", substring = true), useUnmergedTree = true).fetchSemanticsNodes().mapNotNull { it.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
        assertEquals("20 oct · Amazon", rows.first())
    }

    @Test
    fun filtersChangeVariantSourcesPeriodAndStore() {
        val calls = mutableListOf<String>()
        compose.setContent {
            var filter by remember { mutableStateOf(HistoryFilter()) }
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    LazyColumn {
                        historyTab(
                            variants,
                            HistoryTabState("l1", filter, history, onVariant = { calls += "variant:$it" }, onFilter = { change ->
                                filter = change(filter)
                                calls += "filter:${filter.sources.sorted()}:${filter.period}:${filter.storeId}"
                            }),
                            now,
                        )
                    }
                }
            }
        }
        compose.onNodeWithText("6 × 1 L").performClick()
        compose.onNodeWithText("Anaquel").performClick()
        compose.onNodeWithText("Todo").performClick()
        compose.onNodeWithText("Todas las tiendas").performClick()
        compose.onNodeWithText("Walmart").performClick()
        assertEquals(
            listOf(
                "variant:l6",
                "filter:[purchase, web]:YEAR:null",
                "filter:[purchase, web]:ALL:null",
                "filter:[purchase, web]:ALL:walmart",
            ),
            calls,
        )
    }

    @Test
    fun withoutPricesItSaysSo() {
        show(HistoryTabState("l1", HistoryFilter(period = HistoryPeriod.THREE_MONTHS), history.copy(points = emptyList())))
        compose.onNodeWithText("Sin precios con estos filtros.").assertExists()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of the filters or the list is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(HistoryTabState("l1", HistoryFilter(), history), fontScale = 2f)
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
