package com.maubautista.maunedas.feature.purchases

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.LocalWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** S-04's rules over the real editor and Room in memory. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PurchaseEditorViewModelTest {
    /** Room and the view model on one test dispatcher: `advanceUntilIdle` finishes every write. */
    private val dispatcher = StandardTestDispatcher()
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java)
            .setQueryCoroutineContext(dispatcher)
            .allowMainThreadQueries()
            .build()
    private val clock = Clock { 1_000_000L }
    private val editor = PurchaseEditor(db, LocalWriter(db, clock, { "u1" }, { }), clock)
    private lateinit var vm: PurchaseEditorViewModel

    @Before
    fun setUp() =
        runTest(dispatcher) {
            Dispatchers.setMain(dispatcher)
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(listOf(ProductEntity(id = "p", name = "Leche", displayUnit = "L", searchKey = "leche", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v", productId = "p", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            vm = PurchaseEditorViewModel(SavedStateHandle(), editor, scanRepository(db, clock), receiptPhotos(db, clock), LocalPhotos(context), clock)
            advanceUntilIdle()
        }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        db.close()
    }

    private fun purchases() = db.openHelper.readableDatabase.query("SELECT count(*) FROM purchases").use { it.moveToFirst(); it.getInt(0) }

    private suspend fun TestScope.addLine(price: Long = 2_850) {
        vm.newLine()
        val choice = editor.searchVariants("leche", "s").single()
        vm.onLine { it.withVariant(choice).withPrice(price) }
        vm.saveLine(another = false)
        advanceUntilIdle()
    }

    @Test
    fun confirmingNeedsAStoreAndALine() =
        runTest(dispatcher) {
            vm.confirm()
            advanceUntilIdle()
            assertEquals(R.string.editor_need_store, vm.state.value.problem)
            vm.newLine()
            assertEquals(R.string.editor_store_first, vm.state.value.problem)
            vm.chooseStore(StoreChoice("s", "Soriana"))
            vm.confirm()
            advanceUntilIdle()
            assertEquals(R.string.editor_need_lines, vm.state.value.problem)
            addLine()
            vm.confirm()
            advanceUntilIdle()
            assertEquals("confirmed", db.purchases().byId(vm.state.value.draft.id!!)!!.status)
        }

    @Test
    fun ticketDiscountsThatReachTheLinesDoNotConfirmButSaveAsDraft() =
        runTest(dispatcher) {
            vm.chooseStore(StoreChoice("s", "Soriana"))
            addLine(2_850)
            // Equal to the lines: every line would enter the price history at $0 (decision T41).
            vm.newDiscount()
            vm.onDiscount { it.copy(description = "Cupón", amountCents = 2_850) }
            vm.saveDiscount("Descuento")
            vm.confirm()
            advanceUntilIdle()
            assertEquals(R.string.editor_discounts_exceed, vm.state.value.problem)
            assertEquals(0, purchases())
            vm.editDiscount(0)
            vm.onDiscount { it.copy(amountCents = 2_849) }
            vm.saveDiscount("Descuento")
            assertEquals(null, vm.state.value.problem)
            vm.editDiscount(0)
            vm.onDiscount { it.copy(amountCents = 9_000) }
            vm.saveDiscount("Descuento")
            vm.confirm()
            advanceUntilIdle()
            assertEquals(R.string.editor_discounts_exceed, vm.state.value.problem)
            assertEquals(0, purchases())
            vm.saveDraft()
            advanceUntilIdle()
            assertEquals("draft", db.purchases().byId(vm.state.value.draft.id!!)!!.status)
        }

    @Test
    fun aTotalThatDoesNotMatchAsksFirst() =
        runTest(dispatcher) {
            vm.chooseStore(StoreChoice("s", "Soriana"))
            addLine(2_850)
            vm.setTicketTotal(3_000)
            vm.confirm()
            advanceUntilIdle()
            assertEquals(150L, vm.state.value.mismatchCents)
            assertEquals(0, purchases())
            vm.confirmAnyway()
            advanceUntilIdle()
            assertEquals(1, purchases())
        }

    @Test
    fun aRemovedLineComesBackWithUndo() =
        runTest(dispatcher) {
            vm.chooseStore(StoreChoice("s", "Soriana"))
            addLine(1_000)
            addLine(2_000)
            vm.removeLine(0)
            assertEquals(listOf(2_000L), vm.state.value.draft.lines.map { it.unitPriceCents })
            vm.undoRemove()
            assertEquals(listOf(1_000L, 2_000L), vm.state.value.draft.lines.map { it.unitPriceCents })
        }

    @Test
    fun leavingSavesOnceAndNothingWhenEmpty() =
        runTest(dispatcher) {
            vm.leave()
            advanceUntilIdle()
            vm.autosave()
            advanceUntilIdle()
            assertEquals(0, purchases())
            vm.chooseStore(StoreChoice("s", "Soriana"))
            addLine()
            // Back and the app going to the background together (both pending at once) still create one purchase.
            vm.leave()
            vm.autosave()
            advanceUntilIdle()
            assertEquals(1, purchases())
            val id = vm.state.value.draft.id!!
            assertEquals("draft", db.purchases().byId(id)!!.status)
            // Leaving again without changes writes nothing new.
            val before = db.purchases().byId(id)!!.updatedAt
            vm.autosave()
            advanceUntilIdle()
            assertEquals(before, db.purchases().byId(id)!!.updatedAt)
            assertNull(vm.state.value.problem)
        }

    @Test
    fun linesMoveUpAndDownWithinTheList() =
        runTest(dispatcher) {
            vm.chooseStore(StoreChoice("s", "Soriana"))
            addLine(1_000)
            addLine(2_000)
            addLine(3_000)
            vm.moveLine(2, -1)
            assertEquals(listOf(1_000L, 3_000L, 2_000L), vm.state.value.draft.lines.map { it.unitPriceCents })
            vm.moveLine(0, 1)
            assertEquals(listOf(3_000L, 1_000L, 2_000L), vm.state.value.draft.lines.map { it.unitPriceCents })
            // Past either end nothing moves.
            vm.moveLine(0, -1)
            assertEquals(listOf(3_000L, 1_000L, 2_000L), vm.state.value.draft.lines.map { it.unitPriceCents })
            vm.moveLine(2, 1)
            assertEquals(listOf(3_000L, 1_000L, 2_000L), vm.state.value.draft.lines.map { it.unitPriceCents })
        }
}
