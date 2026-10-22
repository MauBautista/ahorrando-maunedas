package com.maubautista.maunedas.feature.home

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
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.Spacing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant
import java.time.YearMonth

/** A 360 × 800 dp phone with native graphics, as in the design system tests (T-106). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class HomeScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    private val busy =
        HomeUiState(
            loaded = true,
            displayName = "Mauricio",
            month = YearMonth.of(2026, 10),
            monthSpentCents = 123_450,
            recent =
                listOf(
                    PurchaseSummary("p1", "Soriana", "Centro", at("2026-10-22T16:30:00Z"), 23_000, 3, draft = true),
                    PurchaseSummary("p2", null, null, at("2026-10-20T20:00:00Z"), 15_990, 1, draft = false),
                ),
            openDrafts = 1,
            pending = 3,
            rejected = 2,
            now = at("2026-10-22T18:00:00Z"),
        )

    private fun show(
        state: HomeUiState,
        actions: HomeActions = HomeActions(),
        fontScale: Float = 1f,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { HomeScreen(state, actions) } }
        }
    }

    /** The phone's 12/24-hour setting reaches the dates. */
    private fun phoneClock(value: String) =
        Settings.System.putString(ApplicationProvider.getApplicationContext<Context>().contentResolver, Settings.System.TIME_12_24, value)

    @Test
    fun showsTheMonthTheRecentPurchasesAndWhatNeedsAttention() {
        phoneClock("24")
        show(busy)
        for (text in listOf(
            "Hola, Mauricio",
            "3 cambios por subir",
            "Tienes 1 compra en borrador.",
            "El servidor rechazó 2 cambios. Revísalos en Ajustes.",
            "Gasto de octubre",
            "$1,234.50",
            "Soriana · Centro",
            "Hoy, 10:30 · 3 productos",
            "$230.00",
            "Borrador",
            "Tienda sin sincronizar",
            "mar 20 oct · 1 producto",
        )) {
            compose.onNodeWithText(text).performScrollTo().assertExists()
        }
    }

    @Test
    fun datesFollowTheTwelveHourClockOfThePhone() {
        phoneClock("12")
        show(busy)
        compose.onNodeWithText("Hoy, 10:30 a.m. · 3 productos").performScrollTo().assertExists()
    }

    @Test
    fun aQuietHomeHasNoNoticesAndTheEmptyStateOnlyOnceLoaded() {
        val quiet = HomeUiState(loaded = false, displayName = "Pepe", month = YearMonth.of(2026, 10), now = busy.now)
        show(quiet)
        compose.onNodeWithText("Gasto de octubre").assertExists()
        compose.onNodeWithText("$0.00").assertExists()
        for (absent in listOf("Aún no hay compras", "por subir", "borrador", "rechazó")) {
            compose.onNodeWithText(absent, substring = true).assertDoesNotExist()
        }
    }

    @Test
    fun anEmptyLoadedHomeInvitesToTheFirstPurchase() {
        show(HomeUiState(loaded = true, displayName = "Pepe", month = YearMonth.of(2026, 10), now = busy.now))
        compose.onNodeWithText("Aún no hay compras. Toca Nueva compra para registrar la primera.").performScrollTo().assertExists()
    }

    @Test
    fun everyActionReachesItsCallback() {
        val calls = mutableListOf<String>()
        show(
            busy,
            HomeActions(
                newPurchase = { calls += "new" },
                receiptPhoto = { calls += "receipt" },
                shelfPrice = { calls += "shelf" },
                scan = { calls += "scan" },
                openPurchase = { calls += "open:$it" },
                openDrafts = { calls += "drafts" },
                openRejected = { calls += "rejected" },
            ),
        )
        for (text in listOf("Nueva compra", "Foto de ticket", "Precio de anaquel", "Escanear", "Tienes 1 compra en borrador.", "El servidor rechazó 2 cambios. Revísalos en Ajustes.", "Soriana · Centro")) {
            compose.onNodeWithText(text).performScrollTo().performClick()
        }
        assertEquals(listOf("new", "receipt", "shelf", "scan", "drafts", "rejected", "open:p1"), calls)
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text is cut and the actions stay ≥ 48 dp. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(busy, fontScale = 2f)
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult)).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 12)
        val cut =
            texts.mapNotNull { node ->
                val layouts = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
                layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
            }
        assertEquals("textos cortados al 200 %", emptyList<String>(), cut)
        for (label in listOf("Nueva compra", "Precio de anaquel", "Tienes 1 compra en borrador.")) {
            compose.onNodeWithText(label).assertHeightIsAtLeast(Spacing.touchTarget)
        }
    }
}

/**
 * Whether part of the text is not shown: taller than its box, past its line limit, an ellipsis, or narrower than
 * the text itself. Not `hasVisualOverflow`: the semantics action lays the paragraph out at the full available
 * width, so any one-line text narrower than its row reports a width overflow that is not there.
 */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
