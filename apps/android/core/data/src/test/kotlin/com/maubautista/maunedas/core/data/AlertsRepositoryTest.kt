package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.AlertEventEntity
import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.LocalWriter
import kotlinx.coroutines.flow.first
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

@RunWith(RobolectricTestRunner::class)
class AlertsRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private var now = 1_000_000L
    private var me: String? = "u1"
    private val clock = Clock { now }
    private val alerts = AlertsRepository(db, LocalWriter(db, clock, { me }, { }), clock, { me })

    @Before
    fun seed() =
        runTest {
            db.stores().upsertAll(listOf(StoreEntity(id = "s", name = "Costco", kind = "both", adapter = "costco_mx", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(
                listOf(
                    ProductEntity(id = "p1", name = "Leche Lala Entera", displayUnit = "L", searchKey = "leche", createdAt = 1, updatedAt = 1),
                    ProductEntity(id = "p2", name = "Atún Dolores", displayUnit = "kg", searchKey = "atun", createdAt = 1, updatedAt = 1),
                ),
            )
            db.variants().upsertAll(
                listOf(
                    VariantEntity(id = "v1", productId = "p1", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                    VariantEntity(id = "v2", productId = "p2", label = "140 g", measure = "mass", unitAmount = 140.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                ),
            )
            db.listings().upsertAll(listOf(ListingEntity(id = "l1", variantId = "v1", storeId = "s", adapter = "costco_mx", url = "https://www.costco.com.mx/p/1", active = 1, createdAt = 1, updatedAt = 1)))
        }

    @After
    fun close() = db.close()

    private fun rule(
        id: String,
        user: String = "u1",
        variant: String = "v1",
        type: String = "below_price",
        o: AlertRuleEntity.() -> AlertRuleEntity = { this },
    ) = AlertRuleEntity(id = id, userId = user, variantId = variant, type = type, thresholdCents = 2_500, scope = "variant_web", cooldownHours = 24, active = 1, createdAt = 1, updatedAt = 1).o()

    private suspend fun outbox() = db.outbox().nextBatch(100, Long.MAX_VALUE).map { "${it.tableName}/${it.rowId}" }

    @Test
    fun listsMyLiveRulesWithWhatTheyWatch() =
        runTest {
            db.alertRules().upsertAll(
                listOf(
                    rule("r1"),
                    rule("r2", type = "drop_pct") { copy(thresholdCents = null, thresholdPct = 12.5, listingId = "l1", active = 0, cooldownHours = 0) },
                    rule("r3", variant = "v2", type = "new_low") { copy(thresholdCents = null, scope = "variant_all") },
                    rule("theirs", user = "u2"),
                    rule("gone") { copy(deletedAt = 5) },
                    rule("unknown", type = "future_type"),
                ),
            )
            val all = alerts.rules(null).first()
            assertEquals(listOf("r3", "r1", "r2"), all.map { it.id })
            assertEquals("Atún Dolores · 140 g", all[0].name)
            assertEquals(listOf(AlertType.NEW_LOW, AlertScope.VARIANT_ALL), listOf(all[0].type, all[0].scope))
            val drop = all[2]
            assertEquals(listOf(AlertType.DROP_PCT, 12.5, "l1", "Costco", false, 0L), listOf(drop.type, drop.thresholdPct, drop.listingId, drop.storeName, drop.active, drop.cooldownHours))
            assertEquals(listOf("r1", "r2"), alerts.rules("v1").first().map { it.id })
            me = null
            assertTrue(alerts.rules(null).first().isEmpty())
        }

    @Test
    fun listsMyAlertsNewestFirstWithTheirProduct() =
        runTest {
            db.alertRules().upsertAll(listOf(rule("r1")))
            db.alertEvents().upsertAll(
                listOf(
                    AlertEventEntity(id = "e1", ruleId = "r1", userId = "u1", firedAt = 10, title = "Leche bajó", body = "En Costco", deliveryStatus = "sent"),
                    AlertEventEntity(id = "e2", ruleId = "r-gone", userId = "u1", firedAt = 20, title = "Otro", body = "x", deliveryStatus = "no_devices"),
                    AlertEventEntity(id = "e3", ruleId = "r1", userId = "u2", firedAt = 30, title = "Ajeno", body = "x", deliveryStatus = "sent"),
                ),
            )
            val events = alerts.events().first()
            assertEquals(listOf("e2", "e1"), events.map { it.id })
            assertEquals(listOf(null, null), listOf(events[0].variantId, events[0].productId))
            assertEquals(listOf("v1", "p1", "sent"), listOf(events[1].variantId, events[1].productId, events[1].deliveryStatus))
            assertEquals(listOf("e2"), alerts.events(limit = 1).first().map { it.id })
        }

    @Test
    fun savesRulesClearingWhatTheirTypeDoesNotUse() =
        runTest {
            assertTrue(alerts.isFirstRule())
            val id =
                alerts.save(
                    RuleDraft(variantId = "v1", listingId = "l1", type = AlertType.BELOW_PRICE, thresholdCents = 2_490, thresholdPct = 10.0, scope = AlertScope.VARIANT_ALL, cooldownHours = 12, active = true),
                )
            val row = db.alertRules().byId(id)!!
            assertEquals(listOf("u1", "v1", "l1", "below_price", 2_490L, null, "variant_web", 12L, 1, now, "u1"), listOf(row.userId, row.variantId, row.listingId, row.type, row.thresholdCents, row.thresholdPct, row.scope, row.cooldownHours, row.active, row.createdAt, row.updatedBy))
            assertEquals(listOf("alert_rules/$id"), outbox())
            assertFalse(alerts.isFirstRule())

            now += 1_000
            alerts.save(RuleDraft(id = id, variantId = "v1", listingId = null, type = AlertType.NEW_LOW, thresholdCents = 2_490, thresholdPct = 10.0, scope = AlertScope.LISTING, cooldownHours = 0, active = false))
            val edited = db.alertRules().byId(id)!!
            assertEquals(listOf("new_low", null, null, "listing", null, 0, 1_000_000L, now), listOf(edited.type, edited.thresholdCents, edited.thresholdPct, edited.scope, edited.listingId, edited.active, edited.createdAt, edited.updatedAt))
            alerts.save(RuleDraft(id = id, variantId = "v1", listingId = null, type = AlertType.DROP_PCT, thresholdCents = 1, thresholdPct = 15.0, scope = AlertScope.LISTING, cooldownHours = 24, active = true))
            assertEquals(listOf(null, 15.0, "variant_web"), db.alertRules().byId(id)!!.let { listOf(it.thresholdCents, it.thresholdPct, it.scope) })
        }

    @Test
    fun pausesAndRemovesAndFindsAVariantsProduct() =
        runTest {
            db.alertRules().upsertAll(listOf(rule("r1")))
            alerts.setActive("r1", false)
            assertEquals(0, db.alertRules().byId("r1")!!.active)
            alerts.setActive("r1", true)
            assertEquals(1, db.alertRules().byId("r1")!!.active)
            now += 5
            alerts.delete("r1")
            assertEquals(now, db.alertRules().byId("r1")!!.deletedAt)
            assertTrue(alerts.rules(null).first().isEmpty())
            alerts.setActive("nope", true)
            alerts.delete("nope")
            assertEquals("p1", alerts.productOfVariant("v1").first())
            assertNull(alerts.productOfVariant("missing").first())
        }
}
