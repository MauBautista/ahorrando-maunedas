package com.maubautista.maunedas.feature.tracking

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.data.AgentStatusRepository
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

/** S-20's actions over the real repository. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class TrackingViewModelTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    // Direct executors: a write launched by the view model ends inside the call, so "nothing written" can be checked.
    private val db =
        Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries()
            .setQueryExecutor(Runnable::run).setTransactionExecutor(Runnable::run).build()
    private var nowMs = 1_000_000L
    private val clock = Clock { nowMs }
    private lateinit var tracking: TrackingRepository

    @Before
    fun setUp() =
        runTest {
            Dispatchers.setMain(UnconfinedTestDispatcher())
            WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
            val tokens = IdTokenProvider { "token" }
            val api = createMaunedasApi(ApiConfig("https://api.test/"), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
            val writer = LocalWriter(db, clock, { "u1" }, { })
            tracking = TrackingRepository(db, api, writer, clock, SyncScheduler(context, db), PurchaseEditor(db, writer, clock))
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Amazon", kind = "online", adapter = "amazon_mx", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(listOf(ProductEntity(id = "p1", name = "Leche Lala Entera", displayUnit = "L", searchKey = "leche lala entera", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v1", productId = "p1", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            db.listings().upsertAll(
                listOf(ListingEntity(id = "l1", variantId = "v1", storeId = "s", adapter = "amazon_mx", url = "https://www.amazon.com.mx/dp/B1", active = 1, createdAt = 1, updatedAt = 1)),
            )
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
    }

    @Test
    fun checksPausesAndStopsFollowingAfterConfirming() =
        runTest {
            val vm = TrackingViewModel(SavedStateHandle(mapOf("variantId" to "v1")), tracking, clock, AgentStatusRepository(db))
            val listing = vm.state.first { !it.loading }.let { s ->
                assertEquals("Leche Lala Entera · 1 L", s.variantName)
                s.listings.single()
            }
            vm.checkNow(listing)
            // The notice waits in its channel for the screen.
            assertEquals("Amazon", vm.checkAsked.first())
            assertEquals(true, vm.state.first { it.listings.single().checkRequested }.listings.single().checkRequested)

            vm.toggle(listing)
            assertEquals(false, vm.state.first { !it.listings.single().active }.listings.single().active)

            vm.askStop(listing)
            assertEquals("l1", vm.confirmStop.value?.id)
            vm.dismissStop()
            assertNull(vm.confirmStop.value)
            vm.askStop(listing)
            vm.stop()
            assertNull(vm.confirmStop.value)
            assertEquals(emptyList<Any>(), vm.state.first { it.listings.isEmpty() }.listings)
            assertEquals(1_000_000L, db.listings().byId("l1")!!.deletedAt)
        }

    @Test
    fun choosesAnIntervalAndGoesBackToTheStores() =
        runTest {
            val vm = TrackingViewModel(SavedStateHandle(mapOf("variantId" to "v1")), tracking, clock, AgentStatusRepository(db))
            val listing = vm.state.first { !it.loading }.listings.single()
            assertEquals(listOf(null, 480L), listOf(listing.intervalMin, listing.storeIntervalMin))
            vm.askInterval(listing)
            assertEquals("l1", vm.intervalFor.value?.id)
            vm.dismissInterval()
            assertNull(vm.intervalFor.value)
            // Without asking first, nothing is written.
            vm.setInterval(120)
            assertEquals(null, db.listings().byId("l1")!!.checkIntervalMin)

            vm.askInterval(listing)
            vm.setInterval(240)
            assertNull(vm.intervalFor.value)
            val chosen = vm.state.first { it.listings.single().intervalMin == 240L }.listings.single()
            assertEquals(240L, db.listings().byId("l1")!!.checkIntervalMin)
            // The current one again writes nothing; the store's is null.
            val written = db.listings().byId("l1")!!.updatedAt
            nowMs += 1_000
            vm.askInterval(chosen)
            vm.setInterval(240)
            assertEquals(written, db.listings().byId("l1")!!.updatedAt)
            vm.askInterval(chosen)
            vm.setInterval(null)
            assertEquals(null, vm.state.first { it.listings.single().intervalMin == null }.listings.single().intervalMin)
            assertEquals(null, db.listings().byId("l1")!!.checkIntervalMin)
        }
}
