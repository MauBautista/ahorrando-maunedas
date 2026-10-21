package com.maubautista.maunedas.core.designsystem

import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.designsystem.component.ComponentGallery
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.designsystem.component.PriceSource
import com.maubautista.maunedas.core.designsystem.component.PriceText
import com.maubautista.maunedas.core.designsystem.component.QuantityField
import com.maubautista.maunedas.core.model.DisplayUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A 360 × 800 dp phone, the narrowest of the family's (05 §7), with Robolectric's native graphics: the legacy
 * mode does not measure text, so overflow could not be checked.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ComponentsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun moneyFieldAcceptsBothDecimalSeparatorsAndFlagsWhatIsNotAPrice() {
        val reported = mutableListOf<Long?>()
        compose.setContent { MaunedasTheme { MoneyField(cents = null, onCentsChange = { reported += it }, label = "Precio") } }
        val field = compose.onNodeWithText("Precio")
        field.performTextReplacement("28,5")
        field.performTextReplacement("28.50")
        field.performTextReplacement("12.345")
        assertEquals(listOf(2850L, 2850L, null), reported)
        compose.onNodeWithText("Escribe un precio, por ejemplo 28.50").assertExists()
    }

    @Test
    fun quantityFieldOnlyAllowsDecimalsWhenSoldByWeight() {
        val pieces = mutableListOf<Double?>()
        val weight = mutableListOf<Double?>()
        compose.setContent {
            MaunedasTheme {
                androidx.compose.foundation.layout.Column {
                    QuantityField(quantity = null, onQuantityChange = { pieces += it }, label = "Piezas", soldByWeight = false)
                    QuantityField(quantity = null, onQuantityChange = { weight += it }, label = "Kilos", soldByWeight = true)
                }
            }
        }
        compose.onNodeWithText("Piezas").performTextReplacement("1.5")
        compose.onNodeWithText("Piezas").performTextReplacement("3")
        compose.onNodeWithText("Kilos").performTextReplacement("0,845")
        assertEquals(listOf(null, 3.0), pieces)
        assertEquals(listOf(0.845), weight)
    }

    @Test
    fun priceTextShowsThePricePerUnitAndAnnouncesTheSource() {
        compose.setContent {
            MaunedasTheme { PriceText(cents = 15_900, perUnitCents = 2_650, unit = DisplayUnit.L, source = PriceSource.SHELF) }
        }
        compose.onNodeWithText("$159.00  $26.50/L").assertExists()
        compose.onNodeWithContentDescription("Anaquel").assertExists()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text is cut and controls stay ≥ 48 dp. */
    @Test
    fun atTwiceTheFontSizeNothingIsCutAndTouchTargetsStay48dp() {
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale = 2f)) {
                // Screens scroll: the content may be taller than the window, never wider than the phone.
                MaunedasTheme { Surface(Modifier.width(360.dp).verticalScroll(rememberScrollState())) { ComponentGallery() } }
            }
        }
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult)).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 8)
        val cut =
            texts.mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
                val text = node.config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: node.config.getOrNull(SemanticsProperties.EditableText)?.text
                // An ellipsis is a cut too.
                layouts.firstOrNull()?.takeIf { it.hasVisualOverflow }?.let { text }
            }
        assertEquals("textos cortados al 200 %", emptyList<String>(), cut)
        for (label in listOf("Precio unitario", "Cantidad (kg)", "Tienda", "Buscar producto")) {
            compose.onAllNodesWithText(label)[0].assertHeightIsAtLeast(Spacing.touchTarget)
        }
    }

    @Test
    fun themeColorsComeFromTheTokens() {
        var dark = 0L
        var light = 0L
        compose.setContent {
            MaunedasTheme(darkTheme = true) { dark = androidx.compose.material3.MaterialTheme.colorScheme.primary.value.toLong() }
            MaunedasTheme(darkTheme = false) { light = androidx.compose.material3.MaterialTheme.colorScheme.primary.value.toLong() }
        }
        compose.waitForIdle()
        assertEquals(androidx.compose.ui.graphics.Color(Tokens.ColorDark.primary).value.toLong(), dark)
        assertEquals(androidx.compose.ui.graphics.Color(Tokens.ColorLight.primary).value.toLong(), light)
    }
}
