package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.database.entity.ListingStateEntity
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
import com.maubautista.maunedas.core.sync.CheckNowWorker
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncScheduler
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TrackingRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val server = MockWebServer()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private var now = 1_000_000L
    private val clock = Clock { now }
    private var syncRequests = 0
    private lateinit var tracking: TrackingRepository

    @Before
    fun start() =
        runTest {
            server.start()
            WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
            val tokens = IdTokenProvider { "token" }
            val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
            val writer = LocalWriter(db, clock, { "u1" }, { syncRequests++ })
            tracking = TrackingRepository(db, api, writer, clock, SyncScheduler(context, db), PurchaseEditor(db, writer, clock))
            db.stores().upsertAll(
                listOf(
                    StoreEntity(id = "s-amazon", name = "Amazon", kind = "online", adapter = "amazon_mx", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                    StoreEntity(id = "s-costco", name = "Costco", kind = "both", adapter = "costco_mx", defaultCheckIntervalMin = 720, createdAt = 1, updatedAt = 1),
                ),
            )
            db.products().upsertAll(
                listOf(
                    ProductEntity(id = "p1", name = "Leche Lala Entera", brand = "Lala", displayUnit = "L", searchKey = "leche lala entera lala", createdAt = 1, updatedAt = 1),
                    ProductEntity(id = "p2", name = "Atún Dolores", brand = "Dolores", displayUnit = "kg", searchKey = "atun dolores dolores", createdAt = 1, updatedAt = 1),
                ),
            )
            db.variants().upsertAll(
                listOf(
                    VariantEntity(id = "v1", productId = "p1", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                    VariantEntity(id = "v2", productId = "p2", label = "140 g", measure = "mass", unitAmount = 140.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                ),
            )
        }

    @After
    fun stop() {
        db.close()
        server.close()
    }

    private fun listing(
        id: String,
        variant: String = "v1",
        store: String = "s-amazon",
        active: Int = 1,
        deletedAt: Long? = null,
        canonical: String = "https://www.amazon.com.mx/dp/$id",
        interval: Long? = null,
    ) = ListingEntity(
        id = id, variantId = variant, storeId = store, adapter = "amazon_mx", url = "$canonical?ref=x", canonicalUrl = canonical,
        externalId = id, checkIntervalMin = interval, active = active, createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
    )

    private fun state(
        id: String,
        status: String? = "ok",
        price: Long? = 2_899,
        list: Long? = null,
        inStock: Int? = 1,
        checked: Long? = 500_000,
        requested: Long? = null,
    ) = ListingStateEntity(
        listingId = id, lastCheckedAt = checked, lastStatus = status, consecutiveFailures = 0, lastPriceCents = price,
        lastListPriceCents = list, lastInStock = inStock, lastPromoText = if (list != null) "2x1" else null, checkRequestedAt = requested, updatedAt = 1,
    )

    private fun json(
        code: Int,
        body: String,
    ) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private suspend fun outbox() = db.outbox().nextBatch(100, Long.MAX_VALUE).map { "${it.tableName}/${it.rowId}" }

    @Test
    fun listsLiveListingsWithStateAndHealth() =
        runTest {
            db.listings().upsertAll(
                listOf(
                    listing("a"),
                    listing("b", store = "s-costco", interval = 240),
                    listing("c", active = 0),
                    listing("d", deletedAt = 5),
                    listing("t", variant = "v2"),
                ),
            )
            db.listingState().upsertAll(
                listOf(
                    state("a", list = 3_299),
                    state("b", inStock = 0, list = 1_000),
                    state("t", status = "blocked", requested = 600_000),
                ),
            )
            val all = tracking.listings(null).first()
            assertEquals(listOf("t", "a", "c", "b").sorted(), all.map { it.id }.sorted())
            assertEquals(listOf("Atún Dolores", "Leche Lala Entera", "Leche Lala Entera", "Leche Lala Entera"), all.map { it.productName })
            val byId = all.associateBy { it.id }
            val a = byId.getValue("a")
            assertEquals(listOf(ListingHealth.OK, 2_899L, 3_299L, "2x1", false), listOf(a.health, a.priceCents, a.listPriceCents, a.promoText, a.checkRequested))
            assertEquals("https://www.amazon.com.mx/dp/a?ref=x", a.url)
            // A list price below the price is no struck price.
            val b = byId.getValue("b")
            assertEquals(listOf(ListingHealth.OUT_OF_STOCK, null, 240L, 720L, "Costco"), listOf(b.health, b.listPriceCents, b.intervalMin, b.storeIntervalMin, b.storeName))
            assertEquals(listOf(null, 480L), listOf(a.intervalMin, a.storeIntervalMin))
            val c = byId.getValue("c")
            assertEquals(listOf(ListingHealth.PAUSED, null, false), listOf(c.health, c.lastCheckedAt, c.active))
            val t = byId.getValue("t")
            assertEquals(listOf(ListingHealth.BLOCKED, true), listOf(t.health, t.checkRequested))
            assertEquals(listOf("t"), tracking.listings("v2").first().map { it.id })
            assertEquals("Atún Dolores · 140 g", tracking.variantName("v2").first())
        }

    @Test
    fun healthOfEachState() {
        val h = TrackingRepository::health
        assertEquals(ListingHealth.PAUSED, h(false, "ok", 1))
        assertEquals(ListingHealth.WAITING, h(true, null, null))
        assertEquals(ListingHealth.WAITING, h(true, "pending", null))
        assertEquals(ListingHealth.OK, h(true, "ok", null))
        assertEquals(ListingHealth.OUT_OF_STOCK, h(true, "ok", 0))
        assertEquals(ListingHealth.NOT_FOUND, h(true, "not_found", null))
        assertEquals(ListingHealth.BLOCKED, h(true, "blocked", 1))
        assertEquals(ListingHealth.ERROR, h(true, "error", 1))
    }

    @Test
    fun followsPausesAndStopsFollowingBySync() =
        runTest {
            val link = ResolvedLink("costco_mx", "s-costco", "Costco", "https://www.costco.com.mx/p/1?x=1", "https://www.costco.com.mx/p/1", "1", null)
            val id = tracking.follow(link, "v2")
            val row = db.listings().byId(id)!!
            assertEquals(
                listOf("v2", "s-costco", "costco_mx", "https://www.costco.com.mx/p/1?x=1", "https://www.costco.com.mx/p/1", "1", null, 1, now, "u1"),
                listOf(row.variantId, row.storeId, row.adapter, row.url, row.canonicalUrl, row.externalId, row.checkIntervalMin, row.active, row.createdAt, row.updatedBy),
            )
            assertEquals(listOf("listings/$id"), outbox())
            assertEquals(1, syncRequests)
            now += 1_000
            tracking.setActive(id, false)
            assertEquals(0, db.listings().byId(id)!!.active)
            tracking.setActive(id, true)
            assertEquals(1, db.listings().byId(id)!!.active)
            // RF-TRK-02: its own interval, then the store's again; each change goes up by sync.
            tracking.setInterval(id, 240)
            assertEquals(listOf(240L, now), db.listings().byId(id)!!.let { listOf(it.checkIntervalMin, it.updatedAt) })
            assertEquals(listOf("listings/$id"), outbox())
            tracking.setInterval(id, null)
            assertNull(db.listings().byId(id)!!.checkIntervalMin)
            now += 1_000
            tracking.stopFollowing(id)
            assertEquals(now, db.listings().byId(id)!!.deletedAt)
            assertTrue(tracking.listings(null).first().isEmpty())
            // Nothing happens to a listing that is not here.
            tracking.setActive("nope", true)
            tracking.setInterval("nope", 120)
            tracking.stopFollowing("nope")
            assertNull(db.listings().byId("nope"))
        }

    @Test
    fun resolvesALinkAndSaysWhenItIsAlreadyFollowed() =
        runTest {
            val body = """{"adapter":"amazon_mx","store_id":"s-amazon","url":"https://amzn.to/x","canonical_url":"https://www.amazon.com.mx/dp/B1","external_id":"B1"}"""
            server.enqueue(json(200, body))
            val first = tracking.resolve("  Mira https://amzn.to/x  ") as ResolveOutcome.Resolved
            assertEquals(ResolvedLink("amazon_mx", "s-amazon", "Amazon", "https://amzn.to/x", "https://www.amazon.com.mx/dp/B1", "B1", null), first.link)
            val request = server.takeRequest()
            assertEquals("/v1/listings/resolve", request.target)
            assertEquals("""{"url":"Mira https://amzn.to/x"}""", request.body?.utf8())

            db.listings().upsertAll(listOf(listing("B1", canonical = "https://www.amazon.com.mx/dp/B1")))
            server.enqueue(json(200, body.replace("s-amazon", "s-unknown")))
            val twin = (tracking.resolve("https://amzn.to/x") as ResolveOutcome.Resolved).link
            assertEquals("Leche Lala Entera · 1 L", twin.followedBy)
            assertNull(twin.storeName)
        }

    @Test
    fun saysWhyALinkCannotBeFollowed() =
        runTest {
            server.enqueue(json(422, """{"error":{"code":"UNSUPPORTED_URL","message":"Esa tienda todavía no se puede seguir.","details":{"reason":"NOT_TRACKED"}}}"""))
            assertEquals(ResolveOutcome.Unsupported("NOT_TRACKED"), tracking.resolve("https://www.walmart.com.mx/ip/x/1"))
            server.enqueue(json(422, """{"error":{"code":"UNSUPPORTED_URL","message":"x"}}"""))
            assertEquals(ResolveOutcome.Unsupported(null), tracking.resolve("x"))
            server.enqueue(json(500, """{"error":{"code":"INTERNAL","message":"Error inesperado"}}"""))
            assertEquals(ResolveOutcome.Failed("Error inesperado"), tracking.resolve("x"))
            server.close()
            assertEquals(ResolveOutcome.NoNetwork, tracking.resolve("x"))
        }

    @Test
    fun checkNowQueuesAWorkerAndMarksTheListing() =
        runTest {
            db.listings().upsertAll(listOf(listing("a")))
            db.listingState().upsertAll(listOf(state("a")))
            assertFalse(tracking.listings(null).first().single().checkRequested)
            tracking.checkNow("a")
            val work = WorkManager.getInstance(context).getWorkInfosByTag(CheckNowWorker.tagOf("a")).get()
            assertNotNull(work.singleOrNull())
            assertTrue(tracking.listings(null).first().single().checkRequested)
        }

    @Test
    fun searchesVariantsByEveryWord() =
        runTest {
            assertEquals(listOf(VariantOption("v1", "Leche Lala Entera · 1 L", "Lala")), tracking.searchVariants("lala 1"))
            assertTrue(tracking.searchVariants("cafe").isEmpty())
        }
}
