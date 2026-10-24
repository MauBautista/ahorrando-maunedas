package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.CategoryNode
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.data.VariantSummary
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.model.Measure
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
class EditorScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val categories = listOf(CategoryNode("refri", "Refrigerados", 0), CategoryNode("lacteos", "Lácteos", 1))
    private val tags = listOf(TagItem("t1", "Básicos"))
    private val newProduct = ProductEditorState(loading = false, product = ProductForm().followingMeasure(Measure.VOLUME), firstVariant = VariantForm())
    private val existing = ProductEditorState(loading = false, product = ProductForm(id = "p1", name = "Leche Lala", unitChosen = true))

    /** The real form logic behind the screen, as the view model applies it. */
    private fun showProduct(
        initial: ProductEditorState,
        isAdmin: Boolean = false,
        fontScale: Float = 1f,
        calls: MutableList<String> = mutableListOf(),
    ) = compose.setContent {
        var state by remember { mutableStateOf(initial) }
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    ProductEditorScreen(
                        state = state,
                        categories = categories,
                        tags = tags,
                        variants = listOf(VariantSummary("v1", "1 L")),
                        isAdmin = isAdmin,
                        actions =
                            ProductEditorActions(
                                onProduct = { change -> state = state.copy(product = change(state.product)) },
                                onFirstVariant = { change ->
                                    val v = change(state.firstVariant!!)
                                    state = state.copy(firstVariant = v, product = state.product.followingMeasure(v.measure))
                                },
                                onOpenVariant = { calls += "variant:$it" },
                                onSave = { calls += "save" },
                                onAskDelete = { calls += "delete" },
                            ),
                    )
                }
            }
        }
    }

    @Test
    fun aNewProductAsksForItsFirstVariantAndSuggestsItsLabel() {
        showProduct(newProduct)
        compose.onNodeWithText("Primera presentación").assertExists()
        compose.onNodeWithText("Unidades en el paquete").performScrollTo().performTextReplacement("6")
        compose.onNodeWithText("Cantidad por unidad").performScrollTo().performTextReplacement("1")
        compose.onNodeWithText("6 × 1 L").performScrollTo().assertExists()
        // Mass suggests comparing per kilo.
        compose.onNodeWithText("Masa").performScrollTo().performClick()
        compose.onNodeWithText("Se vende a granel (por kilo)").performScrollTo().performClick()
        compose.onNodeWithText("A granel (kg)").performScrollTo().assertExists()
        compose.onNodeWithText("Cantidad por unidad").assertDoesNotExist()
        compose.onNodeWithText("Eliminar producto").assertDoesNotExist()
    }

    @Test
    fun onlyAnAdminSeesDeleteAndVariantsOpenTheirEditor() {
        val calls = mutableListOf<String>()
        showProduct(existing, isAdmin = false, calls = calls)
        compose.onNodeWithText("Eliminar producto").assertDoesNotExist()
        compose.onNodeWithText("1 L").performScrollTo().performClick()
        compose.onNodeWithText("Agregar presentación").performScrollTo().performClick()
        assertEquals(listOf("variant:v1", "variant:null"), calls)
    }

    @Test
    fun anAdminCanAskToDelete() {
        val calls = mutableListOf<String>()
        showProduct(existing, isAdmin = true, calls = calls)
        compose.onNodeWithText("Eliminar producto").performScrollTo().performClick()
        assertEquals(listOf("delete"), calls)
    }

    @Test
    fun theCategoryComesFromTheTreeAndTagsCanBeTyped() {
        showProduct(existing)
        compose.onNodeWithText("Sin categoría").performScrollTo().performClick()
        compose.onNodeWithText("Lácteos").performClick()
        compose.onNodeWithText("Lácteos").performScrollTo().assertExists()
        compose.onNodeWithText("Nueva etiqueta").performScrollTo().performTextInput("Oferta")
        compose.onNodeWithText("Agregar").performScrollTo().performClick()
        compose.onNodeWithText("Oferta").performScrollTo().assertExists()
    }

    @Test
    fun aCodeOfAnotherProductSaysWhose() {
        val taken = newProduct.copy(firstVariant = VariantForm(codeInput = "7501020515350").withCodeProblem(R.string.editor_code_taken, "Leche Lala · 1 L"))
        showProduct(taken)
        compose.onNodeWithText("Ese código ya es de «Leche Lala · 1 L».").performScrollTo().assertExists()
    }

    @Test
    fun theVariantEditorHidesDeleteFromMembers() {
        val state = VariantEditorState(loading = false, variant = VariantForm.of(com.maubautista.maunedas.core.data.VariantDraft("v1", "1 L", Measure.VOLUME, 1000.0, 1, false, listOf("7501020515343"))))
        compose.setContent { MaunedasTheme { VariantEditorScreen(state, isAdmin = false, actions = VariantEditorActions()) } }
        compose.onNodeWithText("Editar presentación").assertExists()
        compose.onNodeWithText("7501020515343").performScrollTo().assertExists()
        compose.onNodeWithText("Eliminar presentación").assertDoesNotExist()
        // T56: codes can be read with the camera too.
        compose.onNodeWithText("Escanear código").performScrollTo().assertExists()
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of the new-product form is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        showProduct(newProduct.copy(product = newProduct.product.copy(tagIds = setOf("t1"))), fontScale = 2f)
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 15)
        val cut =
            texts.mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
                layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: node.config.getOrNull(SemanticsProperties.EditableText)?.text }
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
