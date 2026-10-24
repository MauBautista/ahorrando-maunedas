package com.maubautista.maunedas.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage

/**
 * A product's photo, or its initial while there is none or it cannot be loaded (no network, not uploaded yet).
 * [model] comes from `ProductPhotos`: a file on the phone or a Worker URL. The photo is decorative next to the
 * product's name, so it has no description of its own.
 */
@Composable
fun ProductPhoto(
    model: Any?,
    name: String,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    var failed by remember(model) { mutableStateOf(false) }
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium, modifier = modifier) {
        Box(contentAlignment = Alignment.Center) {
            if (model == null || failed) {
                Text(name.take(1).uppercase(), style = MaterialTheme.typography.titleLarge)
            } else {
                AsyncImage(model = model, contentDescription = null, contentScale = contentScale, onError = { failed = true }, modifier = Modifier.fillMaxSize())
            }
        }
    }
}
