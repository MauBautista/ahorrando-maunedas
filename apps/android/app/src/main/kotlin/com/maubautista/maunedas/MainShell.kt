package com.maubautista.maunedas

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.maubautista.maunedas.core.ui.ComingSoon
import com.maubautista.maunedas.feature.catalog.CatalogRoute
import com.maubautista.maunedas.feature.home.HomeActions
import com.maubautista.maunedas.feature.home.HomeRoute
import com.maubautista.maunedas.feature.purchases.PurchasesRoute
import com.maubautista.maunedas.feature.settings.SettingsRoute
import kotlinx.serialization.Serializable
import kotlin.reflect.KClass
import com.maubautista.maunedas.core.designsystem.R as DesignR

@Serializable
object HomeTab

@Serializable
object PurchasesTab

@Serializable
object ScanTab

@Serializable
object CatalogTab

@Serializable
object SettingsTab

private enum class Tab(
    val route: Any,
    @StringRes val label: Int,
    @DrawableRes val icon: Int,
) {
    HOME(HomeTab, R.string.tab_home, DesignR.drawable.ic_home),
    PURCHASES(PurchasesTab, R.string.tab_purchases, DesignR.drawable.ic_receipt_long),
    SCAN(ScanTab, R.string.tab_scan, DesignR.drawable.ic_barcode_scanner),
    CATALOG(CatalogTab, R.string.tab_catalog, DesignR.drawable.ic_category),
    SETTINGS(SettingsTab, R.string.tab_settings, DesignR.drawable.ic_settings),
    ;

    val routeClass: KClass<*> get() = route::class
}

/** Bottom bar: Inicio · Compras · Escanear · Catálogo · Ajustes (05 §4). */
@Composable
fun MainShell(
    onSignedOut: () -> Unit,
    onOpenProduct: (String) -> Unit,
    onNewProduct: () -> Unit,
    onOpenPurchase: (String?) -> Unit,
) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = entry?.destination?.hierarchy?.any { it.hasRoute(tab.routeClass) } == true,
                        onClick = { nav.openTab(tab) },
                        icon = { Icon(painterResource(tab.icon), contentDescription = null) },
                        label = { Text(stringResource(tab.label)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(navController = nav, startDestination = HomeTab, modifier = Modifier.padding(padding)) {
            composable<HomeTab> {
                // Until their screens exist, the receipt photo, shelf price and scan open the tab that will hold them
                // (T-116, T-123, T-125).
                HomeRoute(
                    HomeActions(
                        newPurchase = { onOpenPurchase(null) },
                        receiptPhoto = { nav.openTab(Tab.PURCHASES) },
                        shelfPrice = { nav.openTab(Tab.SCAN) },
                        scan = { nav.openTab(Tab.SCAN) },
                        openPurchase = { onOpenPurchase(it) },
                        openDrafts = { nav.openTab(Tab.PURCHASES) },
                        openRejected = { nav.openTab(Tab.SETTINGS) },
                    ),
                )
            }
            composable<PurchasesTab> { PurchasesRoute(onOpenPurchase = onOpenPurchase, onNewPurchase = { onOpenPurchase(null) }) }
            composable<ScanTab> { ComingSoon(stringResource(R.string.tab_scan)) }
            composable<CatalogTab> { CatalogRoute(onOpenProduct = onOpenProduct, onNewProduct = onNewProduct) }
            composable<SettingsTab> { SettingsRoute(onSignedOut = onSignedOut) }
        }
    }
}

/** One copy of each tab, its state kept, and Back from any tab returns to Inicio. */
private fun NavHostController.openTab(tab: Tab) =
    navigate(tab.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
