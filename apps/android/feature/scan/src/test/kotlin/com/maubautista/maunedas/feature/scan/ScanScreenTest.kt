package com.maubautista.maunedas.feature.scan

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
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.CatalogGuess
import com.maubautista.maunedas.core.data.OpenDraft
import com.maubautista.maunedas.core.data.PagePrice
import com.maubautista.maunedas.core.data.ProductChoice
import com.maubautista.maunedas.core.data.ScanHit
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

/** A 360 × 800 dp phone with native graphics, as in the design system tests (T-106). The camera is a stand-in. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScanScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-24T18:00:00Z").toEpochMilli()
    private val hit = ScanHit("v", "p", "Leche Lala", "1 L", "Lala", listOf(PagePrice("s", "Soriana", "shelf", 2_700, 2_700, DisplayUnit.L, now - 86_400_000L)))
    private val guess = CatalogGuess("Leche entera", "Lala", "6 x 1 l", Measure.VOLUME, 1000.0, 6, null, "Open Food Facts contributors")

    private fun show(
        result: ScanResult?,
        actions: ScanActions = ScanActions(),
        onCode: (String) -> Unit = {},
        onChoose: () -> Unit = {},
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    ScanScreen(result, now, actions, onCode, {}, onChoose, {}, camera = { Box(Modifier.fillMaxSize()) })
                }
            }
        }
    }

    @Test
    fun aFoundCodeShowsItsPricesAndTheThreeActions() {
        val calls = mutableListOf<String>()
        show(
            ScanResult.Found("7501020515343", hit, OpenDraft("d", "Soriana")),
            ScanActions(
                onAddToPurchase = { d, v -> calls += "add:$d:$v" },
                onShelfPrice = { calls += "shelf:$it" },
                onOpenProduct = { calls += "open:$it" },
            ),
        )
        for (text in listOf("Código 7501020515343", "Leche Lala · 1 L", "$27.00  $27.00/L", "Soriana · ayer")) compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Agregar a la compra de Soriana").performScrollTo().performClick()
        compose.onNodeWithText("Precio de anaquel").performScrollTo().performClick()
        compose.onNodeWithText("Ver ficha").performScrollTo().performClick()
        assertEquals(listOf("add:d:v", "shelf:v", "open:p"), calls)
    }

    @Test
    fun withoutAnOpenDraftThereIsNoAddToPurchase() {
        show(ScanResult.Found("7501020515343", hit, null))
        compose.onNodeWithText("Agregar a la compra", substring = true).assertDoesNotExist()
    }

    @Test
    fun anOpenCatalogPrefillsTheNewProductOrAVariantOfOneWeHave() {
        val calls = mutableListOf<String>()
        var choosing = false
        show(
            ScanResult.New("7501020515350", guess, offline = false),
            ScanActions(onNewProduct = { code, g -> calls += "new:$code:${g?.name}" }),
            onChoose = { choosing = true },
        )
        compose.onNodeWithText("Encontrado en un catálogo abierto (Open Food Facts contributors)").assertExists()
        compose.onNodeWithText("Leche entera · Lala").assertExists()
        compose.onNodeWithText("Contenido: 6 x 1 l").assertExists()
        compose.onNodeWithText("Nuevo producto").performScrollTo().performClick()
        compose.onNodeWithText("¿Es otra presentación de un producto que ya tienes?").performScrollTo().performClick()
        assertEquals(listOf("new:7501020515350:Leche entera"), calls)
        assertTrue(choosing)
    }

    @Test
    fun choosingAnExistingProductAddsAVariantToIt() {
        val calls = mutableListOf<String>()
        show(
            ScanResult.New("12345678", null, offline = true, query = "leche", choices = listOf(ProductChoice("p", "Leche Lala", "Lala")), choosing = true),
            ScanActions(onNewVariant = { p, code, g -> calls += "variant:$p:$code:${g == null}" }),
        )
        compose.onNodeWithText("Sin internet no se puede buscar", substring = true).assertExists()
        compose.onNodeWithText("Leche Lala · Lala").performScrollTo().performClick()
        assertEquals(listOf("variant:p:12345678:true"), calls)
    }

    @Test
    fun aTypedCodeIsCheckedBeforeSearching() {
        val codes = mutableListOf<String>()
        show(null, onCode = { codes += it })
        compose.onNodeWithText("Escribir el código").performClick()
        compose.onNodeWithText("Código de barras").performTextReplacement("123")
        compose.onNodeWithText("Buscar").performClick()
        compose.onNodeWithText("Un código tiene de 6 a 14 dígitos.").assertExists()
        compose.onNodeWithText("Código de barras").performTextReplacement("7501-020515343")
        compose.onNodeWithText("Buscar").performClick()
        assertEquals(listOf("7501020515343"), codes)
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of a result is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(ScanResult.Found("7501020515343", hit, OpenDraft("d", "Soriana")), fontScale = 2f)
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 5)
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
