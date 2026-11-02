package com.maubautista.maunedas.feature.tracking

import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.AlertEventItem
import com.maubautista.maunedas.core.data.AlertRuleItem
import com.maubautista.maunedas.core.data.AlertScope
import com.maubautista.maunedas.core.data.AlertType
import com.maubautista.maunedas.core.data.VariantOption
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** S-22 and S-23 on a 360 × 800 dp phone. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AlertsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 100_000_000L

    private fun rule(
        id: String,
        type: AlertType,
        o: AlertRuleItem.() -> AlertRuleItem = { this },
    ) = AlertRuleItem(id, "v1", "p1", "Leche Lala Entera · 1 L", null, null, type, 2_500, null, AlertScope.VARIANT_WEB, 24, true).o()

    @Test
    fun rulesSayWhatTheyWatch() {
        val done = mutableListOf<String>()
        compose.setContent {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    AlertsScreen(
                        AlertsState(
                            loading = false,
                            rules =
                                listOf(
                                    rule("r1", AlertType.BELOW_PRICE),
                                    rule("r2", AlertType.DROP_PCT) { copy(thresholdPct = 12.5, listingId = "l1", storeName = "Costco", active = false, cooldownHours = 0) },
                                ),
                        ),
                        now,
                        AlertsActions(onEdit = { done += "edit:${it.id}" }, onToggle = { done += "toggle:${it.id}" }, onRemove = { done += "remove:${it.id}" }, onOpenProduct = { done += "product:$it" }),
                    )
                }
            }
        }
        compose.onNodeWithText("Si baja a $25.00 o menos").assertExists()
        compose.onNodeWithText("Cualquier tienda que sigas · Silencio de 24 h").assertExists()
        compose.onNodeWithText("Si baja 12.5 % o más de una revisión a otra").assertExists()
        compose.onNodeWithText("Solo Costco · En pausa").assertExists()
        compose.onNodeWithText("Activar").performClick()
        compose.onNodeWithText("Pausar").performClick()
        compose.onAllNodes(hasText("Editar"))[0].performClick()
        compose.onAllNodes(hasText("Quitar"))[1].performClick()
        compose.onAllNodes(hasText("Leche Lala Entera · 1 L"))[0].performClick()
        assertEquals(listOf("toggle:r2", "toggle:r1", "edit:r1", "remove:r2", "product:p1"), done)
    }

    @Test
    fun historySaysWhenAndHowItWasDelivered() {
        val opened = mutableListOf<String>()
        compose.setContent {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    AlertsScreen(
                        AlertsState(
                            loading = false,
                            events =
                                listOf(
                                    AlertEventItem("e1", now - 2 * 3_600_000, "Leche bajó a $24.90", "En Costco. Tu objetivo: $25.00.", "sent", "v1", "p1"),
                                    AlertEventItem("e2", now - 5 * 60_000, "Otro aviso", "Sin regla", "no_devices", null, null),
                                ),
                        ),
                        now,
                        AlertsActions(onOpenProduct = { opened += it }),
                    )
                }
            }
        }
        compose.onNodeWithText("Todavía no tienes alertas.").assertExists()
        compose.onNodeWithText("Leche bajó a $24.90").performScrollTo().assertExists()
        compose.onNodeWithText("hace 2 h · Notificación enviada").performScrollTo().assertExists()
        compose.onNodeWithText("hace 5 min · Sin teléfono registrado").performScrollTo().assertExists()
        compose.onNodeWithText("Ver producto").performScrollTo().performClick()
        assertEquals(listOf("p1"), opened)
    }

    @Test
    fun theEditorShowsTheFieldsOfEachType() {
        var form by mutableStateOf(RuleFormState(variant = VariantOption("v1", "Leche Lala Entera · 1 L", null), stores = listOf("l1" to "Costco")))
        compose.setContent {
            MaunedasTheme {
                Surface(Modifier.width(360.dp)) {
                    RuleEditor(form, RuleEditorActions(onChange = { change -> form = change(form) }))
                }
            }
        }
        compose.onNodeWithText("Precio objetivo").assertExists()
        compose.onNodeWithText("Baja un porcentaje").performClick()
        compose.onNodeWithText("Porcentaje de baja").assertExists()
        compose.onNodeWithText("Precio más bajo registrado").performClick()
        compose.onNodeWithText("Entre todos los precios: compras, anaquel y en línea").performScrollTo().performClick()
        compose.onNodeWithText("Solo Costco").performScrollTo().performClick()
        assertEquals(listOf(AlertType.NEW_LOW, AlertScope.VARIANT_ALL, "l1"), listOf(form.type, form.scope, form.listingId))
        compose.onNodeWithText("Solo Costco").assertIsSelected()
        form = form.copy(problem = R.string.alerts_problem_cooldown)
        compose.onNodeWithText("El silencio va de 0 a 720 horas.").performScrollTo().assertExists()
        // A saved rule keeps its variant.
        compose.onNodeWithText("Cambiar").assertExists()
        form = form.copy(variantLocked = true)
        compose.waitForIdle()
        compose.onNodeWithText("Cambiar").assertDoesNotExist()
    }
}
