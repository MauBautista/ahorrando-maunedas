package com.maubautista.maunedas.feature.settings

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.maubautista.maunedas.core.data.RejectedChange

/** Synced tables by the name the family knows them by (S-16). */
@StringRes
fun tableName(table: String): Int =
    when (table) {
        "purchases" -> R.string.table_purchases
        "purchase_items" -> R.string.table_purchase_items
        "products" -> R.string.table_products
        "variants" -> R.string.table_variants
        "barcodes" -> R.string.table_barcodes
        "tags" -> R.string.table_tags
        "product_tags" -> R.string.table_product_tags
        "stores" -> R.string.table_stores
        "store_branches" -> R.string.table_store_branches
        "categories" -> R.string.table_categories
        "price_observations" -> R.string.table_price_observations
        "promotions" -> R.string.table_promotions
        "images", "image_renditions", "pending_uploads" -> R.string.table_images
        "receipt_aliases" -> R.string.table_receipt_aliases
        "listings" -> R.string.table_listings
        "alert_rules" -> R.string.table_alert_rules
        else -> R.string.table_other
    }

/** Why the server (or the upload) refused a change; the detail says more than the general reason (04 §3.2). */
@Composable
fun reasonText(change: RejectedChange): String {
    val known =
        when (change.detailReason ?: change.reason) {
            "MISSING_PARENT" -> R.string.reason_missing_parent
            "MEASURE_LOCKED" -> R.string.reason_measure_locked
            "DUPLICATE_IN_BATCH" -> R.string.reason_duplicate
            "ADMIN_DELETE" -> R.string.reason_admin_delete
            "NOT_OWNER" -> R.string.reason_not_owner
            "WEB_OBSERVATION" -> R.string.reason_web
            "VALIDATION" -> R.string.reason_validation
            "FORBIDDEN" -> R.string.reason_forbidden
            "IMMUTABLE_ROW" -> R.string.reason_immutable
            "PAYLOAD_TOO_LARGE", "IMAGE_TOO_LARGE", "BATCH_REJECTED" -> R.string.reason_too_large
            "UNSUPPORTED_MEDIA_TYPE" -> R.string.reason_unsupported
            "LOCAL_FILE_MISSING" -> R.string.reason_missing_file
            else -> null
        }
    return known?.let { stringResource(it) } ?: stringResource(R.string.reason_other, change.detailReason ?: change.reason)
}
