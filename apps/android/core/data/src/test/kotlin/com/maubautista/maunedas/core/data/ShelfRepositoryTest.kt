package com.maubautista.maunedas.core.data

import android.content.Context
import android.graphics.Bitmap
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.UploadQueue
import kotlinx.coroutines.test.runTest
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

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShelfRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private var now = 1_000L
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { now }
    private var me = "u1"
    private val photos = LocalPhotos(context)
    private val shelf = ShelfRepository(db, LocalWriter(db, clock, { me }, { }), clock, { me }, photos, UploadQueue(db, clock) { })

    @After
    fun close() = db.close()

    @Before
    fun seed() =
        runTest {
            db.products().upsertAll(listOf(ProductEntity(id = "p", name = "Shampoo", displayUnit = "L", searchKey = "shampoo", createdAt = 1, updatedAt = 1)))
            db.variants().upsertAll(listOf(VariantEntity(id = "v", productId = "p", label = "400 ml", measure = "volume", unitAmount = 400.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)))
            db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b", variantId = "v", code = "7501234567890", source = "scan", createdAt = 1, updatedAt = 1)))
        }

    /** type, params, discount and affects_price of the observation's live promotions. */
    private fun promotionsOf(observationId: String): List<List<Any?>> =
        db.openHelper.readableDatabase.query("SELECT type, params, discount_cents, affects_price FROM promotions WHERE observation_id = ? AND deleted_at IS NULL", arrayOf(observationId)).use { c ->
            buildList { while (c.moveToNext()) add(listOf(c.getString(0), c.getString(1), c.getLong(2), c.getInt(3))) }
        }

    private fun outboxTables(): List<String> =
        db.openHelper.readableDatabase.query("SELECT table_name FROM outbox ORDER BY seq").use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

    @Test
    fun aShelfPriceWithAPromotionFeedsThePricesAtItsEffectivePrice() =
        runTest {
            val id = shelf.save(ShelfDraft("v", "soriana", "centro", 8_900, PromoType.NXM, PromoParams(n = 2.0, m = 1.0), "2x1"))
            val o = db.priceObservations().byId(id)!!
            assertEquals(listOf("shelf", 8_900L, 4_450L, "2x1", 1_000L, "u1", "centro"), listOf(o.source, o.priceCents, o.effectivePriceCents, o.promoText, o.observedAt, o.updatedBy, o.branchId))
            // Per unit, as the observation's prices.
            assertEquals(listOf(listOf<Any?>("nxm", """{"n":2,"m":1}""", 4_450L, 1)), promotionsOf(id))
            assertEquals(listOf("price_observations", "promotions"), outboxTables())
            // v_price_points: the effective price is the one compared.
            val point = db.pricePoints().forVariant("v").single()
            assertEquals(listOf<Any?>("shelf", 4_450L, 8_900L, 1), listOf(point.source, point.effectiveUnitCents, point.listUnitCents, point.hasPromo))
        }

    @Test
    fun withoutAPromotionThereIsNoPromotionRowAndMsiChangesNothing() =
        runTest {
            val plain = shelf.save(ShelfDraft("v", "soriana", null, 3_000, promoText = "ignored without a promotion"))
            val o = db.priceObservations().byId(plain)!!
            assertEquals(listOf(null, null, null), listOf(o.effectivePriceCents, o.promoText, o.photoImageId))
            assertEquals(emptyList<Any>(), promotionsOf(plain))
            val msi = shelf.save(ShelfDraft("v", "soriana", null, 899_900, PromoType.MSI, PromoParams(months = 12.0), "12 meses sin intereses"))
            assertNull(db.priceObservations().byId(msi)!!.effectivePriceCents)
            assertEquals(listOf(listOf<Any?>("msi", """{"months":12}""", 0L, 0)), promotionsOf(msi))
            // A price cut keeps the shelf price as its "from".
            val cut = shelf.save(ShelfDraft("v", "soriana", null, 3_500, PromoType.PRICE_CUT, PromoParams(toCents = 2_990.0), "Rebaja a $29.90"))
            assertEquals(listOf(listOf<Any?>("price_cut", """{"from_cents":3500,"to_cents":2990}""", 510L, 1)), promotionsOf(cut))
        }

    @Test
    fun aPhotoIsKeptAsTheObservationsImageAndWaitsToBeUploaded() =
        runTest {
            val taken = File(context.cacheDir, "capture/shot.jpg").apply { parentFile?.mkdirs() }
            taken.outputStream().use { Bitmap.createBitmap(64, 48, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, it) }
            val reduced = photos.reduce(taken, LocalPhotos.Size.PRODUCT)!!
            val id = shelf.save(ShelfDraft("v", "soriana", null, 3_000, photoPath = reduced.path))
            val imageId = db.priceObservations().byId(id)!!.photoImageId!!
            val image = db.images().byId(imageId)!!
            assertEquals(
                listOf("observation", id, "shelf_photo", "user", "images/$imageId/original.jpg"),
                listOf(image.ownerType, image.ownerId, image.role, image.source, image.originalKey),
            )
            val original = File(context.filesDir, "images/$imageId/original.jpg")
            assertTrue(original.length() > 0)
            assertFalse(reduced.exists())
            val upload = db.pendingUploads().next(10).single()
            assertEquals(listOf(imageId, "original.jpg", original.path), listOf(upload.imageId, upload.name, upload.localPath))
            assertEquals(listOf("price_observations", "images"), outboxTables())
        }

    @Test
    fun itRemembersMyLastPlaceAndFindsVariantsByCode() =
        runTest {
            assertNull(shelf.lastPlace())
            shelf.save(ShelfDraft("v", "soriana", "centro", 3_000))
            now = 2_000
            shelf.save(ShelfDraft("v", "costco", null, 2_900))
            me = "u2"
            now = 3_000
            shelf.save(ShelfDraft("v", "oxxo", null, 3_500))
            me = "u1"
            assertEquals(ShelfPlace("costco", null), shelf.lastPlace())
            assertEquals("v", shelf.variantOfCode("7501234567890"))
            assertNull(shelf.variantOfCode("0000000"))
        }
}
