package com.maubautista.maunedas.feature.shelf

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.camera.ScanCodeSheet
import com.maubautista.maunedas.core.camera.rememberTakePhoto
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.ui.BranchSheet
import com.maubautista.maunedas.core.ui.PlaceOption
import com.maubautista.maunedas.core.ui.PromotionFields
import com.maubautista.maunedas.core.ui.StoreSheet
import com.maubautista.maunedas.core.ui.promotionText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import com.maubautista.maunedas.core.designsystem.R as DesignR
import com.maubautista.maunedas.core.ui.R as UiR

data class ShelfActions(
    val onBack: () -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onChoose: (VariantChoice) -> Unit = {},
    val onChangeVariant: () -> Unit = {},
    val onCode: (String) -> Unit = {},
    val onStore: (StoreChoice) -> Unit = {},
    val onNewStore: (name: String, kind: String) -> Unit = { _, _ -> },
    val onBranch: (BranchChoice?) -> Unit = {},
    val onNewBranch: (name: String, city: String?) -> Unit = { _, _ -> },
    val onPrice: (Long?) -> Unit = {},
    val onPromo: (PromoType?) -> Unit = {},
    val onParams: ((PromoParams) -> PromoParams) -> Unit = {},
    val onTakePhoto: () -> Unit = {},
    val onRemovePhoto: () -> Unit = {},
    val onSave: (another: Boolean, promoText: String?) -> Unit = { _, _ -> },
)

@Composable
fun ShelfRoute(
    onDone: () -> Unit,
    viewModel: ShelfViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val stores by viewModel.stores.collectAsStateWithLifecycle()
    val branches by viewModel.branches.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.done.collect { onDone() } }
    BackHandler(onBack = viewModel::leave)
    var defaultCity by remember { mutableStateOf("Puebla") }
    LaunchedEffect(Unit) { defaultCity = viewModel.defaultCity() }
    val takePhoto = rememberTakePhoto(viewModel::onPhoto)
    if (state.loading) return
    ShelfScreen(
        state = state,
        stores = stores,
        branches = branches,
        defaultCity = defaultCity,
        actions =
            ShelfActions(
                onBack = viewModel::leave,
                onQuery = viewModel::onQuery,
                onChoose = viewModel::chooseVariant,
                onChangeVariant = viewModel::changeVariant,
                onCode = viewModel::onCode,
                onStore = viewModel::chooseStore,
                onNewStore = viewModel::createStore,
                onBranch = viewModel::chooseBranch,
                onNewBranch = viewModel::createBranch,
                onPrice = viewModel::onPrice,
                onPromo = viewModel::onPromo,
                onParams = viewModel::onParams,
                onTakePhoto = takePhoto,
                onRemovePhoto = viewModel::removePhoto,
                onSave = viewModel::save,
            ),
    )
}

private enum class Picker { STORE, BRANCH, SCAN }

/** S-13 (05 §5). Everything scrolls, buttons included, so at 200 % font nothing hides behind a fixed footer. */
@Composable
fun ShelfScreen(
    state: ShelfState,
    stores: List<StoreChoice>,
    branches: List<BranchChoice>,
    defaultCity: String,
    actions: ShelfActions,
) {
    var picker by rememberSaveable { mutableStateOf<Picker?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val savedMessage = stringResource(R.string.shelf_saved)
    LaunchedEffect(state.saved) { if (state.saved > 0) snackbar.showSnackbar(savedMessage) }
    val promoText = state.promoType?.let { promotionText(it, state.params) }
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = actions.onBack) { Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.shelf_back)) }
                Text(stringResource(R.string.shelf_title), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f).semantics { heading() })
            }
            VariantPart(state, actions, onScan = { picker = Picker.SCAN })
            OutlinedButton(onClick = { picker = Picker.STORE }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                Text(stores.firstOrNull { it.id == state.storeId }?.name ?: stringResource(R.string.shelf_store_pick))
            }
            if (state.storeId != null) {
                OutlinedButton(onClick = { picker = Picker.BRANCH }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.shelf_branch, branches.firstOrNull { it.id == state.branchId }?.name ?: stringResource(UiR.string.ui_no_branch)))
                }
            }
            MoneyField(
                cents = state.priceCents,
                onCentsChange = actions.onPrice,
                label = stringResource(if (state.variant?.soldByWeight == true) R.string.shelf_kilo_price else R.string.shelf_price),
                modifier = Modifier.fillMaxWidth(),
            )
            Text(stringResource(R.string.shelf_promo), style = MaterialTheme.typography.titleSmall)
            PromotionFields(state.promoType, state.params, onType = actions.onPromo, onParams = actions.onParams)
            PricePreview(state)
            PhotoPart(state.photoPath, actions)
            state.error?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge) }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedButton(onClick = { actions.onSave(true, promoText) }, enabled = !state.saving, modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.shelf_save_another))
                }
                Button(onClick = { actions.onSave(false, promoText) }, enabled = !state.saving, modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.shelf_save))
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
    when (picker) {
        Picker.STORE ->
            StoreSheet(
                stores.map { PlaceOption(it.id, it.name) },
                state.storeId,
                onPick = { o ->
                    actions.onStore(StoreChoice(o.id, o.name))
                    picker = null
                },
                onCreate = { n, k ->
                    actions.onNewStore(n, k)
                    picker = null
                },
                onDismiss = { picker = null },
            )
        Picker.BRANCH ->
            BranchSheet(
                branches.map { PlaceOption(it.id, it.name, it.city) },
                state.branchId,
                defaultCity,
                onPick = { o ->
                    actions.onBranch(o?.let { BranchChoice(it.id, it.name, it.detail) })
                    picker = null
                },
                onCreate = { n, c ->
                    actions.onNewBranch(n, c)
                    picker = null
                },
                onDismiss = { picker = null },
            )
        Picker.SCAN ->
            ScanCodeSheet(
                onCode = { code ->
                    picker = null
                    actions.onCode(code)
                },
                onDismiss = { picker = null },
            )
        null -> Unit
    }
}

/** The variant: the one chosen with "Cambiar", or a search by words or code and "Escanear código". */
@Composable
private fun VariantPart(
    state: ShelfState,
    actions: ShelfActions,
    onScan: () -> Unit,
) {
    val variant = state.variant
    if (variant != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${variant.productName} · ${variant.label}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = actions.onChangeVariant, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.shelf_change)) }
        }
        return
    }
    OutlinedTextField(
        value = state.query,
        onValueChange = actions.onQuery,
        label = { Text(stringResource(R.string.shelf_search)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedButton(onClick = onScan, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.shelf_scan)) }
    state.unknownCode?.let { Text(stringResource(R.string.shelf_unknown_code, it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge) }
    if (state.query.isNotBlank() && state.results.isEmpty()) Text(stringResource(R.string.shelf_no_results), style = MaterialTheme.typography.bodyMedium)
    state.results.forEach { choice ->
        Text(
            "${choice.variant.productName} · ${choice.variant.label}",
            style = MaterialTheme.typography.bodyLarge,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = Spacing.touchTarget)
                    .clickable { actions.onChoose(choice) }
                    .padding(vertical = Spacing.sm),
        )
    }
}

/** What one unit costs: per display unit, and with the promotion when it lowers the price. */
@Composable
private fun PricePreview(state: ShelfState) {
    val unit = state.variant?.displayUnit ?: return
    val perUnit = state.perUnitCents() ?: return
    val unitText = stringResource(DesignR.string.ds_per_unit, Money.format(perUnit), unit.label())
    val effective = state.effectiveCents
    val text =
        when {
            state.promoType == PromoType.MSI -> stringResource(R.string.shelf_msi)
            effective != null -> stringResource(R.string.shelf_with_promo, Money.format(effective), unitText)
            else -> stringResource(R.string.shelf_per_unit, unitText)
        }
    Text(text, style = MaterialTheme.typography.titleMedium)
}

@Composable
private fun PhotoPart(
    path: String?,
    actions: ShelfActions,
) {
    if (path == null) {
        OutlinedButton(onClick = actions.onTakePhoto, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.shelf_photo_add)) }
        return
    }
    val thumb by produceState<ImageBitmap?>(null, path) { value = withContext(Dispatchers.IO) { thumbnail(File(path)) } }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        thumb?.let { Image(it, contentDescription = stringResource(R.string.shelf_photo), contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp)) }
        TextButton(onClick = actions.onRemovePhoto, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.shelf_photo_remove)) }
    }
}

/** A small copy of the photo for the form (Coil arrives with T-117). */
private fun thumbnail(file: File): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 256) sample *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}
