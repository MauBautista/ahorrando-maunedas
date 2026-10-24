package com.maubautista.maunedas.feature.purchases

import android.content.Context
import android.graphics.Bitmap
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.LocalWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** RF-TIC-01 in the editor: the store first, the purchase saved before its pages, at most four. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReceiptPhotoTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dispatcher = StandardTestDispatcher()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).setQueryCoroutineContext(dispatcher).allowMainThreadQueries().build()
    private val clock = Clock { 1_000_000L }
    private val editor = PurchaseEditor(db, LocalWriter(db, clock, { "u1" }, { }), clock)

    @Before
    fun setUp() =
        runTest(dispatcher) {
            Dispatchers.setMain(dispatcher)
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
    }

    private fun TestScope.open(receipt: Boolean = false) =
        PurchaseEditorViewModel(SavedStateHandle(mapOf("receipt" to receipt)), editor, scanRepository(db, clock), receiptPhotos(db, clock), LocalPhotos(context), clock).also { advanceUntilIdle() }

    /** A camera-sized JPEG in the capture folder, as the scanner leaves it. */
    private fun shot(name: String) =
        File(context.cacheDir, "capture/$name.jpg").apply {
            parentFile?.mkdirs()
            outputStream().use { Bitmap.createBitmap(1200, 2400, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, it) }
        }

    /** Reduction runs on the IO dispatcher: let both sides run until [done], for at most 5 s. */
    private fun TestScope.await(done: () -> Boolean) {
        repeat(250) {
            advanceUntilIdle()
            if (done()) return
            Thread.sleep(20)
        }
        throw AssertionError("No terminó")
    }

    @Test
    fun fromInicioTheStoreComesFirstThenTheScannerOpens() =
        runTest(dispatcher) {
            val vm = open(receipt = true)
            val scans = mutableListOf<Int>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.receiptScans.toList(scans) }
            assertEquals(R.string.editor_store_first to true, vm.state.value.problem to vm.state.value.pickStore)
            vm.storePickerShown()
            assertEquals(false, vm.state.value.pickStore)
            assertEquals(emptyList<Int>(), scans)
            vm.chooseStore(StoreChoice("s", "Soriana"))
            advanceUntilIdle()
            // Four pages free on a new purchase; asking again does not reopen it by itself.
            assertEquals(listOf(4), scans)
        }

    @Test
    fun aNewPurchaseIsSavedBeforeItsPagesAndTheyCountAgainstFour() =
        runTest(dispatcher) {
            val vm = open()
            val scans = mutableListOf<Int>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.receiptScans.toList(scans) }
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.receiptPages.collect { } }
            vm.chooseStore(StoreChoice("s", "Soriana"))
            vm.onReceiptPages(listOf(shot("one"), shot("two"), shot("three")))
            await { vm.receiptPages.value.size == 3 }
            val id = vm.state.value.draft.id!!
            assertEquals("draft", db.purchases().byId(id)!!.status)
            // Reduced as receipts: the longest side is 1600 px.
            val first = vm.receiptPages.value.first().photo as File
            assertTrue(first.path.endsWith("/original.jpg"))
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }.also { android.graphics.BitmapFactory.decodeFile(first.path, it) }
            assertEquals(800 to 1600, bounds.outWidth to bounds.outHeight)
            vm.requestReceipt()
            advanceUntilIdle()
            assertEquals(listOf(1), scans)
            vm.removeReceiptPage(vm.receiptPages.value[1].imageId)
            await { vm.receiptPages.value.size == 2 }
            // Something that is not a photo says so.
            vm.onReceiptPages(listOf(File(context.cacheDir, "capture/junk.jpg").apply { writeText("x") }))
            await { vm.state.value.problem != null }
            assertEquals(R.string.editor_receipt_failed, vm.state.value.problem)
        }
}
