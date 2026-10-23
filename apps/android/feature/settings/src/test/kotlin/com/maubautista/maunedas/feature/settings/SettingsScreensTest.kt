package com.maubautista.maunedas.feature.settings

import android.content.Context
import android.provider.Settings
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.auth.SessionUser
import com.maubautista.maunedas.core.data.BarcodeConflict
import com.maubautista.maunedas.core.data.PendingTable
import com.maubautista.maunedas.core.data.RejectedChange
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.sync.SyncStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant

/** A 360 × 800 dp phone with native graphics, as in the design system tests (T-106). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h800dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SettingsScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-23T18:00:00Z").toEpochMilli()
    private val user = SessionUser("u", "mau", "Mauricio", "admin", true)
    private val rejected =
        listOf(
            RejectedChange(1, "variants", "v", "VALIDATION", "MEASURE_LOCKED", now - 60_000, "Leche Lala · 1 L"),
            RejectedChange(2, "pending_uploads", "img/original.jpg", "LOCAL_FILE_MISSING", null, now - 120_000, null),
            RejectedChange(3, "products", "p", "FORBIDDEN", "SOMETHING_NEW", now - 180_000, "Café"),
        )

    @Before
    fun twentyFourHourClock() {
        Settings.System.putString(ApplicationProvider.getApplicationContext<Context>().contentResolver, Settings.System.TIME_12_24, "24")
    }

    private fun show(
        fontScale: Float = 1f,
        content: @Composable () -> Unit,
    ) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
            MaunedasTheme { Surface(Modifier.width(360.dp)) { content() } }
        }
    }

    @Test
    fun settingsShowTheAccountSyncStorageAndVersion() {
        val calls = mutableListOf<String>()
        show {
            SettingsScreen(
                user, SyncStatus.Synced(now), 3, 2_500_000, "0.1.0-dev", 1,
                SettingsActions({ calls += "password" }, { calls += "sync" }, { calls += "now" }, { calls += "free" }, { calls += "out" }),
            )
        }
        for (text in listOf("Mauricio · usuario mau", "Sincronizado a las 12:00", "3 cambios por subir", "Versión 0.1.0-dev · esquema 1")) {
            compose.onNodeWithText(text).performScrollTo().assertExists()
        }
        compose.onNodeWithText("Fotos guardadas en el teléfono", substring = true).performScrollTo().assertExists()
        for (button in listOf("Cambiar contraseña", "Ver detalle y cambios rechazados", "Sincronizar ahora", "Cerrar sesión")) compose.onNodeWithText(button).performScrollTo().performClick()
        compose.onNodeWithText("Liberar espacio").performScrollTo().performClick()
        // It asks first: the photos that are already uploaded leave the phone.
        compose.onNodeWithText("Se borran del teléfono", substring = true).assertExists()
        compose.onNode(hasText("Liberar espacio") and hasAnyAncestor(isDialog())).performClick()
        assertEquals(listOf("password", "sync", "now", "out", "free"), calls)
    }

    @Test
    fun aNewPasswordNeedsEightCharactersTypedTwice() {
        assertEquals(R.string.settings_password_short, PasswordForm(current = "x", new = "corta", repeat = "corta").problem())
        assertEquals(R.string.settings_password_mismatch, PasswordForm(current = "x", new = "suficiente", repeat = "suficientE").problem())
        assertEquals(null, PasswordForm(current = "x", new = "suficiente", repeat = "suficiente").problem())
    }

    @Test
    fun theSyncScreenNamesPendingTablesAndWhyChangesWereRefused() {
        val dismissed = mutableListOf<Long>()
        show {
            SyncStatusScreen(
                SyncStatus.Synced(now - 3_600_000), listOf(PendingTable("purchase_items", 2), PendingTable("purchases", 1)), 1, rejected, now,
                onBack = {}, onSyncNow = {}, onDismiss = { dismissed += it },
            )
        }
        for (text in listOf(
            "Última sincronización: Hoy, 11:00",
            "Producto de una compra: 2",
            "Compra: 1",
            "Fotos por subir: 1",
            "Presentación: Leche Lala · 1 L · la medida no se puede cambiar porque ya tiene compras",
            "Foto · la foto ya no está en el teléfono",
            "Producto: Café · rechazado (SOMETHING_NEW)",
        )) {
            compose.onNodeWithText(text).performScrollTo().assertExists()
        }
        compose.onAllNodes(hasText("Entendido"))[0].performClick()
        assertEquals(listOf(1L), dismissed)
    }

    @Test
    fun theBarcodeDialogOffersBothWays() {
        val calls = mutableListOf<String>()
        val conflict = BarcodeConflict(1, "b", "7501020515343", "mine", "Leche Lala · 1 L", "theirs", null)
        show { BarcodeConflictDialog(conflict, onUseTheirs = { calls += "theirs" }, onKeepSeparate = { calls += "keep" }) }
        compose.onNodeWithText("El código 7501020515343 ya pertenece a «otra presentación». Lo agregaste a «Leche Lala · 1 L».").assertExists()
        compose.onNodeWithText("Usar esa presentación").performClick()
        compose.onNodeWithText("Mantener separado").performClick()
        assertEquals(listOf("theirs", "keep"), calls)
    }

    /** RNF-08 (05 §7): at 200 % font scale on a 360 dp phone no text of either screen is cut. */
    @Test
    fun atTwiceTheFontSizeNothingIsCut() {
        show(fontScale = 2f) { SettingsScreen(user, SyncStatus.Failed(now, "NETWORK"), 12, 2_500_000, "0.1.0-dev", 1, SettingsActions()) }
        assertEquals("textos cortados al 200 % (Ajustes)", emptyList<String>(), cutTexts())
    }

    @Test
    fun theSyncScreenAtTwiceTheFontSize() {
        show(fontScale = 2f) { SyncStatusScreen(SyncStatus.Synced(now), listOf(PendingTable("purchase_items", 2)), 1, rejected, now, {}, {}, {}) }
        assertEquals("textos cortados al 200 % (Sincronización)", emptyList<String>(), cutTexts())
    }

    private fun cutTexts(): List<String?> {
        val texts = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("se renderizaron textos", texts.size >= 5)
        return texts.mapNotNull { node ->
            val layouts = mutableListOf<TextLayoutResult>()
            node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
            layouts.firstOrNull()?.takeIf { it.isCut() }?.let { node.config.getOrNull(SemanticsProperties.Text)?.joinToString() }
        }
    }
}

/** As in the other screen tests: height, line limit, ellipsis or narrower than the text itself. */
private fun TextLayoutResult.isCut(): Boolean =
    didOverflowHeight ||
        multiParagraph.didExceedMaxLines ||
        (0 until lineCount).any { isLineEllipsized(it) } ||
        size.width + 1 < minOf(multiParagraph.intrinsics.maxIntrinsicWidth, multiParagraph.width)
