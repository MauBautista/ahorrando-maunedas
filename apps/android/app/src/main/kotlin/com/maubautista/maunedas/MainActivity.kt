package com.maubautista.maunedas

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
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
import com.maubautista.maunedas.core.data.CatalogGuess
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.feature.auth.LoginRoute
import com.maubautista.maunedas.feature.catalog.ProductEditorRoute
import com.maubautista.maunedas.feature.catalog.ProductPageRoute
import com.maubautista.maunedas.feature.catalog.VariantEditorRoute
import com.maubautista.maunedas.feature.purchases.PurchaseEditorRoute
import com.maubautista.maunedas.feature.scan.ScanActions
import com.maubautista.maunedas.feature.scan.ScanCodeRoute
import com.maubautista.maunedas.feature.settings.SyncStatusRoute
import com.maubautista.maunedas.feature.shelf.ShelfRoute
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.serialization.Serializable

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

/** S-04; null [purchaseId] starts a new purchase; [addVariantId] opens the line sheet with that variant (S-12). */
@Serializable
data class PurchaseEditorDestination(
    val purchaseId: String? = null,
    val addVariantId: String? = null,
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

/** Single activity (05 §4). With a saved session it opens at home without network (RF-AUTH-08). */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var auth: AuthService

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaunedasTheme {
                Surface(Modifier.fillMaxSize()) {
                    // Wait for the session to be read: no flash of the login screen for someone signed in.
                    var start by remember { mutableStateOf<Any?>(null) }
                    LaunchedEffect(Unit) { start = if (auth.isSignedIn()) MainDestination else LoginDestination }
                    start?.let { first ->
                        val nav = rememberNavController()
                        NavHost(navController = nav, startDestination = first, modifier = Modifier.safeDrawingPadding()) {
                            composable<LoginDestination> {
                                LoginRoute(onSignedIn = {
                                    nav.navigate(MainDestination) { popUpTo<LoginDestination> { inclusive = true } }
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
