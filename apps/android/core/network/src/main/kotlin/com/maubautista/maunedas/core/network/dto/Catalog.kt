package com.maubautista.maunedas.core.network.dto

import kotlinx.serialization.Serializable

/** `GET /v1/barcodes/:code` (03 §8). */
@Serializable
data class BarcodeLookup(val code: String, val match: BarcodeMatch?, val catalog: OpenCatalogEntry?)

@Serializable
data class BarcodeMatch(val variantId: String, val productId: String, val productName: String, val variantLabel: String)

@Serializable
data class OpenCatalogEntry(
    val source: String,
    val name: String?,
    val brand: String?,
    val quantityText: String?,
    val parsed: ParsedQuantityDto?,
    val imageUrl: String?,
    val license: String,
    val attribution: String,
    val sourceUrl: String,
)

@Serializable
data class ParsedQuantityDto(val measure: String, val unitAmount: Double, val packCount: Int)

/** `PUT /v1/images/:id/blobs/:name` and `POST /v1/images/:id/import` (10 §2.3, §4.1). */
@Serializable
data class BlobResponse(val key: String, val bytes: Long)

@Serializable
data class ImportImageRequest(val sourceUrl: String)
