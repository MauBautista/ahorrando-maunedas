package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CatalogMergerTest {
    private val server = MockWebServer()
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private var syncs = 0
    private lateinit var merger: CatalogMerger

    @Before
    fun start() {
        server.start()
        val tokens = IdTokenProvider { "token" }
        val client = ClientInfo(1, "test")
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, client), TokenAuthenticator(tokens)), MaunedasJson)
        merger = CatalogMerger(api, db) { syncs++ }
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
    fun aMergeAsksTheServerAndThenSyncs() =
        runTest {
            server.enqueue(json(200, """{"moved":{"variants":2,"images":0,"product_tags":1}}"""))
            assertEquals(MergeResult.Done, merger.mergeProducts("src", "dst"))
            val request = server.takeRequest()
            assertEquals("/v1/admin/merge", request.url.encodedPath)
            assertEquals("""{"kind":"product","source_id":"src","target_id":"dst"}""", request.body!!.utf8())
            assertEquals(1, syncs)
        }

    @Test
    fun pendingChangesGoUpFirst() =
        runTest {
            db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "variants", rowId = "v", enqueuedAt = 1)))
            assertEquals(MergeResult.PendingChanges, merger.mergeVariants("v", "w"))
            assertEquals(0, server.requestCount)
            assertEquals(1, syncs)
        }

    @Test
    fun theServerSaysWhyItCannotMerge() =
        runTest {
            server.enqueue(json(409, """{"error":{"code":"MERGE_INVALID","message":"x","details":{"reason":"MEASURE_MISMATCH"}}}"""))
            assertEquals(MergeResult.Invalid("MEASURE_MISMATCH"), merger.mergeVariants("a", "b"))
            server.enqueue(json(403, """{"error":{"code":"FORBIDDEN","message":"x"}}"""))
            assertEquals(MergeResult.Forbidden, merger.mergeVariants("a", "b"))
            server.close()
            assertEquals(MergeResult.NoNetwork, merger.mergeVariants("a", "b"))
            assertEquals(0, syncs)
        }

    @Test
    fun candidatesAreOtherLiveRowsMatchingEveryWord() =
        runTest {
            fun product(
                id: String,
                name: String,
                brand: String?,
                key: String,
                deletedAt: Long? = null,
            ) = ProductEntity(id = id, name = name, brand = brand, displayUnit = "L", searchKey = key, createdAt = 1, updatedAt = 1, deletedAt = deletedAt)
            db.products().upsertAll(
                listOf(
                    product("a", "Leche Lala", "Lala", "leche lala lala"),
                    product("b", "Leche Alpura", "Alpura", "leche alpura alpura"),
                    product("c", "Café", null, "cafe"),
                    product("d", "Leche vieja", null, "leche vieja", deletedAt = 3),
                ),
            )
            db.variants().upsertAll(
                listOf("a" to "1 L", "b" to "1 L", "b" to "6 × 1 L", "c" to "1 kg").mapIndexed { i, (p, label) ->
                    VariantEntity(id = "v$i", productId = p, label = label, measure = if (p == "c") "mass" else "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)
                },
            )
            val query = MutableStateFlow("")
            // Itself and deleted products are out; the rest by search_key, as the catalog.
            assertEquals(listOf("c", "b"), merger.productCandidates("a", query).first().map { it.id })
            query.value = "LECHE"
            assertEquals(listOf(MergeCandidate("b", "Leche Alpura", "Alpura")), merger.productCandidates("a", query).first())
            // Variants: same measure only, and the label counts as text too.
            query.value = "alpura 6"
            assertEquals(listOf(MergeCandidate("v2", "Leche Alpura", "6 × 1 L")), merger.variantCandidates("v0", Measure.VOLUME, query).first())
            query.value = ""
            assertEquals(listOf("v1", "v2"), merger.variantCandidates("v0", Measure.VOLUME, query).first().map { it.id })
        }
}
