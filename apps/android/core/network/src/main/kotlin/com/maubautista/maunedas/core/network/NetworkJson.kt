package com.maubautista.maunedas.core.network

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy

/**
 * The JSON of the API and of sync rows (04 §6.1): snake_case keys like the D1 columns, unknown keys ignored
 * (a newer server may add columns), nulls and defaults always written: a push must be able to clear a value.
 */
@OptIn(ExperimentalSerializationApi::class)
val MaunedasJson: Json =
    Json {
        namingStrategy = JsonNamingStrategy.SnakeCase
        ignoreUnknownKeys = true
        explicitNulls = true
        encodeDefaults = true
    }
