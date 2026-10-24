package com.maubautista.maunedas.feature.scan

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.data.ProductChoice
import com.maubautista.maunedas.core.data.ProductPageRepository
import com.maubautista.maunedas.core.data.ProductPhotos
import com.maubautista.maunedas.core.data.ScanRepository
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
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
import com.maubautista.maunedas.core.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The four paths of S-12 over the real repository: Room in memory and a mock Worker. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ScanViewModelTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dispatcher = StandardTestDispatcher()
    private val server = MockWebServer()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).setQueryCoroutineContext(dispatcher).allowMainThreadQueries().build()
    private lateinit var vm: ScanViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        server.start()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        val tokens = IdTokenProvider { "token" }
        val client = ClientInfo(1, "test")
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, client), TokenAuthenticator(tokens)), MaunedasJson)
        val clock = Clock { 10_000 }
        vm = ScanViewModel(ScanRepository(db, api, SyncScheduler(context, db), ProductPageRepository(db, clock, ProductPhotos(context, db, ApiConfig(server.url("/").toString())))), clock)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
        server.close()
    }

    /** The mock server answers on OkHttp's threads: let both sides run until [done], for at most 5 s. */
    private fun kotlinx.coroutines.test.TestScope.awaitResult(done: (ScanResult?) -> Boolean) {
        repeat(250) {
            advanceUntilIdle()
            if (done(vm.result.value)) return
            Thread.sleep(20)
        }
        throw AssertionError("El resultado no llegó: ${vm.result.value}")
    }

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private suspend fun catalog(withCode: Boolean) {
        db.products().upsertAll(listOf(ProductEntity(id = "p", name = "Leche Lala", displayUnit = "L", searchKey = "leche lala", createdAt = 1, updatedAt = 1)))
        db.variants().upsertAll(listOf(VariantEntity(id = "v", productId = "p", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
        if (withCode) db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b", variantId = "v", code = "7501020515343", source = "scan", createdAt = 1, updatedAt = 1)))
    }

    @Test
    fun aCodeHereIsFoundWithoutAskingTheServer() =
        runTest(dispatcher) {
            catalog(withCode = true)
            vm.onCode("7501020515343")
            advanceUntilIdle()
            val found = vm.result.value as ScanResult.Found
            assertEquals("Leche Lala" to "1 L", found.hit.productName to found.hit.variantLabel)
            assertEquals(0, server.requestCount)
            vm.dismiss()
            assertNull(vm.result.value)
        }

    @Test
    fun aCodeOnTheServerIsPulledAndThenShown() =
        runTest(dispatcher) {
            server.enqueue(json("""{"code":"7501020515343","match":{"variant_id":"v","product_id":"p","product_name":"Leche Lala","variant_label":"1 L"},"catalog":null}"""))
            vm.onCode("7501020515343")
            awaitResult { it is ScanResult.Pulling }
            assertEquals(ScanResult.Pulling("7501020515343", "Leche Lala", "1 L"), vm.result.value)
            // A sync was asked right away so the rows come down.
            assertEquals(1, WorkManager.getInstance(context).getWorkInfosForUniqueWork("sync-now").get().size)
            // The pull brings the rows.
            catalog(withCode = true)
            advanceUntilIdle()
            assertTrue(vm.result.value is ScanResult.Found)
        }

    @Test
    fun anUnknownCodeOffersANewProductAndSaysWhenThereIsNoNetwork() =
        runTest(dispatcher) {
            catalog(withCode = false)
            server.enqueue(json("""{"code":"12345678","match":null,"catalog":null}"""))
            vm.onCode("12345678")
            awaitResult { it is ScanResult.New }
            assertEquals(ScanResult.New("12345678", null, offline = false), vm.result.value)
            // "¿Es otra presentación…?" searches our products.
            vm.chooseExisting()
            vm.onProductQuery("leche")
            advanceUntilIdle()
            assertEquals(listOf(ProductChoice("p", "Leche Lala", null)), (vm.result.value as ScanResult.New).choices)
            server.close()
            vm.onCode("87654321")
            awaitResult { (it as? ScanResult.New)?.code == "87654321" }
            assertEquals(true, (vm.result.value as ScanResult.New).offline)
        }
}
