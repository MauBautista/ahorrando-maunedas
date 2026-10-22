package com.maubautista.maunedas.core.network.dto

import kotlinx.serialization.Serializable

/** `POST /v1/admin/merge` (03 §11): [kind] is `product` or `variant`; the source ends deleted. */
@Serializable
data class MergeRequest(val kind: String, val sourceId: String, val targetId: String)

/** Rows moved to the target, per table. */
@Serializable
data class MergeResponse(val moved: Map<String, Int>)
