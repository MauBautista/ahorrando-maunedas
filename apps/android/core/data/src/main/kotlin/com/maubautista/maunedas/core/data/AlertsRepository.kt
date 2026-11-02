package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncTables
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** The rule types of 08 §3, by their wire names. */
enum class AlertType(val wire: String) {
    BELOW_PRICE("below_price"),
    DROP_PCT("drop_pct"),
    NEW_LOW("new_low"),
    PROMO("promo"),
    BACK_IN_STOCK("back_in_stock"),
    ;

    companion object {
        fun fromWire(wire: String): AlertType? = entries.firstOrNull { it.wire == wire }
    }
}

/** What `new_low` compares with (08 §3). */
enum class AlertScope(val wire: String) {
    VARIANT_WEB("variant_web"),
    VARIANT_ALL("variant_all"),
    LISTING("listing"),
    ;

    companion object {
        fun fromWire(wire: String): AlertScope = entries.firstOrNull { it.wire == wire } ?: VARIANT_WEB
    }
}

/** One of my rules as S-22 lists it. */
data class AlertRuleItem(
    val id: String,
    val variantId: String,
    val productId: String,
    /** "Producto · Variante". */
    val name: String,
    val listingId: String?,
    /** The store of [listingId] when the rule watches one listing only. */
    val storeName: String?,
    val type: AlertType,
    val thresholdCents: Long?,
    val thresholdPct: Double?,
    val scope: AlertScope,
    val cooldownHours: Long,
    val active: Boolean,
)

/** One of my alerts as S-23 lists it. */
data class AlertEventItem(
    val id: String,
    val firedAt: Long,
    val title: String,
    val body: String,
    val deliveryStatus: String,
    val variantId: String?,
    val productId: String?,
)

/** A rule to write: [id] null creates one. Fields a type does not use are cleared when saved. */
data class RuleDraft(
    val id: String? = null,
    val variantId: String,
    val listingId: String?,
    val type: AlertType,
    val thresholdCents: Long?,
    val thresholdPct: Double?,
    val scope: AlertScope,
    val cooldownHours: Long,
    val active: Boolean,
)

/** Alert rules and alerts on the phone (S-22, S-23): read from Room, rules written by [LocalWriter]. */
@Singleton
class AlertsRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val clock: Clock,
        private val user: CurrentUser,
    ) {
        private val rulesTable = SyncTables.of<AlertRuleEntity>("alert_rules")

        fun rules(variantId: String?): Flow<List<AlertRuleItem>> {
            val me = user.id() ?: return flowOf(emptyList())
            return db.tracking().rules(me, variantId).map { rows ->
                rows.mapNotNull { r ->
                    val type = AlertType.fromWire(r.type) ?: return@mapNotNull null
                    AlertRuleItem(
                        id = r.id, variantId = r.variantId, productId = r.productId, name = "${r.productName} · ${r.variantLabel}",
                        listingId = r.listingId, storeName = r.storeName, type = type, thresholdCents = r.thresholdCents,
                        thresholdPct = r.thresholdPct, scope = AlertScope.fromWire(r.scope), cooldownHours = r.cooldownHours, active = r.active == 1,
                    )
                }
            }
        }

        fun events(limit: Int = EVENTS_SHOWN): Flow<List<AlertEventItem>> {
            val me = user.id() ?: return flowOf(emptyList())
            return db.tracking().events(me, limit).map { rows ->
                rows.map { AlertEventItem(it.id, it.firedAt, it.title, it.body, it.deliveryStatus, it.variantId, it.productId) }
            }
        }

        /** Whether I have no rule yet: S-22 asks for notifications with the first one (05 §8). */
        suspend fun isFirstRule(): Boolean = user.id()?.let { db.tracking().ruleCount(it) == 0 } ?: false

        suspend fun save(draft: RuleDraft): String {
            val me = requireNotNull(user.id()) { "Sin sesión" }
            val now = clock.nowMillis()
            val existing = draft.id?.let { db.alertRules().byId(it) }
            val row =
                AlertRuleEntity(
                    id = existing?.id ?: Uuids.v7(now),
                    userId = me,
                    variantId = draft.variantId,
                    listingId = draft.listingId,
                    type = draft.type.wire,
                    thresholdCents = draft.thresholdCents.takeIf { draft.type == AlertType.BELOW_PRICE },
                    thresholdPct = draft.thresholdPct.takeIf { draft.type == AlertType.DROP_PCT },
                    scope = (if (draft.type == AlertType.NEW_LOW) draft.scope else AlertScope.VARIANT_WEB).wire,
                    cooldownHours = draft.cooldownHours,
                    active = if (draft.active) 1 else 0,
                    createdAt = existing?.createdAt ?: now,
                    updatedAt = now,
                    version = existing?.version ?: 0,
                )
            writer.write(rulesTable, listOf(row))
            return row.id
        }

        suspend fun setActive(
            ruleId: String,
            active: Boolean,
        ) {
            val row = db.alertRules().byId(ruleId) ?: return
            writer.write(rulesTable, listOf(row.copy(active = if (active) 1 else 0)))
        }

        suspend fun delete(ruleId: String) {
            val row = db.alertRules().byId(ruleId) ?: return
            writer.delete(rulesTable, listOf(row))
        }

        /** The product page a notification opens; null until the variant comes down by sync. */
        fun productOfVariant(variantId: String): Flow<String?> = db.tracking().productOfVariant(variantId)

        companion object {
            const val EVENTS_SHOWN = 100
        }
    }
