package com.maubautista.maunedas.feature.shelf

import android.content.Context
import android.graphics.Bitmap
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.ShelfDraft
import com.maubautista.maunedas.core.data.ShelfRepository
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.UploadQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShelfViewModelTest {
    /** Room and the view model on one test dispatcher: `advanceUntilIdle` finishes every write. */
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dispatcher = StandardTestDispatcher()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).setQueryCoroutineContext(dispatcher).allowMainThreadQueries().build()
    private val clock = Clock { 1_000_000L }
    private val writer = LocalWriter(db, clock, { "u1" }, { })
    private val photos = LocalPhotos(context)
    private val shelf = ShelfRepository(db, writer, clock, { "u1" }, photos, UploadQueue(db, clock) { })
    private val editor = PurchaseEditor(db, writer, clock)

    @Before
    fun setUp() =
        runTest(dispatcher) {
            Dispatchers.setMain(dispatcher)
            db.stores().upsertAll(
                listOf(
                    StoreEntity(id = "s", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                    StoreEntity(id = "c", name = "Costco", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                ),
            )
            db.products().upsertAll(listOf(ProductEntity(id = "p", name = "Leche Lala", displayUnit = "L", searchKey = "leche lala", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v", productId = "p", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b", variantId = "v", code = "7501020515343", source = "scan", createdAt = 1, updatedAt = 1)))
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
    }

    private fun TestScope.open(variantId: String? = null): ShelfViewModel =
        ShelfViewModel(SavedStateHandle(listOfNotNull(variantId?.let { "variantId" to it }).toMap()), shelf, editor, photos).also { advanceUntilIdle() }

    /** The photo is reduced on the IO dispatcher: let both sides run until [done], for at most 5 s. */
    private fun TestScope.await(done: () -> Boolean) {
        repeat(250) {
            advanceUntilIdle()
            if (done()) return
            Thread.sleep(20)
        }
        throw AssertionError("No terminó")
    }

    private fun shelfRows(): List<List<Any?>> =
        db.openHelper.readableDatabase.query("SELECT variant_id, store_id, price_cents, effective_price_cents, promo_text FROM price_observations ORDER BY id").use { c ->
            buildList { while (c.moveToNext()) add(listOf(c.getString(0), c.getString(1), c.getLong(2), if (c.isNull(3)) null else c.getLong(3), c.getString(4))) }
        }

    @Test
    fun fromTheScannerTheVariantIsThereAndTheStoreIsMyLastOne() =
        runTest(dispatcher) {
            shelf.save(ShelfDraft("v", "c", null, 2_500))
            advanceUntilIdle()
            val vm = open("v")
            assertEquals("1 L", vm.state.value.variant?.label)
            assertEquals("c", vm.state.value.storeId)
            assertFalse(vm.state.value.loading)
        }

    @Test
    fun aVariantIsFoundByWordsOrByItsCode() =
        runTest(dispatcher) {
            val vm = open()
            assertNull(vm.state.value.storeId)
            vm.onQuery("leche")
            advanceUntilIdle()
            vm.chooseVariant(vm.state.value.results.single())
            assertEquals("v", vm.state.value.variant?.id)
            vm.changeVariant()
            vm.onCode("00000000")
            advanceUntilIdle()
            assertEquals("00000000", vm.state.value.unknownCode)
            vm.onCode("7501020515343")
            advanceUntilIdle()
            assertEquals("v" to null, vm.state.value.variant?.id to vm.state.value.unknownCode)
        }

    @Test
    fun savingChecksWhatIsMissingThenWritesTheShelfPriceAndLeaves() =
        runTest(dispatcher) {
            val vm = open()
            var left = false
            backgroundScope.launch { vm.done.first().also { left = true } }
            vm.save(another = false, promoText = null)
            assertEquals(R.string.shelf_need_variant, vm.state.value.error)
            vm.onCode("7501020515343")
            advanceUntilIdle()
            vm.save(another = false, promoText = null)
            assertEquals(R.string.shelf_need_store, vm.state.value.error)
            vm.chooseStore(StoreChoice("s", "Soriana"))
            vm.save(another = false, promoText = null)
            assertEquals(R.string.shelf_need_price, vm.state.value.error)
            vm.onPrice(8_900)
            vm.onPromo(PromoType.NXM)
            vm.onParams { it.copy(n = 2.0, m = 1.0) }
            assertEquals(4_450L, vm.state.value.effectiveCents)
            // $44.50 per liter.
            assertEquals(4_450L, vm.state.value.perUnitCents())
            vm.save(another = false, promoText = "2x1")
            advanceUntilIdle()
            assertEquals(listOf(listOf<Any?>("v", "s", 8_900L, 4_450L, "2x1")), shelfRows())
            assertTrue(left)
        }

    @Test
    fun saveAndAnotherKeepsTheStoreForTheNextPrice() =
        runTest(dispatcher) {
            val vm = open("v")
            vm.chooseStore(StoreChoice("s", "Soriana"))
            vm.onPrice(2_800)
            vm.onPromo(PromoType.PERCENT)
            // Changing the type starts its parameters over.
            vm.onParams { it.copy(percent = 10.0) }
            vm.onPromo(PromoType.NXM)
            assertNull(vm.state.value.params.percent)
            vm.onPromo(null)
            vm.save(another = true, promoText = "ignored without a promotion")
            advanceUntilIdle()
            val s = vm.state.value
            assertEquals(listOf<Any?>(null, "s", null, null, 1, false), listOf(s.variant, s.storeId, s.priceCents, s.promoType, s.saved, s.saving))
            assertEquals(listOf(listOf<Any?>("v", "s", 2_800L, null, null)), shelfRows())
        }

    @Test
    fun aPhotoIsReducedAndLeavingDiscardsIt() =
        runTest(dispatcher) {
            val vm = open("v")
            val taken = File(context.cacheDir, "capture/shot.jpg").apply { parentFile?.mkdirs() }
            taken.outputStream().use { Bitmap.createBitmap(80, 60, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, it) }
            vm.onPhoto(taken)
            await { vm.state.value.photoPath != null }
            val path = vm.state.value.photoPath!!
            assertTrue(File(path).exists())
            assertFalse(taken.exists())
            vm.leave()
            assertNull(vm.state.value.photoPath)
            assertFalse(File(path).exists())
            // Something that is not a photo says so.
            vm.onPhoto(File(context.cacheDir, "capture/junk.jpg").apply { writeText("x") })
            await { vm.state.value.error != null }
            assertEquals(R.string.shelf_photo_failed, vm.state.value.error)
        }
}
