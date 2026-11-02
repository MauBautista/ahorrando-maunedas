package com.maubautista.maunedas.feature.tracking

import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.ResolvedLink
import com.maubautista.maunedas.core.data.VariantOption
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** S-21 on a 360 × 800 dp phone. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AddListingScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val link = ResolvedLink("costco_mx", "s-costco", "Costco", "https://www.costco.com.mx/p/1?x=1", "https://www.costco.com.mx/p/1", "1", null)
    private val milk = VariantOption("v1", "Leche Lala Entera · 1 L", "Lala")

    private fun show(
        state: AddListingState,
        actions: AddListingActions = AddListingActions(),
    ) = compose.setContent { MaunedasTheme { Surface(Modifier.width(360.dp)) { AddListingScreen(state, actions) } } }

    @Test
    fun saysWhyALinkCannotBeFollowed() {
        show(AddListingState(text = "https://www.walmart.com.mx/ip/x/1", problem = R.string.add_reason_not_tracked))
        compose.onNodeWithText("Ese enlace no se puede seguir", substring = true).assertExists()
        compose.onNodeWithText("Continuar").assertIsEnabled()
    }

    @Test
    fun waitsForALinkAndWhileResolving() {
        show(AddListingState(text = "", problemText = "Error inesperado"))
        compose.onNodeWithText("Continuar").assertIsNotEnabled()
        compose.onNodeWithText("Error inesperado").assertExists()
    }

    @Test
    fun choosesTheVariantAndFollows() {
        val done = mutableListOf<String>()
        show(
            AddListingState(link = link, query = "lala", results = listOf(milk), searched = true),
            AddListingActions(onChoose = { done += "choose:${it.id}" }, onOtherLink = { done += "other" }),
        )
        compose.onNodeWithText("Costco").assertExists()
        compose.onNodeWithText("https://www.costco.com.mx/p/1").assertExists()
        compose.onNodeWithText("Seguir precio").assertIsNotEnabled()
        compose.onNodeWithText("Leche Lala Entera · 1 L · Lala").performClick()
        compose.onNodeWithText("Otro enlace").performClick()
        assertEquals(listOf("choose:v1", "other"), done)
    }

    @Test
    fun aChosenVariantCanBeSaved() {
        var saved = 0
        show(AddListingState(link = link.copy(storeName = null), variant = milk), AddListingActions(onSave = { saved++ }))
        compose.onNodeWithText("Tienda en línea").assertExists()
        compose.onNodeWithText("Cambiar").assertExists()
        compose.onNodeWithText("Seguir precio").assertIsEnabled().performClick()
        assertEquals(1, saved)
    }

    @Test
    fun aLinkAlreadyFollowedCannotBeFollowedAgain() {
        show(AddListingState(link = link.copy(followedBy = "Leche Lala Entera · 1 L"), variant = milk))
        compose.onNodeWithText("Ese enlace ya está en seguimiento para Leche Lala Entera · 1 L.").assertExists()
        compose.onNodeWithText("Seguir precio").assertIsNotEnabled()
    }
}
