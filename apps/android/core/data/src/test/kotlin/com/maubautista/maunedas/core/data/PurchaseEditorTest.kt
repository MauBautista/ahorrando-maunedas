package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.pricing.Promotions
import com.maubautista.maunedas.core.sync.LocalWriter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PurchaseEditorTest {
    private var now = 1_000_000L
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { now }
    private val editor = PurchaseEditor(db, LocalWriter(db, clock, { "u1" }, { }), clock)

    @After
    fun close() = db.close()

    private lateinit var shampoo: LineVariant
    private lateinit var queso: LineVariant
    private lateinit var tele: LineVariant

    @Before
    fun seed() =
        runTest {
            db.stores().upsertAll(
                listOf("soriana" to "Soriana", "costco" to "Costco", "oxxo" to "OXXO").map { (id, name) ->
                    StoreEntity(id = id, name = name, kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)
                },
            )
            db.products().upsertAll(
                listOf(
                    ProductEntity(id = "p1", name = "Shampoo Herbal", brand = "Herbal", displayUnit = "L", searchKey = "shampoo herbal herbal", createdAt = 1, updatedAt = 1),
                    ProductEntity(id = "p2", name = "Queso Oaxaca", displayUnit = "kg", searchKey = "queso oaxaca", createdAt = 1, updatedAt = 1),
                    ProductEntity(id = "p3", name = "Televisión", displayUnit = "pz", searchKey = "television", createdAt = 1, updatedAt = 1),
                ),
            )
            db.variants().upsertAll(
                listOf(
                    VariantEntity(id = "v1", productId = "p1", label = "400 ml", measure = "volume", unitAmount = 400.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                    VariantEntity(id = "v2", productId = "p2", label = "A granel (kg)", measure = "mass", unitAmount = 1000.0, packCount = 1, soldByWeight = 1, createdAt = 1, updatedAt = 1),
                    VariantEntity(id = "v3", productId = "p3", label = "55 pulgadas", measure = "count", unitAmount = 1.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                ),
            )
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b", variantId = "v3", code = "7501234567890", source = "manual", createdAt = 1, updatedAt = 1)))
            shampoo = editor.variant("v1")!!
            queso = editor.variant("v2")!!
            tele = editor.variant("v3")!!
        }

    private fun draft() =
        PurchaseDraft(
            storeId = "soriana",
            purchasedAt = 5_000,
            lines =
                listOf(
                    // 2x1 of $89.00.
                    PurchaseLine(
                        variant = shampoo, quantity = 2.0, unitPriceCents = 8_900,
                        promotion = LinePromotion(type = PromoType.NXM, params = PromoParams(n = 2.0, m = 1.0), discountCents = Promotions.discount(PromoType.NXM, PromoParams(n = 2.0, m = 1.0), 2.0, 8_900)),
                    ),
                    // RF-COM-04: 0.845 kg × $32.90 = $27.80.
                    PurchaseLine(variant = queso, quantity = 0.845, unitPriceCents = 3_290),
                    // MSI is recorded but does not change the price.
                    PurchaseLine(variant = tele, quantity = 1.0, unitPriceCents = 999_000, promotion = LinePromotion(type = PromoType.MSI, params = PromoParams(months = 6.0), discountCents = 0)),
                ),
            ticketDiscounts = listOf(TicketDiscount(description = "Cupón app", amountCents = 500)),
            ticketTotalCents = 1_011_180,
        )

    @Test
    fun aNewPurchaseWritesItsLinesPromotionsAndTicketDiscount() =
        runTest {
            val id = editor.save(draft())
            val p = db.purchases().byId(id)!!
            assertEquals(listOf("soriana", "draft", "manual", "MXN"), listOf(p.storeId, p.status, p.source, p.currency))
            assertEquals(500L to 1_011_180L, p.discountCents to p.totalCents)
            val items = db.purchaseItems().liveOfPurchase(id).sortedBy { it.lineNo }
            assertEquals(
                listOf(listOf(1L, 17_800L, 8_900L, 8_900L), listOf(2L, 2_780L, 0L, 2_780L), listOf(3L, 999_000L, 0L, 999_000L)),
                items.map { listOf(it.lineNo, it.grossCents, it.discountCents, it.finalCents) },
            )
            val promos = db.promotions().liveOfPurchaseOrItems(id, items.map { it.id })
            val nxm = promos.single { it.type == "nxm" }
            assertEquals(Triple(items[0].id, """{"n":2,"m":1}""", 8_900L), Triple(nxm.purchaseItemId, nxm.params, nxm.discountCents))
            val msi = promos.single { it.type == "msi" }
            assertEquals(Triple("""{"months":6}""", 0L, 0), Triple(msi.params, msi.discountCents, msi.affectsPrice))
            val coupon = promos.single { it.purchaseId == id }
            assertEquals(Triple("coupon", "Cupón app", 500L), Triple(coupon.type, coupon.description, coupon.discountCents))
            assertEquals(listOf("promotions", "promotions", "promotions", "purchase_items", "purchase_items", "purchase_items", "purchases"), outbox())
        }

    @Test
    fun aSavedPurchaseLoadsBackAsItWasDrafted() =
        runTest {
            val id = editor.save(draft())
            val loaded = editor.load(id)!!
            val expected = draft()
            assertEquals(expected.lines.map { listOf(it.variant, it.quantity, it.unitPriceCents, it.promotion?.type, it.promotion?.params, it.amounts) }, loaded.lines.map { listOf(it.variant, it.quantity, it.unitPriceCents, it.promotion?.type, it.promotion?.params, it.amounts) })
            assertEquals(listOf("Cupón app" to 500L), loaded.ticketDiscounts.map { it.description to it.amountCents })
            assertEquals(Triple("soriana", 5_000L, 1_011_180L), Triple(loaded.storeId, loaded.purchasedAt, loaded.ticketTotalCents))
            // The shampoo cost $89.00 for 800 ml: $111.25 per liter.
            assertEquals(11_125L, loaded.lines[0].perUnitCents())
        }

    @Test
    fun editingRemovesWhatIsGoneAndConfirmingFeedsThePrices() =
        runTest {
            val id = editor.save(draft())
            val first = editor.load(id)!!
            now = 2_000_000
            val removedLine = first.lines[1].id!!
            val removedPromo = first.lines[0].promotion!!.id!!
            val edited =
                first.copy(
                    lines = listOf(first.lines[0].copy(promotion = null), first.lines[2]),
                    ticketDiscounts = listOf(first.ticketDiscounts[0].copy(amountCents = 1_000)),
                )
            editor.save(edited, confirm = true)
            assertEquals(2_000_000L, db.purchaseItems().byId(removedLine)!!.deletedAt)
            assertEquals(2_000_000L, db.promotions().byId(removedPromo)!!.deletedAt)
            val p = db.purchases().byId(id)!!
            assertEquals("confirmed" to 1_000L, p.status to p.discountCents)
            val items = db.purchaseItems().liveOfPurchase(id).sortedBy { it.lineNo }
            // Renumbered, and the shampoo is back to its full price.
            assertEquals(listOf(1L to 17_800L, 2L to 999_000L), items.map { it.lineNo to it.finalCents })
            // Confirmed: the coupon is prorated over the lines in v_price_points.
            val points = db.pricePoints().forVariant("v1")
            assertEquals(listOf(8_891L), points.map { it.effectiveUnitCents })
            assertEquals(1, db.promotions().liveOfPurchaseOrItems(id, items.map { it.id }).count { it.purchaseId == id })
        }

    @Test
    fun deletingAPurchaseTakesItsLinesAndPromotions() =
        runTest {
            val id = editor.save(draft())
            val items = db.purchaseItems().liveOfPurchase(id)
            now = 3_000_000
            editor.delete(id)
            assertNull(editor.load(id))
            assertEquals(emptyList<Any>(), db.purchaseItems().liveOfPurchase(id))
            assertEquals(emptyList<Any>(), db.promotions().liveOfPurchaseOrItems(id, items.map { it.id }))
        }

    @Test
    fun searchFindsByWordsOrBarcodeWithTheLastPriceAtTheStore() =
        runTest {
            editor.save(draft(), confirm = true)
            val found = editor.searchVariants("SHAMP", "soriana")
            assertEquals(listOf("v1" to 8_900L), found.map { it.variant.id to it.lastPriceCents })
            // The label counts as text too, and another store has no price yet.
            assertEquals(listOf("v2" to null), editor.searchVariants("queso granel", "costco").map { it.variant.id to it.lastPriceCents })
            assertEquals(listOf("v3"), editor.searchVariants("7501234567890", null).map { it.variant.id })
            assertEquals(emptyList<VariantChoice>(), editor.searchVariants("   ", "soriana"))
        }

    @Test
    fun storesComeByRecentUseAndNewOnesCanBeAdded() =
        runTest {
            editor.save(draft().copy(storeId = "oxxo", purchasedAt = 10))
            editor.save(draft().copy(storeId = "soriana", purchasedAt = 20))
            assertEquals(listOf("Soriana", "OXXO", "Costco"), editor.storesByRecentUse().first().map { it.name })
            assertEquals("Puebla", editor.defaultBranchCity())
            val store = editor.createStore(" Mercado ", "physical")
            val branch = editor.createBranch(store.id, "Centro", "San Pedro Cholula")
            editor.save(draft().copy(storeId = store.id, branchId = branch.id, purchasedAt = 30))
            assertEquals(listOf(BranchChoice(branch.id, "Centro", "San Pedro Cholula")), editor.branchesOf(store.id).first())
            assertEquals("San Pedro Cholula", editor.defaultBranchCity())
            assertEquals("Mercado", editor.storesByRecentUse().first().first().name)
        }

    private suspend fun outbox() = db.outbox().nextBatch(100, Long.MAX_VALUE).map { it.tableName }.sorted()
}
