package com.maubautista.maunedas.feature.tracking

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.data.AlertScope
import com.maubautista.maunedas.core.data.AlertType
import com.maubautista.maunedas.core.data.AlertsRepository
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.TrackingRepository
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** S-22 over the real repositories. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AlertsViewModelTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { 1_000_000L }
    private lateinit var vm: AlertsViewModel

    @Before
    fun setUp() =
        runTest {
            Dispatchers.setMain(UnconfinedTestDispatcher())
            WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
            val tokens = IdTokenProvider { "token" }
            val api = createMaunedasApi(ApiConfig("https://api.test/"), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
            val writer = LocalWriter(db, clock, { "u1" }, { })
            val tracking = TrackingRepository(db, api, writer, clock, SyncScheduler(context, db), PurchaseEditor(db, writer, clock))
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Costco", kind = "both", adapter = "costco_mx", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(listOf(ProductEntity(id = "p1", name = "Leche Lala Entera", displayUnit = "L", searchKey = "leche lala entera", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v1", productId = "p1", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            db.listings().upsertAll(listOf(ListingEntity(id = "l1", variantId = "v1", storeId = "s", adapter = "costco_mx", url = "https://www.costco.com.mx/p/1", active = 1, createdAt = 1, updatedAt = 1)))
            vm = AlertsViewModel(SavedStateHandle(mapOf("variantId" to "v1")), AlertsRepository(db, writer, clock, { "u1" }), tracking, clock)
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
    }

    @Test
    fun aFirstRuleForTheProductPagesVariantAsksForNotifications() =
        runTest {
            assertEquals("Leche Lala Entera · 1 L", vm.state.first { !it.loading }.variantName)
            vm.newRule()
            val form = vm.form.first { it?.variant != null && it.stores.isNotEmpty() }!!
            assertEquals(listOf("v1", listOf("l1" to "Costco")), listOf(form.variant!!.id, form.stores))
            vm.save()
            assertEquals(R.string.alerts_problem_price, vm.form.value!!.problem)
            vm.onForm { it.copy(priceCents = 2_490, listingId = "l1", cooldown = "12") }
            assertNull(vm.form.value!!.problem)
            vm.save()
            vm.firstRuleSaved.first()
            assertNull(vm.form.value)
            val rule = vm.state.first { it.rules.isNotEmpty() }.rules.single()
            assertEquals(listOf(AlertType.BELOW_PRICE, 2_490L, "l1", "Costco", 12L, true), listOf(rule.type, rule.thresholdCents, rule.listingId, rule.storeName, rule.cooldownHours, rule.active))
        }

    @Test
    fun editsPausesAndRemovesAfterConfirming() =
        runTest {
            vm.newRule()
            vm.form.first { it?.variant != null }
            vm.onForm { it.copy(type = AlertType.NEW_LOW, scope = AlertScope.VARIANT_ALL) }
            vm.save()
            val rule = vm.state.first { it.rules.isNotEmpty() }.rules.single()
            vm.edit(rule)
            assertEquals(listOf(true, AlertType.NEW_LOW, AlertScope.VARIANT_ALL, "24"), vm.form.value!!.let { listOf(it.variantLocked, it.type, it.scope, it.cooldown) })
            vm.onForm { it.copy(type = AlertType.DROP_PCT, pct = "15") }
            vm.save()
            assertEquals(15.0, vm.state.first { it.rules.single().type == AlertType.DROP_PCT }.rules.single().thresholdPct!!, 0.0)
            vm.toggle(vm.state.value.rules.single())
            assertEquals(false, vm.state.first { !it.rules.single().active }.rules.single().active)
            vm.askRemove(vm.state.value.rules.single())
            vm.dismissRemove()
            assertNull(vm.confirmRemove.value)
            vm.askRemove(vm.state.value.rules.single())
            vm.remove()
            assertEquals(emptyList<Any>(), vm.state.first { it.rules.isEmpty() }.rules)
        }

    @Test
    fun choosesAVariantBySearchWhenOpenedForAll() =
        runTest {
            val all = AlertsViewModel(SavedStateHandle(), AlertsRepository(db, LocalWriter(db, clock, { "u1" }, { }), clock, { "u1" }), TrackingRepository(db, createMaunedasApi(ApiConfig("https://api.test/"), createOkHttpClient(AuthInterceptor({ "t" }, ClientInfo(1, "t")), TokenAuthenticator { "t" }), MaunedasJson), LocalWriter(db, clock, { "u1" }, { }), clock, SyncScheduler(context, db), PurchaseEditor(db, LocalWriter(db, clock, { "u1" }, { }), clock)), clock)
            all.newRule()
            assertNull(all.form.first { it != null }!!.variant)
            all.onQuery("lala")
            val found = all.form.first { it?.searched == true }!!.results
            all.chooseVariant(found.single())
            assertEquals("v1", all.form.value!!.variant!!.id)
            all.closeForm()
            assertNull(all.form.value)
        }
}
