package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer

internal class FixedClock(var now: Long = 1_792_389_600_000L) : Clock {
    override fun nowMillis() = now
}

internal const val ME = "0192a5e9-0000-7000-8000-00000000a0a0"

/** Room in memory, a fixed clock, a signed-in user and, when needed, the real API against MockWebServer. */
internal class TestEnv(server: MockWebServer? = null) {
    val context: Context = ApplicationProvider.getApplicationContext()
    val db: AppDatabase = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    val clock = FixedClock()
    var userId: String? = ME
    val user = CurrentUser { userId }
    var syncRequests = 0
    val requester = SyncRequester { syncRequests++ }
    val writer = LocalWriter(db, clock, user, requester)
    val status = SyncStatusStore(ApplicationProvider.getApplicationContext())
    val applier = PullApplier(db, MaunedasJson)
    val conflicts = ConflictHandler(db, MaunedasJson, clock, status)
    val deviceId = DeviceIdStore(context)
    val engine: SyncEngine? =
        server?.let {
            val tokens = IdTokenProvider { "token" }
            val http = createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens))
            val api = createMaunedasApi(ApiConfig(it.url("/").toString()), http, MaunedasJson)
            SyncEngine(db, api, MaunedasJson, clock, applier, conflicts, deviceId)
        }
    val uploads: UploadEngine? =
        server?.let {
            val tokens = IdTokenProvider { "token" }
            val http = createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens))
            UploadEngine(db, createMaunedasApi(ApiConfig(it.url("/").toString()), http, MaunedasJson), MaunedasJson, clock)
        }

    fun close() = db.close()
}

internal fun json(
    code: Int,
    body: String,
) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

internal const val EMPTY_PULL = """{"changes":{},"cursors":{},"has_more":false,"server_time":1,"schema_version":1}"""

internal fun tag(
    id: String,
    name: String = id,
    at: Long = 1,
) = TagEntity(id = id, name = name, createdAt = at, updatedAt = at)

internal fun product(
    id: String,
    at: Long = 1,
) = ProductEntity(id = id, name = id, displayUnit = "L", searchKey = id, createdAt = at, updatedAt = at)

internal fun variant(
    id: String,
    productId: String,
) = VariantEntity(id = id, productId = productId, label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)

internal fun barcode(
    id: String,
    variantId: String,
) = BarcodeEntity(id = id, variantId = variantId, code = "750$id", source = "scan", createdAt = 1, updatedAt = 1)
