package com.maubautista.maunedas.feature.purchases

import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.data.ReceiptPage
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReceiptSectionTest {
    @get:Rule
    val compose = createComposeRule()

    private fun show(
        pages: List<ReceiptPage>,
        calls: MutableList<String>,
    ) = compose.setContent {
        MaunedasTheme {
            Surface(Modifier.width(360.dp)) {
                PurchaseEditorScreen(
                    EditorState(loading = false, draft = PurchaseDraft(id = "p", storeId = "s", purchasedAt = 0)),
                    emptyList(),
                    emptyList(),
                    "Puebla",
                    0,
                    EditorActions(onReceipt = { calls += "receipt" }, onRemoveReceiptPage = { calls += "remove:$it" }),
                    pages,
                )
            }
        }
    }

    @Test
    fun thePagesShowWithAWayToTakeEachAway() {
        val calls = mutableListOf<String>()
        show(listOf(ReceiptPage("i1", null), ReceiptPage("i2", null)), calls)
        compose.onNodeWithText("Ticket: 2 páginas").performScrollTo().assertExists()
        compose.onNodeWithContentDescription("Quitar la página 2 del ticket").performScrollTo().performClick()
        compose.onNodeWithText("Agregar página del ticket").performScrollTo().performClick()
        assertEquals(listOf("remove:i2", "receipt"), calls)
    }

    @Test
    fun withoutPagesItIsFotoDeTicketAndFourIsTheMost() {
        val calls = mutableListOf<String>()
        show(emptyList(), calls)
        compose.onNodeWithText("Foto de ticket").performScrollTo().performClick()
        assertEquals(listOf("receipt"), calls)
        compose.onNodeWithText("Ticket:", substring = true).assertDoesNotExist()
    }

    @Test
    fun aFullReceiptTakesNoMorePages() {
        show((1..4).map { ReceiptPage("i$it", null) }, mutableListOf())
        compose.onNodeWithText("Agregar página del ticket").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("El ticket ya tiene 4 páginas, el máximo.").performScrollTo().assertExists()
    }
}
