package com.maubautista.maunedas.feature.scan

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.camera.BarcodeScanner
import com.maubautista.maunedas.core.camera.ScanCodes
import com.maubautista.maunedas.core.camera.WithCameraPermission
import com.maubautista.maunedas.core.data.CatalogGuess
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.PriceSource
import com.maubautista.maunedas.core.designsystem.component.PriceText
import com.maubautista.maunedas.core.ui.Dates

/** Where S-12 leads; prefills are the scanned code and what an open catalog knew. */
data class ScanActions(
    val onAddToPurchase: (draftId: String, variantId: String) -> Unit = { _, _ -> },
    val onShelfPrice: (variantId: String) -> Unit = {},
    val onOpenProduct: (productId: String) -> Unit = {},
    val onNewProduct: (code: String, guess: CatalogGuess?) -> Unit = { _, _ -> },
    val onNewVariant: (productId: String, code: String, guess: CatalogGuess?) -> Unit = { _, _, _ -> },
)

@Composable
fun ScanRoute(
    actions: ScanActions,
    viewModel: ScanViewModel = hiltViewModel(),
) {
    val result by viewModel.result.collectAsStateWithLifecycle()
    ScanScreen(
        result = result,
        now = viewModel.now(),
        actions = actions,
        onCode = viewModel::onCode,
        onDismiss = viewModel::dismiss,
        onChooseExisting = viewModel::chooseExisting,
        onProductQuery = viewModel::onProductQuery,
        camera = {
            WithCameraPermission(denied = { request -> CameraPermission(request) }) {
                BarcodeScanner(onCode = viewModel::onCode, paused = result != null, modifier = Modifier.fillMaxSize())
            }
        },
    )
}

/**
 * S-12 for one code read in a purchase's continuous scanning ("Darlo de alta", RF-COM-09): the same four paths, without
 * the camera. Closing the sheet goes back to the purchase, which adds the line once the code is in the catalog.
 */
@Composable
fun ScanCodeRoute(
    code: String,
    actions: ScanActions,
    onClose: () -> Unit,
    viewModel: ScanViewModel = hiltViewModel(),
) {
    val result by viewModel.result.collectAsStateWithLifecycle()
    var started by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(code) {
        if (!started) {
            started = true
            viewModel.onCode(code)
        }
    }
    ScanScreen(
        result = result,
        now = viewModel.now(),
        actions = actions,
        onCode = viewModel::onCode,
        onDismiss = onClose,
        onChooseExisting = viewModel::chooseExisting,
        onProductQuery = viewModel::onProductQuery,
        camera = {
            Text(
                stringResource(R.string.scan_code_label, code),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.fillMaxSize().padding(Spacing.xl),
            )
        },
    )
}

/** S-11 and S-12 (05 §5): the camera (or the permission request), a typed code, and the result sheet. */
@Composable
fun ScanScreen(
    result: ScanResult?,
    now: Long,
    actions: ScanActions,
    onCode: (String) -> Unit,
    onDismiss: () -> Unit,
    onChooseExisting: () -> Unit,
    onProductQuery: (String) -> Unit,
    camera: @Composable () -> Unit,
) {
    var typing by rememberSaveable { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        camera()
        Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), tonalElevation = Spacing.xs) {
            Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(stringResource(R.string.scan_hint), style = MaterialTheme.typography.bodyLarge)
                if (typing) TypedCode(onCode) else TextButton(onClick = { typing = true }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_type)) }
            }
        }
    }
    result?.let { ResultSheet(it, now, actions, onDismiss, onChooseExisting, onProductQuery) }
}

@Composable
private fun CameraPermission(onAllow: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically)) {
        Text(stringResource(R.string.scan_permission), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onAllow, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_allow)) }
    }
}

/** For a label the camera cannot read (or no camera permission). */
@Composable
private fun TypedCode(onCode: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    var invalid by rememberSaveable { mutableStateOf(false) }
    fun submit() {
        val code = ScanCodes.normalize(text)
        invalid = code == null
        if (code != null) onCode(code)
    }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it; invalid = false },
        label = { Text(stringResource(R.string.scan_code)) },
        isError = invalid,
        supportingText = if (invalid) ({ Text(stringResource(R.string.scan_invalid)) }) else null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { submit() }),
        modifier = Modifier.fillMaxWidth(),
    )
    Button(onClick = ::submit, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_search)) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResultSheet(
    result: ScanResult,
    now: Long,
    actions: ScanActions,
    onDismiss: () -> Unit,
    onChooseExisting: () -> Unit,
    onProductQuery: (String) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(stringResource(R.string.scan_code_label, result.code), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            when (result) {
                is ScanResult.Looking -> {
                    CircularProgressIndicator()
                    Text(stringResource(R.string.scan_looking, result.code), style = MaterialTheme.typography.bodyLarge)
                }
                is ScanResult.Found -> Found(result, now, actions)
                is ScanResult.Pulling -> {
                    CircularProgressIndicator()
                    Text(stringResource(R.string.scan_pulling, "${result.productName} · ${result.variantLabel}"), style = MaterialTheme.typography.bodyLarge)
                }
                is ScanResult.New -> New(result, actions, onChooseExisting, onProductQuery)
            }
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_scan_again)) }
        }
    }
}

@Composable
private fun Found(
    result: ScanResult.Found,
    now: Long,
    actions: ScanActions,
) {
    val hit = result.hit
    Text("${hit.productName} · ${hit.variantLabel}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
    hit.brand?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (hit.latest.isEmpty()) Text(stringResource(R.string.scan_no_prices), style = MaterialTheme.typography.bodyMedium)
    hit.latest.forEach { price ->
        val source = PriceSource.fromWire(price.source) ?: return@forEach
        Column(Modifier.semantics(mergeDescendants = true) {}) {
            PriceText(cents = price.effectiveUnitCents ?: price.displayCents, perUnitCents = price.displayCents, unit = price.unit, source = source)
            Text(stringResource(R.string.scan_price_at, price.storeName.orEmpty(), Dates.ago(price.observedAt, now)), style = MaterialTheme.typography.bodyMedium)
        }
    }
    result.draft?.let { draft ->
        Button(onClick = { actions.onAddToPurchase(draft.id, hit.variantId) }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(draft.storeName?.let { stringResource(R.string.scan_add_to, it) } ?: stringResource(R.string.scan_add_to_open))
        }
    }
    OutlinedButton(onClick = { actions.onShelfPrice(hit.variantId) }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_shelf)) }
    OutlinedButton(onClick = { actions.onOpenProduct(hit.productId) }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_open)) }
}

@Composable
private fun New(
    result: ScanResult.New,
    actions: ScanActions,
    onChooseExisting: () -> Unit,
    onProductQuery: (String) -> Unit,
) {
    val guess = result.guess
    if (guess != null) {
        Text(stringResource(R.string.scan_catalog, guess.attribution), style = MaterialTheme.typography.labelLarge)
        Text(listOfNotNull(guess.name, guess.brand).joinToString(" · ").ifEmpty { result.code }, style = MaterialTheme.typography.titleLarge)
        guess.quantityText?.let { Text(stringResource(R.string.scan_catalog_content, it), style = MaterialTheme.typography.bodyLarge) }
    } else {
        Text(stringResource(R.string.scan_unknown), style = MaterialTheme.typography.titleMedium)
        if (result.offline) Text(stringResource(R.string.scan_offline), style = MaterialTheme.typography.bodyLarge)
    }
    if (!result.choosing) {
        Button(onClick = { actions.onNewProduct(result.code, guess) }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_new_product)) }
        OutlinedButton(onClick = onChooseExisting, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.scan_is_variant)) }
    } else {
        Text(stringResource(R.string.scan_is_variant), style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = result.query,
            onValueChange = onProductQuery,
            label = { Text(stringResource(R.string.scan_find_product)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (result.query.isNotBlank() && result.choices.isEmpty()) Text(stringResource(R.string.scan_no_products), style = MaterialTheme.typography.bodyMedium)
        result.choices.forEach { p ->
            Text(
                listOfNotNull(p.name, p.brand).joinToString(" · "),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).clickable { actions.onNewVariant(p.id, result.code, guess) }.padding(vertical = Spacing.sm),
            )
        }
    }
}
