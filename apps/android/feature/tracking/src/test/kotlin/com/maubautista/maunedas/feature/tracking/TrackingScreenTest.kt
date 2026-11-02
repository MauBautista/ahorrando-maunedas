package com.maubautista.maunedas.feature.tracking

import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.AgentHealth
import com.maubautista.maunedas.core.data.BackupJob
import com.maubautista.maunedas.core.data.ListingHealth
import com.maubautista.maunedas.core.data.TrackedListing
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** S-20 on a 360 × 800 dp phone (T-106). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TrackingScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 10_000_000L

    private fun listing(
        health: ListingHealth = ListingHealth.OK,
        o: TrackedListing.() -> TrackedListing = { this },
    ) = TrackedListing(
        id = "l1", variantId = "v1", productId = "p1", productName = "Leche Lala Entera", variantLabel = "1 L", storeName = "Amazon",
        url = "https://www.amazon.com.mx/dp/B1", intervalMin = null, active = health != ListingHealth.PAUSED, health = health,
        lastCheckedAt = now - 2 * 3_600_000, priceCents = 2_899, listPriceCents = null, promoText = null, checkRequested = false,
    ).o()

    private fun show(
        state: TrackingState,
        actions: TrackingActions = TrackingActions(),
    ) = compose.setContent { MaunedasTheme { Surface(Modifier.width(360.dp)) { TrackingScreen(state, now, actions) } } }

    @Test
    fun aListingShowsItsPriceStateAndCheckAndActs() {
        val done = mutableListOf<String>()
        show(
            TrackingState(loading = false, listings = listOf(listing { copy(listPriceCents = 3_299, promoText = "2x1 en la segunda", intervalMin = 240) })),
            TrackingActions(
                onAdd = { done += "add" },
                onOpenProduct = { done += "product:$it" },
                onCheckNow = { done += "check:${it.id}" },
                onToggle = { done += "toggle:${it.id}" },
                onStop = { done += "stop:${it.id}" },
            ),
        )
        compose.onNodeWithText("Al día").assertExists()
        compose.onNodeWithText("$28.99").assertExists()
        compose.onNodeWithContentDescription("Antes $32.99").assertExists()
        compose.onNodeWithText("2x1 en la segunda").assertExists()
        compose.onNodeWithText("Revisado hace 2 h · Cada 4 h").assertExists()
        compose.onNodeWithText("Leche Lala Entera · 1 L").performClick()
        compose.onNodeWithText("Seguir un enlace").performClick()
        compose.onNodeWithText("Revisar ahora").assertIsEnabled().performClick()
        compose.onNodeWithText("Pausar").performClick()
        compose.onNodeWithText("Dejar de seguir").performClick()
        assertEquals(listOf("product:p1", "add", "check:l1", "toggle:l1", "stop:l1"), done)
    }

    @Test
    fun aPausedListingCannotBeCheckedAndSaysSo() {
        show(TrackingState(loading = false, listings = listOf(listing(ListingHealth.PAUSED) { copy(lastCheckedAt = null, priceCents = null) })))
        compose.onNodeWithText("En pausa").assertExists()
        compose.onNodeWithText("Aún no se revisa").assertExists()
        compose.onNodeWithText("No se revisa hasta que lo reanudes.").assertExists()
        compose.onNodeWithText("Revisar ahora").assertIsNotEnabled()
        compose.onNodeWithText("Reanudar").assertExists()
    }

    @Test
    fun aBlockedListingWithACheckAskedWaits() {
        show(TrackingState(loading = false, listings = listOf(listing(ListingHealth.BLOCKED) { copy(checkRequested = true) })))
        compose.onNodeWithText("Bloqueado").assertExists()
        compose.onNodeWithText("Revisado hace 2 h · Revisión solicitada").assertExists()
        compose.onNodeWithText("La tienda está bloqueando las revisiones; se reintentará más tarde.").assertExists()
        compose.onNodeWithText("Revisar ahora").assertIsNotEnabled()
    }

    @Test
    fun outOfStockKeepsTheLastPriceSeen() {
        show(TrackingState(loading = false, listings = listOf(listing(ListingHealth.OUT_OF_STOCK) { copy(intervalMin = 90) })))
        compose.onNodeWithText("Agotado").assertExists()
        compose.onNodeWithText("Último precio visto").assertExists()
        compose.onNodeWithText("Revisado hace 2 h · Cada 90 min").assertExists()
    }

    @Test
    fun saysWhenTheHomeServerStoppedReporting() {
        val stale = AgentHealth(now - 3 * 3_600_000, "0.1.0", 0, 0, emptyList(), null, BackupJob(null, null, null, null), BackupJob(null, null, null, null), BackupJob(null, null, null, null))
        show(TrackingState(loading = false, listings = listOf(listing()), agent = stale))
        compose.onNodeWithText("El servidor casero no se reporta desde hace 3 h: los precios en línea están en pausa.").assertExists()
    }

    @Test
    fun aRecentReportSaysNothing() {
        val fresh = AgentHealth(now - 20 * 60_000, "0.1.0", 0, 0, emptyList(), null, BackupJob(null, null, null, null), BackupJob(null, null, null, null), BackupJob(null, null, null, null))
        show(TrackingState(loading = false, listings = listOf(listing()), agent = fresh))
        compose.onNodeWithText("El servidor casero no se reporta", substring = true).assertDoesNotExist()
    }

    @Test
    fun emptyForOneVariantWithBack() {
        var back = 0
        show(TrackingState(loading = false, variantName = "Atún Dolores · 140 g", variantId = "v2"), TrackingActions(onBack = { back++ }))
        compose.onNodeWithText("Solo Atún Dolores · 140 g").assertExists()
        compose.onNodeWithText("Aún no sigues ningún precio en línea", substring = true).assertExists()
        compose.onNodeWithContentDescription("Atrás").performClick()
        assertEquals(1, back)
    }
}
