package com.maubautista.maunedas.feature.purchases

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.camera.BarcodeScanner
import com.maubautista.maunedas.core.camera.CameraPermissionRequest
import com.maubautista.maunedas.core.camera.WithCameraPermission
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.designsystem.component.QuantityField
import com.maubautista.maunedas.core.model.Money

data class ScanPanelActions(
    val onDone: () -> Unit = {},
    val onPrice: (Long?) -> Unit = {},
    val onStep: (Int) -> Unit = {},
    val onKilos: (Double?) -> Unit = {},
    val onRegister: (code: String) -> Unit = {},
)

/**
 * S-11 in continuous mode, over the purchase editor: the camera stays on, and the panel below holds the line just
 * scanned with its price field focused (RF-COM-09), the codes still waiting and the purchase's count and total.
 */
@Composable
fun ContinuousScanner(
    session: ScanSession,
    pending: List<PendingCode>,
    draft: PurchaseDraft,
    totalCents: Long,
    onCode: (String) -> Unit,
    actions: ScanPanelActions,
    camera: @Composable () -> Unit = {
        WithCameraPermission(denied = { request -> CameraPermissionRequest(request, Modifier.fillMaxSize()) }) {
            // Never paused: each read is a line (the same code is still ignored while it stays in view, 2 s).
            BarcodeScanner(onCode = onCode, paused = false, modifier = Modifier.fillMaxSize())
        }
    },
) {
    BackHandler(onBack = actions.onDone)
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth()) { camera() }
            ScanPanel(session, pending, draft, totalCents, actions)
        }
    }
}

@Composable
internal fun ScanPanel(
    session: ScanSession,
    pending: List<PendingCode>,
    draft: PurchaseDraft,
    totalCents: Long,
    actions: ScanPanelActions,
) {
    Surface(tonalElevation = Spacing.xs) {
        // The panel scrolls on its own, so at 200 % font the camera keeps its half of the screen.
        Column(
            Modifier.fillMaxWidth().heightIn(max = PANEL_MAX).verticalScroll(rememberScrollState()).padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.continuous_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).semantics { heading() })
                Button(onClick = actions.onDone, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.continuous_done)) }
            }
            val line = session.lineIndex?.let { draft.lines.getOrNull(it) }
            if (line?.variant == null) {
                Text(stringResource(R.string.continuous_aim), style = MaterialTheme.typography.bodyLarge)
            } else {
                val variant = line.variant!!
                Text("${variant.productName} · ${variant.label}", style = MaterialTheme.typography.titleMedium)
                // Each read starts the fields over with that line, and the price takes the focus.
                key(session.reads) {
                    val focus = remember { FocusRequester() }
                    LaunchedEffect(Unit) { focus.requestFocus() }
                    if (variant.soldByWeight) {
                        QuantityField(quantity = line.quantity, onQuantityChange = actions.onKilos, label = stringResource(R.string.continuous_kilos), soldByWeight = true, modifier = Modifier.fillMaxWidth())
                    } else {
                        val less = stringResource(R.string.line_less)
                        val more = stringResource(R.string.line_more)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                            FilledTonalButton(onClick = { actions.onStep(-1) }, modifier = Modifier.heightIn(min = Spacing.touchTarget).semantics { contentDescription = less }) { Text("−") }
                            Text(quantityText(line), style = MaterialTheme.typography.headlineSmall)
                            FilledTonalButton(onClick = { actions.onStep(1) }, modifier = Modifier.heightIn(min = Spacing.touchTarget).semantics { contentDescription = more }) { Text("+") }
                        }
                    }
                    MoneyField(
                        cents = line.unitPriceCents.takeIf { it > 0 },
                        onCentsChange = actions.onPrice,
                        label = stringResource(if (variant.soldByWeight) R.string.continuous_kilo_price else R.string.continuous_price),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        imeAction = ImeAction.Done,
                    )
                }
            }
            session.looking?.let { Text(stringResource(R.string.continuous_looking, it), style = MaterialTheme.typography.bodyMedium) }
            pending.forEach { p ->
                if (p.name != null) {
                    Text(stringResource(R.string.continuous_pulling, p.name), style = MaterialTheme.typography.bodyMedium)
                } else {
                    Text(
                        stringResource(if (p.offline) R.string.continuous_unknown_offline else R.string.continuous_unknown, p.code),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error,
                    )
                    OutlinedButton(onClick = { actions.onRegister(p.code) }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                        Text(stringResource(R.string.continuous_register))
                    }
                }
            }
            Text(
                pluralStringResource(R.plurals.continuous_count, draft.lines.size, draft.lines.size, Money.format(totalCents)),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val PANEL_MAX = 360.dp
