package com.maubautista.maunedas.feature.tracking

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.TrackingRepository
import com.maubautista.maunedas.core.database.AppDatabase
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
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** S-21 over the real repository: Room in memory and a mock Worker. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AddListingViewModelTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val server = MockWebServer()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { 1_000_000L }
    private lateinit var tracking: TrackingRepository

    private val resolved =
        """{"adapter":"costco_mx","store_id":"s-costco","url":"https://www.costco.com.mx/p/1?x=1","canonical_url":"https://www.costco.com.mx/p/1","external_id":"1"}"""

    @Before
    fun setUp() =
        runTest {
            Dispatchers.setMain(UnconfinedTestDispatcher())
            server.start()
            WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
            val tokens = IdTokenProvider { "token" }
            val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
            val writer = LocalWriter(db, clock, { "u1" }, { })
            tracking = TrackingRepository(db, api, writer, clock, SyncScheduler(context, db), PurchaseEditor(db, writer, clock))
            db.stores().upsertAll(listOf(StoreEntity(id = "s-costco", name = "Costco", kind = "both", adapter = "costco_mx", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(listOf(ProductEntity(id = "p1", name = "Leche Lala Entera", brand = "Lala", displayUnit = "L", searchKey = "leche lala entera lala", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v1", productId = "p1", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
        server.close()
    }

    private fun json(
        code: Int,
        body: String,
    ) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private fun viewModel(vararg args: Pair<String, String>) = AddListingViewModel(SavedStateHandle(mapOf(*args)), tracking)

    @Test
    fun aSharedLinkIsResolvedAtOnceAndFollowedForTheProductPagesVariant() =
        runTest {
            server.enqueue(json(200, resolved))
            val vm = viewModel("text" to "Mira esto https://www.costco.com.mx/p/1?x=1", "variantId" to "v1")
            val state = vm.state.first { it.link != null }
            assertEquals("Costco", state.link!!.storeName)
            assertEquals("Leche Lala Entera · 1 L", state.variant!!.name)
            assertEquals("""{"url":"Mira esto https://www.costco.com.mx/p/1?x=1"}""", server.takeRequest().body?.utf8())
            vm.save()
            vm.done.first()
            val row = db.listings().liveOfVariants(listOf("v1")).single()
            assertEquals(listOf("s-costco", "costco_mx", "https://www.costco.com.mx/p/1"), listOf(row.storeId, row.adapter, row.canonicalUrl))
        }

    @Test
    fun saysWhyItCannotFollowALink() =
        runTest {
            val vm = viewModel()
            server.enqueue(json(422, """{"error":{"code":"UNSUPPORTED_URL","message":"x","details":{"reason":"SHORT_LINK"}}}"""))
            vm.onText("https://amzn.to/roto")
            vm.resolve()
            assertEquals(R.string.add_reason_short_link, vm.state.first { !it.resolving && it.problem != null }.problem)
            vm.onText("https://amzn.to/otro")
            assertNull(vm.state.value.problem)
            server.close()
            vm.resolve()
            assertEquals(R.string.add_no_network, vm.state.first { !it.resolving && it.problem != null }.problem)
        }

    @Test
    fun choosesAVariantBySearch() =
        runTest {
            server.enqueue(json(200, resolved))
            val vm = viewModel("text" to "https://www.costco.com.mx/p/1")
            vm.state.first { it.link != null }
            vm.onQuery("lala")
            val found = vm.state.first { it.searched }.results
            assertEquals(listOf("v1"), found.map { it.id })
            vm.choose(found.single())
            assertEquals("Leche Lala Entera · 1 L", vm.state.value.variant!!.name)
            assertEquals(true, vm.state.value.canSave)
            vm.changeVariant()
            assertNull(vm.state.value.variant)
            vm.otherLink()
            assertNull(vm.state.value.link)
        }

    @Test
    fun eachReasonHasItsText() {
        assertEquals(R.string.add_reason_no_url, AddListingViewModel.reasonText("NO_URL"))
        assertEquals(R.string.add_reason_short_link, AddListingViewModel.reasonText("SHORT_LINK"))
        assertEquals(R.string.add_reason_not_tracked, AddListingViewModel.reasonText("NOT_TRACKED"))
        assertEquals(R.string.add_reason_no_store, AddListingViewModel.reasonText("NO_STORE"))
        assertEquals(R.string.add_unsupported, AddListingViewModel.reasonText(null))
    }
}
