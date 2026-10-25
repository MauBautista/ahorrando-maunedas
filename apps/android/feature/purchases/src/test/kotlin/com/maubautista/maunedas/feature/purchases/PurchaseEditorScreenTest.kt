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
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.LinePromotion
import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.data.PurchaseLine
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.data.TicketDiscount
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
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
class PurchaseEditorScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()
    private val shampoo = LineVariant("v1", "p1", "Shampoo Herbal", "400 ml", "Herbal", Measure.VOLUME, 400.0, 1, false, DisplayUnit.L)
    private val stores = listOf(StoreChoice("s", "Soriana"), StoreChoice("c", "Costco"))

    private val draft =
        PurchaseDraft(
            id = "p",
            storeId = "s",
            branchId = "b",
            purchasedAt = Instant.parse("2026-10-22T16:30:00Z").toEpochMilli(),
            lines =
                listOf(
                    PurchaseLine("l1", shampoo, null, 2.0, 8_900, LinePromotion(type = PromoType.NXM, params = PromoParams(n = 2.0, m = 1.0), discountCents = 8_900)),
                    PurchaseLine("l2", null, "LCH LALA ENT 1L", 1.0, 2_850),
                ),
            ticketDiscounts = listOf(TicketDiscount("d", "Cupón app", 500)),
            ticketTotalCents = 11_400,
        )

    @Before
    fun twentyFourHourClock() {
        Settings.System.putString(ApplicationProvider.getApplicationContext<Context>().contentResolver, Settings.System.TIME_12_24, "24")
    }

    private fun show(
        state: EditorState = EditorState(loading = false, draft = draft),
        actions: EditorActions = EditorActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { PurchaseEditorScreen(state, stores, listOf(BranchChoice("b", "Centro", "Puebla")), "Puebla", now, actions) } }
        }
    }

    private fun scrollTo(text: String) = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.ScrollToIndex)).performScrollToNode(hasText(text, substring = true))

    @Test
    fun linesAndTotalsAreShownWithTheDifference() {
        show()
        for (text in listOf(
            "Soriana",
            "Sucursal: Centro",
            "Fecha: 22 oct",
            "Hora: 10:30",
            "Shampoo Herbal · 400 ml",
            "2 × $89.00",
            "2x1, 3x2…",
            "$111.25/L",
            "Sin vincular: LCH LALA ENT 1L",
            "Cupón app: −$5.00",
            "No cuadra por $1.50",
            "Eliminar compra",
        )) {
            scrollTo(text)
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun actionsReachTheViewModel() {
        val calls = mutableListOf<String>()
        show(
            actions =
                EditorActions(
                    onConfirm = { calls += "confirm" },
                    onSaveDraft = { calls += "draft" },
                    onNewLine = { calls += "line" },
                    onEditLine = { calls += "edit:$it" },
                    onRemoveLine = { calls += "remove:$it" },
                    onNewDiscount = { calls += "discount" },
                ),
        )
        compose.onNodeWithText("Confirmar").performClick()
        compose.onNodeWithText("Guardar borrador").performClick()
        compose.onNodeWithText("Shampoo Herbal · 400 ml", useUnmergedTree = true).performClick()
        compose.onNodeWithContentDescription("Quitar Shampoo Herbal · 400 ml").performClick()
        scrollTo("+ Producto")
        compose.onNodeWithText("+ Producto").performClick()
        scrollTo("+ Descuento del ticket")
        compose.onNodeWithText("+ Descuento del ticket").performClick()
        assertEquals(listOf("confirm", "draft", "edit:0", "remove:0", "line", "discount"), calls)
    }

    @Test
    fun aNewPurchaseHasNoDeleteAndAMismatchAsksBeforeConfirming() {
        show(EditorState(loading = false, draft = draft.copy(id = null), mismatchCents = 150))
        compose.onNodeWithText("Nueva compra").assertExists()
        compose.onNodeWithText("El total no cuadra por $1.50. ¿Confirmar de todos modos?").assertExists()
        compose.onNodeWithText("Eliminar compra").assertDoesNotExist()
    }

    @Test
    fun aTicketLineWithoutAProductOffersVincular() {
        val calls = mutableListOf<String>()
        show(actions = EditorActions(onEditLine = { calls += "edit:$it" }))
        scrollTo("Vincular")
        compose.onNodeWithText("Vincular").performClick()
        assertEquals(listOf("edit:1"), calls)
    }

    @Test
    fun linkingSaysWhatTheTicketRead() {
        compose.setContent { MaunedasTheme { LineSheet(LineForm.of(draft.lines[1]), {}, {}, {}, {}) } }
        compose.onNodeWithText("En el ticket: LCH LALA ENT 1L").assertExists()
        compose.onNodeWithText("Buscar", substring = true).assertExists()
    }

    @Test
    fun linesMoveWithOrdenarAndWithTalkBack() {
        val moves = mutableListOf<String>()
        show(actions = EditorActions(onMoveLine = { i, d -> moves += "$i:$d" }))
        // TalkBack: the first line can only go down, the last only up.
        fun actionsOf(text: String) =
            compose.onNode(hasText(text, substring = true) and SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)).fetchSemanticsNode().config[SemanticsActions.CustomActions]
        assertEquals(listOf("Bajar"), actionsOf("Shampoo Herbal · 400 ml").map { it.label })
        assertEquals(listOf("Subir"), actionsOf("LCH LALA ENT 1L").map { it.label })
        actionsOf("LCH LALA ENT 1L").single().action()
        // "Ordenar" puts the arrows where the remove button was.
        compose.onNodeWithText("Ordenar").performClick()
        compose.onNodeWithContentDescription("Quitar Shampoo Herbal · 400 ml").assertDoesNotExist()
        compose.onNodeWithContentDescription("Subir Shampoo Herbal · 400 ml").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Bajar Shampoo Herbal · 400 ml").performClick()
        compose.onNodeWithText("Listo").performClick()
        compose.onNodeWithContentDescription("Quitar Shampoo Herbal · 400 ml").assertExists()
        assertEquals(listOf("1:-1", "0:1"), moves)
    }

    @Test
    fun theLineSheetShowsLastPricesPromotionFieldsAndTheLiveTotal() {
        val picked = mutableListOf<String>()
        compose.setContent {
            MaunedasTheme {
                LineSheet(
                    form = LineForm(query = "sham", results = listOf(VariantChoice(shampoo, 8_900))),
                    onChange = { picked += "change" },
                    onQuery = {},
                    onSave = {},
                    onDismiss = {},
                )
            }
        }
        compose.onNodeWithText("Último aquí: $89.00", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Shampoo Herbal · 400 ml", useUnmergedTree = true).performClick()
        assertEquals(listOf("change"), picked)
    }

    @Test
    fun aChosenPromotionShowsItsFieldsAndDiscount() {
        val form = LineForm(variant = shampoo, quantity = 2.0, unitPriceCents = 8_900).withPromo(PromoType.NXM).withParams { it.copy(n = 2.0, m = 1.0) }
        compose.setContent { MaunedasTheme { LineSheet(form, {}, {}, {}, {}) } }
        for (text in listOf("Llevas", "Pagas", "Descuento: $89.00", "Total de la línea: $89.00", "Precio efectivo: $111.25/L")) {
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
        // The stepper is read by name, not as symbols.
        compose.onNodeWithContentDescription("Una menos").assertExists()
        compose.onNodeWithContentDescription("Una más").assertExists()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of the editor is cut. */
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
    }
}

/** As in the other screen tests: height, line limit, ellipsis or narrower than the text itself. */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
