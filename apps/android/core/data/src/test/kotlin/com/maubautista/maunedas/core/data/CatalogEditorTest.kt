package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.UploadQueue
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class CatalogEditorTest {
    private var now = 1_000L
    private var syncRequests = 0
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { now }
    private val editor = CatalogEditor(db, LocalWriter(db, clock, { "u1" }, { syncRequests++ }), clock, LocalPhotos(ApplicationProvider.getApplicationContext()), UploadQueue(db, clock) { })

    @After
    fun close() = db.close()

    private fun sixLiters(codes: List<String> = listOf("7501020515350")) =
        VariantDraft(label = "6 × 1 L", measure = Measure.VOLUME, unitAmount = 1000.0, packCount = 6, soldByWeight = false, codes = codes)

    private suspend fun outbox() = db.outbox().nextBatch(100, Long.MAX_VALUE).map { it.tableName }.sorted()

    @Test
    fun aNewProductIsSavedWithItsFirstVariantCodesAndTags() =
        runTest {
            db.tags().upsertAll(listOf(TagEntity(id = "basicos", name = "Básicos", createdAt = 1, updatedAt = 1)))
            val id =
                editor.saveProduct(
                    ProductDraft(name = "  Leche Lala Entera ", brand = "Lala", newTags = listOf("básicos", "Lácteos", "lácteos "), displayUnit = DisplayUnit.L),
                    sixLiters(),
                )
            val product = db.products().byId(id)!!
            assertEquals("Leche Lala Entera", product.name)
            assertEquals("leche lala entera lala", product.searchKey)
            assertEquals("L", product.displayUnit)
            assertEquals(now, product.createdAt)
            assertEquals("u1", product.updatedBy)
            // "básicos" reuses the tag that exists with other case; "Lácteos" is created once.
            val tags = db.catalogEdits().liveTags().associateBy { it.name }
            assertEquals(setOf("Básicos", "Lácteos"), tags.keys)
            assertEquals(setOf("basicos", tags.getValue("Lácteos").id), db.catalogEdits().liveTagIds(id).toSet())
            assertNotNull(db.productTags().byId(Uuids.productTagId(id, "basicos")))
            val variant = db.variants().liveOfProducts(listOf(id)).single()
            assertEquals(Triple(1000.0, 6L, 0), Triple(variant.unitAmount, variant.packCount, variant.soldByWeight))
            val code = db.barcodes().liveOfVariants(listOf(variant.id)).single()
            assertEquals("7501020515350" to "manual", code.code to code.source)
            // A code read by the scanner keeps its source.
            val scanned = editor.saveProduct(ProductDraft(name = "Agua"), sixLiters(listOf("11112222")).copy(codeSources = mapOf("11112222" to "scan")))
            val scannedVariant = db.variants().liveOfProducts(listOf(scanned)).single()
            assertEquals("scan", db.barcodes().liveOfVariants(listOf(scannedVariant.id)).single().source)
            assertEquals(listOf("barcodes", "barcodes", "product_tags", "product_tags", "products", "products", "tags", "variants", "variants"), outbox())
            assertTrue(syncRequests > 0)
        }

    @Test
    fun takingATagAwayAndBackRevivesTheSameRow() =
        runTest {
            db.tags().upsertAll(listOf(TagEntity(id = "t1", name = "Básicos", createdAt = 1, updatedAt = 1)))
            val id = editor.saveProduct(ProductDraft(name = "Café", tagIds = setOf("t1")), sixLiters(emptyList()))
            val tagRow = Uuids.productTagId(id, "t1")
            now = 2_000
            editor.saveProduct(editor.loadProduct(id)!!.copy(tagIds = emptySet()))
            assertEquals(2_000L, db.productTags().byId(tagRow)!!.deletedAt)
            now = 3_000
            editor.saveProduct(editor.loadProduct(id)!!.copy(tagIds = setOf("t1")))
            val revived = db.productTags().byId(tagRow)!!
            assertNull(revived.deletedAt)
            assertEquals(1_000L to 3_000L, revived.createdAt to revived.updatedAt)
        }

    @Test
    fun editingAVariantAddsAndRemovesOnlyTheCodesThatChanged() =
        runTest {
            val id = editor.saveProduct(ProductDraft(name = "Leche"), sixLiters(listOf("11111111", "22222222")))
            val variantId = db.variants().liveOfProducts(listOf(id)).single().id
            val kept = db.barcodes().liveOfVariants(listOf(variantId)).first { it.code == "11111111" }
            now = 2_000
            val draft = editor.loadVariant(variantId)!!
            assertEquals(listOf("11111111", "22222222"), draft.codes)
            editor.saveVariant(id, draft.copy(label = "1 L", packCount = 1, codes = listOf("11111111", "33333333")))
            assertEquals(setOf("11111111", "33333333"), db.barcodes().liveOfVariants(listOf(variantId)).map { it.code }.toSet())
            // The kept code is not rewritten.
            assertEquals(kept, db.barcodes().byId(kept.id))
            assertEquals("1 L", db.variants().byId(variantId)!!.label)
            assertEquals(listOf(VariantSummary(variantId, "1 L")), editor.variantsOf(id).first())
        }

    @Test
    fun aCodeOfAnotherVariantStopsTheWholeSave() =
        runTest {
            val first = editor.saveProduct(ProductDraft(name = "Leche Lala"), sixLiters())
            val queued = outbox().size
            try {
                editor.saveProduct(ProductDraft(name = "Otra leche"), sixLiters(listOf("7501020515350")))
                fail("debía rechazar el código")
            } catch (e: BarcodeTakenException) {
                assertEquals(BarcodeOwner(db.variants().liveOfProducts(listOf(first)).single().id, "Leche Lala", "6 × 1 L"), e.owner)
            }
            // Nothing of the second product was written.
            assertEquals(queued, outbox().size)
            assertEquals(1, db.openHelper.readableDatabase.query("SELECT count(*) FROM products").use { it.moveToFirst(); it.getInt(0) })
        }

    @Test
    fun theOwnerOfACodeIgnoresTheVariantBeingEdited() =
        runTest {
            val id = editor.saveProduct(ProductDraft(name = "Leche"), sixLiters())
            val variantId = db.variants().liveOfProducts(listOf(id)).single().id
            assertNull(editor.barcodeOwner("7501020515350", exceptVariant = variantId))
            assertEquals("Leche", editor.barcodeOwner("7501020515350")?.productName)
            assertNull(editor.barcodeOwner("0000000"))
        }

    @Test
    fun deletingAProductTakesItsVariantsAndCodes() =
        runTest {
            val id = editor.saveProduct(ProductDraft(name = "Leche"), sixLiters())
            now = 5_000
            editor.deleteProduct(id)
            assertEquals(5_000L, db.products().byId(id)!!.deletedAt)
            assertEquals(emptyList<Any>(), db.variants().liveOfProducts(listOf(id)))
            assertNull(editor.barcodeOwner("7501020515350"))
            assertNull(editor.loadProduct(id))
        }

    private fun taken(name: String): String {
        val file = File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "capture/$name-reduced.jpg").apply { parentFile?.mkdirs(); writeText("jpg") }
        return file.path
    }

    private suspend fun pending() = db.pendingUploads().next(10).map { listOf(it.kind, it.imageId, it.name, it.localPath, it.sourceUrl) }

    @Test
    fun aPhotoTakenIsTheProductsImageAndWaitsToBeUploaded() =
        runTest {
            val path = taken("one")
            val id = editor.saveProduct(ProductDraft(name = "Leche", displayUnit = DisplayUnit.L), sixLiters(), PhotoChange.Taken(path))
            val imageId = db.products().byId(id)!!.primaryImageId!!
            val image = db.images().byId(imageId)!!
            assertEquals(listOf("product", id, "catalog", "user", "images/$imageId/original.jpg"), listOf(image.ownerType, image.ownerId, image.role, image.source, image.originalKey))
            val kept = File(ApplicationProvider.getApplicationContext<Context>().filesDir, "images/$imageId/original.jpg")
            assertEquals(true to false, kept.exists() to File(path).exists())
            assertEquals(listOf(listOf<Any?>("blob", imageId, "original.jpg", kept.path, null)), pending())
            assertTrue("images" in outbox())
            // Saving again without a change keeps it.
            editor.saveProduct(editor.loadProduct(id)!!.copy(name = "Leche entera"))
            assertEquals(imageId, db.products().byId(id)!!.primaryImageId)
        }

    @Test
    fun anOpenCatalogPhotoIsImportedWithItsLicense() =
        runTest {
            val photo = PhotoChange.OpenCatalog("https://images.openfoodfacts.org/images/products/750/front.jpg", "CC BY-SA 3.0", "Open Food Facts contributors", "https://world.openfoodfacts.org/product/7501020515350")
            val id = editor.saveProduct(ProductDraft(name = "Leche", displayUnit = DisplayUnit.L), sixLiters(), photo)
            val image = db.images().byId(db.products().byId(id)!!.primaryImageId!!)!!
            assertEquals(
                listOf("off", "CC BY-SA 3.0", "Open Food Facts contributors", "https://world.openfoodfacts.org/product/7501020515350", "images/${image.id}/original.jpg"),
                listOf(image.source, image.license, image.attribution, image.sourceUrl, image.originalKey),
            )
            assertEquals(listOf(listOf<Any?>("import", image.id, "original.jpg", null, photo.imageUrl)), pending())
        }

    @Test
    fun anotherPhotoReplacesTheOldOneAndRemovingItLeavesNone() =
        runTest {
            val id = editor.saveProduct(ProductDraft(name = "Leche", displayUnit = DisplayUnit.L), sixLiters(), PhotoChange.Taken(taken("first")))
            val first = db.products().byId(id)!!.primaryImageId!!
            now = 2_000
            editor.saveProduct(editor.loadProduct(id)!!, photo = PhotoChange.Taken(taken("second")))
            val second = db.products().byId(id)!!.primaryImageId!!
            assertTrue(second != first)
            assertEquals(2_000L, db.images().byId(first)!!.deletedAt)
            assertNull(db.images().byId(second)!!.deletedAt)
            now = 3_000
            editor.saveProduct(editor.loadProduct(id)!!, photo = PhotoChange.Removed)
            assertNull(db.products().byId(id)!!.primaryImageId)
            assertEquals(3_000L, db.images().byId(second)!!.deletedAt)
        }
}
