package com.maubautista.maunedas.core.database

import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.math.abs

/** Room's `v_price_points` passes normalizacion.json → prorrateo_ticket, like the D1 view (T41). */
@RunWith(RobolectricTestRunner::class)
class PricePointsFixtureTest {
    private val db = inMemoryDb()
    private val fixture = json("fixtures/normalizacion.json")["prorrateo_ticket"]!!.jsonObject
    private val tolerance = fixture["tolerancia"]!!.jsonPrimitive.double

    @After
    fun close() = db.close()

    private fun JsonObject.num(key: String) = this[key]!!.jsonPrimitive.double

    @Test
    fun prorrateoTicket() =
        runTest {
            val failures = mutableListOf<String>()
            fixture["casos"]!!.jsonArray.forEachIndexed { c, caseElement ->
                val case = caseElement.jsonObject
                val purchaseId = "purchase-$c"
                db.purchases().upsertAll(
                    listOf(
                        PurchaseEntity(
                            id = purchaseId, storeId = "store", purchasedAt = 1, currency = "MXN",
                            discountCents = case["discount_cents"]!!.jsonPrimitive.long, source = "manual",
                            status = "confirmed", createdAt = 1, updatedAt = 1,
                        ),
                    ),
                )
                case["lineas"]!!.jsonArray.forEachIndexed { i, lineElement ->
                    val line = lineElement.jsonObject
                    val v = line["variante"]!!.jsonObject
                    val variantId = "variant-$c-$i"
                    val final = line["final_cents"]!!.jsonPrimitive.long
                    db.variants().upsertAll(
                        listOf(
                            VariantEntity(
                                id = variantId, productId = "product", label = "$c-$i", measure = v["measure"]!!.jsonPrimitive.content,
                                unitAmount = v.num("unit_amount"), packCount = v.num("pack_count").toLong(),
                                soldByWeight = if (v["sold_by_weight"]?.jsonPrimitive?.content == "true") 1 else 0,
                                createdAt = 1, updatedAt = 1,
                            ),
                        ),
                    )
                    db.purchaseItems().upsertAll(
                        listOf(
                            PurchaseItemEntity(
                                id = "item-$c-$i", purchaseId = purchaseId, lineNo = i + 1L, variantId = variantId,
                                quantity = line.num("quantity"), unitPriceCents = final, grossCents = final, discountCents = 0,
                                finalCents = final, createdAt = 1, updatedAt = 1,
                            ),
                        ),
                    )
                }
                case["lineas"]!!.jsonArray.forEachIndexed { i, lineElement ->
                    val expected = lineElement.jsonObject["esperado"]!!.jsonObject
                    val point = db.pricePoints().forVariant("variant-$c-$i").single()
                    val name = "${case["nombre"]!!.jsonPrimitive.content} línea ${i + 1}"
                    if (point.effectiveUnitCents != expected["effective_unit_cents"]!!.jsonPrimitive.long) {
                        failures += "$name: effective_unit_cents ${point.effectiveUnitCents}"
                    }
                    if (abs(point.centsPerBase!! - expected.num("cents_per_base")) > tolerance) {
                        failures += "$name: cents_per_base ${point.centsPerBase}"
                    }
                }
            }
            assertTrue(failures.joinToString("\n"), failures.isEmpty())
            val lines = fixture["casos"]!!.jsonArray.sumOf { it.jsonObject["lineas"]!!.jsonArray.size }
            assertEquals(lines, db.rows("SELECT point_id FROM v_price_points").size)
        }

    @Test
    fun draftsAndDeletedLinesAreNotPricePoints() =
        runTest {
            db.purchases().upsertAll(
                listOf(
                    PurchaseEntity(id = "draft", storeId = "s", purchasedAt = 1, currency = "MXN", discountCents = 0, source = "manual", status = "draft", createdAt = 1, updatedAt = 1),
                    PurchaseEntity(id = "ok", storeId = "s", purchasedAt = 1, currency = "MXN", discountCents = 0, source = "manual", status = "confirmed", createdAt = 1, updatedAt = 1),
                ),
            )
            db.variants().upsertAll(
                listOf(VariantEntity(id = "v", productId = "p", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)),
            )
            db.purchaseItems().upsertAll(
                listOf(
                    PurchaseItemEntity(id = "a", purchaseId = "draft", lineNo = 1, variantId = "v", quantity = 1.0, unitPriceCents = 100, grossCents = 100, discountCents = 0, finalCents = 100, createdAt = 1, updatedAt = 1),
                    PurchaseItemEntity(id = "b", purchaseId = "ok", lineNo = 1, variantId = "v", quantity = 1.0, unitPriceCents = 100, grossCents = 100, discountCents = 0, finalCents = 100, createdAt = 1, updatedAt = 1, deletedAt = 2),
                    PurchaseItemEntity(id = "c", purchaseId = "ok", lineNo = 2, variantId = "v", quantity = 1.0, unitPriceCents = 200, grossCents = 200, discountCents = 0, finalCents = 200, createdAt = 1, updatedAt = 1),
                ),
            )
            assertEquals(listOf("c"), db.pricePoints().forVariant("v").map { it.pointId })
        }
}
