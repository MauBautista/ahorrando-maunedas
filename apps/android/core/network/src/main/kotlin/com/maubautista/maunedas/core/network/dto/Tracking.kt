package com.maubautista.maunedas.core.network.dto

import kotlinx.serialization.Serializable

/** `POST /v1/listings/resolve` (03 §11): a link, or the text a store app shares with one inside. */
@Serializable
data class ResolveListingRequest(val url: String)

@Serializable
data class ResolveListingResponse(
    val adapter: String,
    val storeId: String,
    /** The link as shared: what `listings.url` keeps. */
    val url: String,
    val canonicalUrl: String,
    val externalId: String?,
)
