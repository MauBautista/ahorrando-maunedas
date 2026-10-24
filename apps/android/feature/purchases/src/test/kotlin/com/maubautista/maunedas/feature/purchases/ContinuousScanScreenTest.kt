package com.maubautista.maunedas.feature.purchases

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.data.PurchaseLine
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

/** A 360 × 800 dp phone with native graphics, as in the design system tests (T-106). The camera is a stand-in. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ContinuousScanScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val milk = LineVariant("v", "p", "Leche Lala", "1 L", "Lala", Measure.VOLUME, 1000.0, 1, false, DisplayUnit.L)
    private val draft =
        PurchaseDraft(
            storeId = "s",
            purchasedAt = 0,
            lines = listOf(PurchaseLine(variant = milk, quantity = 2.0, unitPriceCents = 2_850), PurchaseLine(variant = milk.copy(id = "v2", label = "2 L"), quantity = 1.0, unitPriceCents = 0)),
        )

    private fun show(
        session: ScanSession,
        pending: List<PendingCode> = emptyList(),
        actions: ScanPanelActions = ScanPanelActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { ContinuousScanner(session, pending, draft, 5_700, onCode = {}, actions = actions, camera = { Box(Modifier.fillMaxSize()) }) } }
        }
    }

    @Test
    fun theLineJustScannedHasItsPriceFocused() {
        val calls = mutableListOf<String>()
        show(ScanSession(lineIndex = 1, reads = 2), actions = ScanPanelActions(onPrice = { calls += "price:$it" }, onStep = { calls += "step:$it" }, onDone = { calls += "done" }))
        compose.onNodeWithText("Leche Lala · 2 L").assertExists()
        // No price yet: the field is empty and has the focus (RF-COM-09).
        compose.onNodeWithText("Precio").assertIsFocused()
        compose.onNodeWithText("Precio").performTextReplacement("31.50")
        compose.onNodeWithContentDescription("Una más").performClick()
        compose.onNodeWithText("2 productos en la compra · $57.00").performScrollTo().assertExists()
        compose.onNodeWithText("Listo").performClick()
        assertEquals(listOf("price:3150", "step:1", "done"), calls)
    }

    @Test
    fun codesThatAreNotHereSayWhyAndCanBeAdded() {
        val registered = mutableListOf<String>()
        show(
            ScanSession(looking = "7501000000024"),
            listOf(PendingCode("7501000000017", "Café Legal · 400 g"), PendingCode("12345678", null), PendingCode("87654321", null, offline = true)),
            ScanPanelActions(onRegister = { registered += it }, onDismiss = { registered += "x$it" }),
        )
        compose.onNodeWithText("Apunta al código de barras de cada producto.").assertExists()
        compose.onNodeWithText("Buscando 7501000000024…").assertExists()
        compose.onNodeWithText("Bajando «Café Legal · 400 g» del servidor…").assertExists()
        compose.onNodeWithText("12345678 no está en tu catálogo.").assertExists()
        compose.onNodeWithText("87654321 no está en tu catálogo y no hay internet para buscarlo.").performScrollTo().assertExists()
        // One "Darlo de alta" for each code that is not in the catalog.
        val register = compose.onAllNodes(hasText("Darlo de alta") and hasClickAction())
        register.assertCountEquals(2)
        register[0].performClick()
        register[1].performScrollTo().performClick()
        // A code read by mistake can be taken off the list.
        compose.onNodeWithContentDescription("Quitar 7501000000017").performClick()
        assertEquals(listOf("12345678", "87654321", "x7501000000017"), registered)
    }

    @Test
    fun inTheEditorALineWithoutAPriceSaysSoAndScanningIsOneTapAway() {
        var scan = false
        compose.setContent {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    PurchaseEditorScreen(EditorState(loading = false, draft = draft), emptyList(), emptyList(), "Puebla", 0, EditorActions(onScan = { scan = true }))
                }
            }
        }
        compose.onNodeWithText("Sin precio").assertExists()
        compose.onNodeWithText("Escanear productos").performScrollTo().performClick()
        assertTrue(scan)
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of the panel is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(ScanSession(lineIndex = 0, reads = 1), listOf(PendingCode("12345678", null, offline = true)), fontScale = 2f)
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 6)
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
