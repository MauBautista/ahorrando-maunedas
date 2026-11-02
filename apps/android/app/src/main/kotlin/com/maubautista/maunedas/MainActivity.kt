package com.maubautista.maunedas

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.maubautista.maunedas.core.auth.AuthService
import com.maubautista.maunedas.core.data.AlertsRepository
import com.maubautista.maunedas.core.data.CatalogGuess
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.feature.auth.LoginRoute
import com.maubautista.maunedas.feature.catalog.ProductEditorRoute
import com.maubautista.maunedas.feature.catalog.ProductPageRoute
import com.maubautista.maunedas.feature.catalog.VariantEditorRoute
import com.maubautista.maunedas.feature.purchases.PurchaseEditorRoute
import com.maubautista.maunedas.feature.scan.ScanActions
import com.maubautista.maunedas.feature.scan.ScanCodeRoute
import com.maubautista.maunedas.feature.settings.SyncStatusRoute
import com.maubautista.maunedas.feature.shelf.ShelfRoute
import com.maubautista.maunedas.feature.tracking.AddListingRoute
import com.maubautista.maunedas.feature.tracking.AlertsRoute
import com.maubautista.maunedas.feature.tracking.TrackingRoute
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
object LoginDestination

/** Signed in: the bottom-bar screens ([MainShell]). */
@Serializable
object MainDestination

/** S-08, the product page; catalog cards open it. */
@Serializable
data class ProductDestination(
    val productId: String,
)

/**
 * S-09; null [productId] creates one. The scanner (S-12) prefills a new product: [code], and from an open catalog
 * [name], [brand], [measure], [unitAmount] (base units), [packCount] (texts, as routes carry them) and its photo
 * with its license (imported when the product is saved, T-117).
 */
@Serializable
data class ProductEditorDestination(
    val productId: String? = null,
    val code: String? = null,
    val name: String? = null,
    val brand: String? = null,
    val measure: String? = null,
    val unitAmount: String? = null,
    val packCount: String? = null,
    val imageUrl: String? = null,
    val imageLicense: String? = null,
    val imageAttribution: String? = null,
    val imageSourceUrl: String? = null,
)

/** S-13; [variantId] comes from the scanner (S-12), null from Inicio. */
@Serializable
data class ShelfPriceDestination(
    val variantId: String? = null,
)

/** S-12 for a code of a purchase's continuous scanning that is not in the catalog (T-122). */
@Serializable
data class ScanCodeDestination(
    val code: String,
)

/** S-16, sync state and "Cambios rechazados". */
@Serializable
object SyncDestination

/** S-20 for one variant: its product page's "Precios en línea". */
@Serializable
data class TrackingDestination(
    val variantId: String? = null,
)

/** S-22 and S-23 for one variant: its product page's "Alertas". */
@Serializable
data class AlertsDestination(
    val variantId: String? = null,
)

/** S-21; [text] is what another app shared (`ACTION_SEND`), [variantId] the variant it is for when known. */
@Serializable
data class AddListingDestination(
    val text: String? = null,
    val variantId: String? = null,
)

/**
 * S-04; null [purchaseId] starts a new purchase; [addVariantId] opens the line sheet with that variant (S-12);
 * [receipt] opens the document scanner once there is a store ("Foto de ticket" in Inicio, T-123).
 */
@Serializable
data class PurchaseEditorDestination(
    val purchaseId: String? = null,
    val addVariantId: String? = null,
    val receipt: Boolean = false,
)

/** S-10; null [variantId] adds a variant to the product, prefilled by the scanner as [ProductEditorDestination]. */
@Serializable
data class VariantEditorDestination(
    val productId: String,
    val variantId: String? = null,
    val code: String? = null,
    val measure: String? = null,
    val unitAmount: String? = null,
    val packCount: String? = null,
)

/**
 * Single activity (05 §4). With a saved session it opens at home without network (RF-AUTH-08). A link shared from a
 * store's app (`ACTION_SEND` text, T-220) opens "Seguir un enlace" once signed in.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var auth: AuthService

    @Inject lateinit var scheduler: SyncScheduler

    @Inject lateinit var alerts: AlertsRepository

    private val shared = MutableStateFlow<String?>(null)

    /** A price alert tapped (`maunedas://variant/{id}`, 08 §7). */
    private val linkedVariant = MutableStateFlow<String?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        sharedText(intent)?.let { shared.value = it }
        linkedVariantOf(intent)?.let { linkedVariant.value = it }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            shared.value = sharedText(intent)
            linkedVariant.value = linkedVariantOf(intent)
        }
        enableEdgeToEdge()
        setContent {
            MaunedasTheme {
                Surface(Modifier.fillMaxSize()) {
                    // Wait for the session to be read: no flash of the login screen for someone signed in.
                    var start by remember { mutableStateOf<Any?>(null) }
                    LaunchedEffect(Unit) { start = if (auth.isSignedIn()) MainDestination else LoginDestination }
                    start?.let { first ->
                        val nav = rememberNavController()
                        val share by shared.collectAsState()
                        LaunchedEffect(share) {
                            val text = share ?: return@LaunchedEffect
                            if (auth.isSignedIn()) {
                                shared.value = null
                                nav.navigate(AddListingDestination(text = text))
                            }
                        }
                        // Every signed-in start makes sure the Worker has this device's FCM token (08 §6).
                        LaunchedEffect(first) { if (first == MainDestination) PushTokens.refresh(scheduler) }
                        val linked by linkedVariant.collectAsState()
                        LaunchedEffect(linked) {
                            val variantId = linked ?: return@LaunchedEffect
                            if (!auth.isSignedIn()) return@LaunchedEffect
                            linkedVariant.value = null
                            // A variant just created elsewhere comes with the next pull: wait for it a little.
                            scheduler.syncNow()
                            val product = withTimeoutOrNull(LINK_WAIT_MS) { alerts.productOfVariant(variantId).filterNotNull().first() }
                            nav.navigate(if (product != null) ProductDestination(product) else AlertsDestination())
                        }
                        NavHost(navController = nav, startDestination = first, modifier = Modifier.safeDrawingPadding()) {
                            composable<LoginDestination> {
                                LoginRoute(onSignedIn = {
                                    nav.navigate(MainDestination) { popUpTo<LoginDestination> { inclusive = true } }
                                    PushTokens.refresh(scheduler)
                                    shared.value?.let { text ->
                                        shared.value = null
                                        nav.navigate(AddListingDestination(text = text))
                                    }
                                })
                            }
                            composable<MainDestination> {
                                MainShell(
                                    onSignedOut = { nav.navigate(LoginDestination) { popUpTo<MainDestination> { inclusive = true } } },
                                    onOpenProduct = { nav.navigate(ProductDestination(it)) },
                                    onNewProduct = { nav.navigate(ProductEditorDestination()) },
                                    onOpenPurchase = { nav.navigate(PurchaseEditorDestination(it)) },
                                    onOpenSync = { nav.navigate(SyncDestination) },
                                    onShelfPrice = { nav.navigate(ShelfPriceDestination()) },
                                    onReceiptPhoto = { nav.navigate(PurchaseEditorDestination(receipt = true)) },
                                    onAddLink = { nav.navigate(AddListingDestination(variantId = it)) },
                                    onOpenAlerts = { nav.navigate(AlertsDestination(it)) },
                                    scanActions =
                                        ScanActions(
                                            onAddToPurchase = { draft, variant -> nav.navigate(PurchaseEditorDestination(draft, variant)) },
                                            onShelfPrice = { nav.navigate(ShelfPriceDestination(it)) },
                                            onOpenProduct = { nav.navigate(ProductDestination(it)) },
                                            onNewProduct = { code, g -> nav.navigate(productEditor(code, g)) },
                                            onNewVariant = { product, code, g -> nav.navigate(variantEditor(product, code, g)) },
                                        ),
                                )
                            }
                            composable<ShelfPriceDestination> { ShelfRoute(onDone = { nav.popBackStack() }) }
                            composable<TrackingDestination> {
                                TrackingRoute(
                                    onOpenProduct = { nav.navigate(ProductDestination(it)) },
                                    onAdd = { nav.navigate(AddListingDestination(variantId = it)) },
                                    onBack = { nav.popBackStack() },
                                    onOpenAlerts = { nav.navigate(AlertsDestination(it)) },
                                )
                            }
                            composable<AlertsDestination> {
                                AlertsRoute(onOpenProduct = { nav.navigate(ProductDestination(it)) }, onBack = { nav.popBackStack() })
                            }
                            composable<AddListingDestination> { AddListingRoute(onDone = { nav.popBackStack() }) }
                            composable<SyncDestination> { SyncStatusRoute(onBack = { nav.popBackStack() }) }
                            composable<PurchaseEditorDestination> {
                                PurchaseEditorRoute(onDone = { nav.popBackStack() }, onRegisterCode = { nav.navigate(ScanCodeDestination(it)) })
                            }
                            composable<ScanCodeDestination> { entry ->
                                // The editor opened from here replaces this screen, so saving it goes back to the purchase.
                                fun replace(route: Any) = nav.navigate(route) { popUpTo<ScanCodeDestination> { inclusive = true } }
                                ScanCodeRoute(
                                    code = entry.toRoute<ScanCodeDestination>().code,
                                    actions =
                                        ScanActions(
                                            // Found meanwhile: the purchase adds it by itself.
                                            onAddToPurchase = { _, _ -> nav.popBackStack() },
                                            onShelfPrice = { replace(ShelfPriceDestination(it)) },
                                            onOpenProduct = { replace(ProductDestination(it)) },
                                            onNewProduct = { code, g -> replace(productEditor(code, g)) },
                                            onNewVariant = { product, code, g -> replace(variantEditor(product, code, g)) },
                                        ),
                                    onClose = { nav.popBackStack() },
                                )
                            }
                            composable<ProductDestination> {
                                ProductPageRoute(
                                    onBack = { nav.popBackStack() },
                                    onEdit = { nav.navigate(ProductEditorDestination(it)) },
                                    onOpenVariant = { productId, variantId -> nav.navigate(VariantEditorDestination(productId, variantId)) },
                                    // Merged into another product: its page replaces this one.
                                    onMoved = { nav.navigate(ProductDestination(it)) { popUpTo<ProductDestination> { inclusive = true } } },
                                    onTrackVariant = { nav.navigate(TrackingDestination(it)) },
                                    onAlertsVariant = { nav.navigate(AlertsDestination(it)) },
                                )
                            }
                            composable<ProductEditorDestination> {
                                ProductEditorRoute(
                                    onDone = { nav.popBackStack() },
                                    onOpenVariant = { productId, variantId -> nav.navigate(VariantEditorDestination(productId, variantId)) },
                                )
                            }
                            composable<VariantEditorDestination> { VariantEditorRoute(onDone = { nav.popBackStack() }) }
                        }
                    }
                }
            }
        }
    }
}

private const val LINK_WAIT_MS = 10_000L

/** The variant of a tapped price alert (`maunedas://variant/{id}`), or null for any other start. */
internal fun linkedVariantOf(intent: Intent?): String? =
    intent?.data?.takeIf { it.scheme == "maunedas" && it.host == "variant" }?.lastPathSegment?.takeIf { it.isNotBlank() }

/** The text of a share from another app (a store's link), or null for any other start. */
private fun sharedText(intent: Intent?): String? =
    intent
        ?.takeIf { it.action == Intent.ACTION_SEND && it.type?.startsWith("text/") == true }
        ?.getStringExtra(Intent.EXTRA_TEXT)
        ?.takeIf { it.isNotBlank() }

/** S-09 prefilled from a scanned code and what an open catalog knows (T-116). */
private fun productEditor(
    code: String,
    g: CatalogGuess?,
) = ProductEditorDestination(
    code = code, name = g?.name, brand = g?.brand, measure = g?.measure?.wire,
    unitAmount = g?.unitAmount?.toString(), packCount = g?.packCount?.toString(),
    imageUrl = g?.imageUrl, imageLicense = g?.license, imageAttribution = g?.attribution, imageSourceUrl = g?.sourceUrl,
)

/** S-10 of an existing product with a scanned code. */
private fun variantEditor(
    productId: String,
    code: String,
    g: CatalogGuess?,
) = VariantEditorDestination(
    productId = productId, code = code, measure = g?.measure?.wire,
    unitAmount = g?.unitAmount?.toString(), packCount = g?.packCount?.toString(),
)
