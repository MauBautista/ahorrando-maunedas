package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import com.maubautista.maunedas.core.sync.SyncScheduler
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ScanRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val server = MockWebServer()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private lateinit var scan: ScanRepository

    @Before
    fun start() {
        server.start()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        val tokens = IdTokenProvider { "token" }
        val client = ClientInfo(1, "test")
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, client), TokenAuthenticator(tokens)), MaunedasJson)
        scan = ScanRepository(db, api, SyncScheduler(context, db), ProductPageRepository(db, Clock { 10_000 }))
    }

    @After
    fun stop() {
        db.close()
        server.close()
    }

    private fun json(
        code: Int,
        body: String,
    ) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test
    fun aCodeHereShowsItsVariantAndLatestPricesAndAppearsWhenPulled() =
        runTest {
            assertNull(scan.local("7501020515343").first())
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(listOf(ProductEntity(id = "p", name = "Leche Lala", brand = "Lala", displayUnit = "L", searchKey = "leche lala lala", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v", productId = "p", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            db.priceObservations().upsertAll(listOf(PriceObservationEntity(id = "o", variantId = "v", storeId = "s", source = "shelf", priceCents = 2_700, observedAt = 5, createdAt = 1, updatedAt = 1)))
            // The barcode arrives last, as a pull would bring it.
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b", variantId = "v", code = "7501020515343", source = "scan", createdAt = 1, updatedAt = 1)))
            val hit = scan.local("7501020515343").first()!!
            assertEquals(listOf("v", "p", "Leche Lala", "1 L", "Lala"), listOf(hit.variantId, hit.productId, hit.productName, hit.variantLabel, hit.brand))
            assertEquals(listOf("Soriana" to 2_700L), hit.latest.map { it.storeName to it.displayCents })
        }

    @Test
    fun theApiAnswerBecomesAPathOfS12() =
        runTest {
            server.enqueue(json(200, """{"code":"1","match":{"variant_id":"v","product_id":"p","product_name":"Leche Lala","variant_label":"1 L"},"catalog":null}"""))
            assertEquals(RemoteLookup.Match("Leche Lala", "1 L"), scan.lookup("75010205153"))
            assertEquals("/v1/barcodes/75010205153", server.takeRequest().url.encodedPath)
            server.enqueue(
                json(
                    200,
                    """{"code":"1","match":null,"catalog":{"source":"off","name":"Leche entera","brand":"Lala","quantity_text":"6 x 1 l",
                       "parsed":{"measure":"volume","unit_amount":1000,"pack_count":6},"image_url":"https://img/x.jpg","license":"CC BY-SA 3.0",
                       "attribution":"Open Food Facts contributors","source_url":"https://off/p/1"}}""",
                ),
            )
            val catalog = (scan.lookup("75010205153") as RemoteLookup.Catalog).guess
            assertEquals(
                CatalogGuess("Leche entera", "Lala", "6 x 1 l", Measure.VOLUME, 1000.0, 6, "https://img/x.jpg", "Open Food Facts contributors"),
                catalog,
            )
            server.enqueue(json(200, """{"code":"1","match":null,"catalog":null}"""))
            assertEquals(RemoteLookup.NotFound, scan.lookup("75010205153"))
            server.enqueue(json(502, """{"error":{"code":"UPSTREAM_ERROR","message":"x"}}"""))
            assertEquals(RemoteLookup.Failed, scan.lookup("75010205153"))
            server.close()
            assertEquals(RemoteLookup.NoNetwork, scan.lookup("75010205153"))
        }

    @Test
    fun theOpenDraftIsTheNewestAndProductsAreFoundByWords() =
        runTest {
            assertNull(scan.openDraft().first())
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.purchases().upsertAll(
                listOf(
                    PurchaseEntity(id = "old", storeId = "s", purchasedAt = 1, currency = "MXN", discountCents = 0, source = "manual", status = "draft", createdAt = 1, updatedAt = 1),
                    PurchaseEntity(id = "new", storeId = "s", purchasedAt = 1, currency = "MXN", discountCents = 0, source = "manual", status = "draft", createdAt = 1, updatedAt = 9),
                    PurchaseEntity(id = "done", storeId = "s", purchasedAt = 1, currency = "MXN", discountCents = 0, source = "manual", status = "confirmed", createdAt = 1, updatedAt = 20),
                ),
            )
            assertEquals(OpenDraft("new", "Soriana"), scan.openDraft().first())
            db.products().upsertAll(listOf(ProductEntity(id = "p", name = "Leche Lala", brand = "Lala", displayUnit = "L", searchKey = "leche lala lala", createdAt = 1, updatedAt = 1)))
            assertEquals(listOf(ProductChoice("p", "Leche Lala", "Lala")), scan.searchProducts("LECHE"))
            assertEquals(emptyList<ProductChoice>(), scan.searchProducts("café"))
        }
}
