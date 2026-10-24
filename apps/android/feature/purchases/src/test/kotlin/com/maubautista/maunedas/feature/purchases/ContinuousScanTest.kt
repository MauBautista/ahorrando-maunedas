package com.maubautista.maunedas.feature.purchases

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.PurchaseLine
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.sync.LocalWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
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

/** RF-COM-09 over the real editor and scan repository: Room in memory and a mock Worker. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ContinuousScanTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dispatcher = StandardTestDispatcher()
    private val server = MockWebServer()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).setQueryCoroutineContext(dispatcher).allowMainThreadQueries().build()
    private val clock = Clock { 1_000_000L }
    private val editor = PurchaseEditor(db, LocalWriter(db, clock, { "u1" }, { }), clock)
    private lateinit var vm: PurchaseEditorViewModel

    @Before
    fun setUp() =
        runTest(dispatcher) {
            Dispatchers.setMain(dispatcher)
            server.start()
            WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(
                listOf(
                    ProductEntity(id = "p", name = "Leche Lala", displayUnit = "L", searchKey = "leche lala", createdAt = 1, updatedAt = 1),
                    ProductEntity(id = "q", name = "Jitomate", displayUnit = "kg", searchKey = "jitomate", createdAt = 1, updatedAt = 1),
                ),
            )
            db.variants().upsertAll(
                listOf(
                    VariantEntity(id = "v", productId = "p", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                    VariantEntity(id = "w", productId = "q", label = "A granel (kg)", measure = "mass", unitAmount = 1000.0, packCount = 1, soldByWeight = 1, createdAt = 1, updatedAt = 1),
                ),
            )
            db.barcodes().upsertAll(
                listOf(
                    BarcodeEntity(id = "b1", variantId = "v", code = "7501020515343", source = "scan", createdAt = 1, updatedAt = 1),
                    BarcodeEntity(id = "b2", variantId = "w", code = "2000000000015", source = "manual", createdAt = 1, updatedAt = 1),
                ),
            )
            // The milk's last price at Soriana is $28.50.
            val milk = editor.variant("v")!!
            editor.save(PurchaseDraft(storeId = "s", purchasedAt = 1_000, lines = listOf(PurchaseLine(variant = milk, quantity = 1.0, unitPriceCents = 2_850))), confirm = true)
            vm = PurchaseEditorViewModel(SavedStateHandle(), editor, scanRepository(db, clock, server.url("/").toString()), receiptPhotos(db, clock), LocalPhotos(context), clock)
            advanceUntilIdle()
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
        server.close()
    }

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    /** The mock server answers on OkHttp's threads: let both sides run until [done], for at most 5 s. */
    private fun TestScope.await(done: () -> Boolean) {
        repeat(250) {
            advanceUntilIdle()
            if (done()) return
            Thread.sleep(20)
        }
        throw AssertionError("No llegó: ${vm.state.value.scan} ${vm.state.value.pending}")
    }

    private fun lines() = vm.state.value.draft.lines.map { listOf(it.variant?.id, it.quantity, it.unitPriceCents) }

    private fun TestScope.scanning() {
        vm.chooseStore(StoreChoice("s", "Soriana"))
        vm.startScanning()
        advanceUntilIdle()
    }

    @Test
    fun scanningNeedsTheStoreFirst() =
        runTest(dispatcher) {
            vm.startScanning()
            assertEquals(R.string.editor_store_first, vm.state.value.problem)
            assertNull(vm.state.value.scan)
        }

    @Test
    fun eachCodeIsALineAtItsLastPriceAndTheSameProductCountsOneMore() =
        runTest(dispatcher) {
            scanning()
            vm.onScannedCode("7501020515343")
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("v", 1.0, 2_850L)), lines())
            assertEquals(0 to 1, vm.state.value.scan!!.lineIndex to vm.state.value.scan!!.reads)
            vm.onScannedCode("7501020515343")
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("v", 2.0, 2_850L)), lines())
            // The price typed is the scanned line's; the stepper never goes under one.
            vm.onScanPrice(2_990)
            vm.onScanStep(-5)
            assertEquals(listOf(listOf<Any?>("v", 1.0, 2_990L)), lines())
            // Something weighed is always a new line, without a price here yet.
            vm.onScannedCode("2000000000015")
            advanceUntilIdle()
            vm.onScanKilos(0.845)
            vm.onScannedCode("2000000000015")
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("v", 1.0, 2_990L), listOf<Any?>("w", 0.845, 0L), listOf<Any?>("w", 1.0, 0L)), lines())
            assertEquals(2 to 4, vm.state.value.scan!!.lineIndex to vm.state.value.scan!!.reads)
            vm.stopScanning()
            assertNull(vm.state.value.scan)
            assertEquals(3, vm.state.value.draft.lines.size)
            // No request was needed: every code was here.
            assertEquals(0, server.requestCount)
        }

    @Test
    fun aLineWithAPromotionIsNotCountedAgainAndAPurchaseWithoutPricesCannotBeConfirmed() =
        runTest(dispatcher) {
            vm.chooseStore(StoreChoice("s", "Soriana"))
            // A 2x1 typed in the line sheet.
            vm.newLine()
            val choice = editor.searchVariants("leche", "s").single()
            vm.onLine { it.withVariant(choice).withQuantity(2.0).withPromo(PromoType.NXM).withParams { p -> p.copy(n = 2.0, m = 1.0) } }
            vm.saveLine(another = false)
            vm.startScanning()
            vm.onScannedCode("7501020515343")
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("v", 2.0, 2_850L), listOf<Any?>("v", 1.0, 2_850L)), lines())
            vm.onScanPrice(null)
            vm.stopScanning()
            vm.confirm()
            assertEquals(R.string.editor_need_prices, vm.state.value.problem)
        }

    @Test
    fun aCodeOnTheServerIsPulledAndBecomesALineWhenItArrives() =
        runTest(dispatcher) {
            scanning()
            server.enqueue(json("""{"code":"7501000000017","match":{"variant_id":"x","product_id":"r","product_name":"Café Legal","variant_label":"400 g"},"catalog":null}"""))
            vm.onScannedCode("7501000000017")
            await { vm.state.value.pending.isNotEmpty() }
            assertEquals(listOf(PendingCode("7501000000017", "Café Legal · 400 g")), vm.state.value.pending)
            assertEquals(1, WorkManager.getInstance(context).getWorkInfosForUniqueWork("sync-now").get().size)
            // Read again while it waits: not looked up twice.
            vm.onScannedCode("7501000000017")
            advanceUntilIdle()
            assertNull(vm.state.value.scan!!.looking)
            assertEquals(1, server.requestCount)
            // The pull brings it.
            db.products().upsertAll(listOf(ProductEntity(id = "r", name = "Café Legal", displayUnit = "kg", searchKey = "cafe legal", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "x", productId = "r", label = "400 g", measure = "mass", unitAmount = 400.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b3", variantId = "x", code = "7501000000017", source = "scan", createdAt = 1, updatedAt = 1)))
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("x", 1.0, 0L)), lines())
            assertEquals(emptyList<PendingCode>(), vm.state.value.pending)
        }

    @Test
    fun anUnknownCodeWaitsUntilItIsAddedToTheCatalogEvenAfterClosingTheCamera() =
        runTest(dispatcher) {
            scanning()
            server.enqueue(json("""{"code":"12345678","match":null,"catalog":null}"""))
            vm.onScannedCode("12345678")
            await { vm.state.value.pending.isNotEmpty() }
            assertEquals(listOf(PendingCode("12345678", null)), vm.state.value.pending)
            server.close()
            vm.onScannedCode("87654321")
            await { vm.state.value.pending.size == 2 }
            assertEquals(PendingCode("87654321", null, offline = true), vm.state.value.pending[1])
            // "Darlo de alta" (S-12) adds it to the catalog while the purchase waits.
            vm.stopScanning()
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b4", variantId = "v", code = "12345678", source = "scan", createdAt = 1, updatedAt = 1)))
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("v", 1.0, 2_850L)), lines())
            // What still waits stays for the next time the camera opens, until it is taken off the list.
            assertEquals(listOf("87654321"), vm.state.value.pending.map { it.code })
            vm.dismissPending("87654321")
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b5", variantId = "v", code = "87654321", source = "scan", createdAt = 1, updatedAt = 1)))
            advanceUntilIdle()
            assertEquals(emptyList<PendingCode>(), vm.state.value.pending)
            // Not waited for any more: the purchase stays as it was.
            assertEquals(listOf(listOf<Any?>("v", 1.0, 2_850L)), lines())
        }
}
