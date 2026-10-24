package com.maubautista.maunedas.feature.purchases

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.ProductPageRepository
import com.maubautista.maunedas.core.data.ProductPhotos
import com.maubautista.maunedas.core.data.ReceiptPhotos
import com.maubautista.maunedas.core.data.ScanRepository
import com.maubautista.maunedas.core.database.AppDatabase
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
import com.maubautista.maunedas.core.sync.UploadQueue

/** The real scan repository over [db], asking the Worker at [baseUrl] (a mock server, or nothing listening). */
internal fun scanRepository(
    db: AppDatabase,
    clock: Clock,
    baseUrl: String = "http://127.0.0.1:9/",
): ScanRepository {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val tokens = IdTokenProvider { "token" }
    val api = createMaunedasApi(ApiConfig(baseUrl), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
    return ScanRepository(db, api, SyncScheduler(context, db), ProductPageRepository(db, clock, ProductPhotos(context, db, ApiConfig(baseUrl))))
}

/** The real receipt pages over [db], with photos kept in the test's files folder. */
internal fun receiptPhotos(
    db: AppDatabase,
    clock: Clock,
): ReceiptPhotos {
    val context = ApplicationProvider.getApplicationContext<Context>()
    return ReceiptPhotos(db, LocalWriter(db, clock, { "u1" }, { }), clock, LocalPhotos(context), ProductPhotos(context, db, ApiConfig("https://api.test")), UploadQueue(db, clock) { })
}
