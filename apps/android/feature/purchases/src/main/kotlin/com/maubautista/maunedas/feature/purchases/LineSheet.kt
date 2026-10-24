package com.maubautista.maunedas.feature.purchases

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.designsystem.component.QuantityField
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.ui.PromotionFields
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** S-05 (05 §5): the variant, quantity (whole pieces, or kilos when sold by weight), list price and promotion. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LineSheet(
    form: LineForm,
    onChange: ((LineForm) -> LineForm) -> Unit,
    onQuery: (String) -> Unit,
    onSave: (another: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(stringResource(R.string.line_title), style = MaterialTheme.typography.titleLarge)
            val variant = form.variant
            // "Vincular": what the ticket said, to find its product.
            form.rawText?.let { Text(stringResource(R.string.line_ticket_text, it), style = MaterialTheme.typography.bodyLarge) }
            if (variant == null) {
                OutlinedTextField(
                    value = form.query,
                    onValueChange = onQuery,
                    label = { Text(stringResource(R.string.line_search)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (form.query.isNotBlank() && form.results.isEmpty()) Text(stringResource(R.string.line_no_results), style = MaterialTheme.typography.bodyMedium)
                form.results.forEach { choice ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = Spacing.touchTarget)
                            .clickable { onChange { it.withVariant(choice) } }
                            .padding(vertical = Spacing.sm)
                            .semantics(mergeDescendants = true) {},
                    ) {
                        Text("${choice.variant.productName} · ${choice.variant.label}", style = MaterialTheme.typography.bodyLarge)
                        choice.lastPriceCents?.let { Text(stringResource(R.string.line_last_price, Money.format(it)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${variant.productName} · ${variant.label}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = { onChange { it.copy(variant = null) } }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.line_change)) }
                }
            }
            if (variant?.soldByWeight == true) {
                QuantityField(quantity = form.quantity, onQuantityChange = { q -> onChange { it.withQuantity(q) } }, label = stringResource(R.string.line_kilos), soldByWeight = true, modifier = Modifier.fillMaxWidth())
            } else {
                Text(stringResource(R.string.line_quantity), style = MaterialTheme.typography.titleSmall)
                // Screen readers say "Una menos" / "Una más" instead of the symbols.
                val less = stringResource(R.string.line_less)
                val more = stringResource(R.string.line_more)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    FilledTonalButton(onClick = { onChange { it.step(-1) } }, modifier = Modifier.heightIn(min = Spacing.touchTarget).semantics { contentDescription = less }) { Text("−") }
                    Text(form.quantity?.toLong()?.toString() ?: "", style = MaterialTheme.typography.headlineSmall)
                    FilledTonalButton(onClick = { onChange { it.step(1) } }, modifier = Modifier.heightIn(min = Spacing.touchTarget).semantics { contentDescription = more }) { Text("+") }
                }
            }
            MoneyField(
                cents = form.unitPriceCents,
                onCentsChange = { c -> onChange { it.withPrice(c) } },
                label = stringResource(if (variant?.soldByWeight == true) R.string.line_kilo_price else R.string.line_unit_price),
                modifier = Modifier.fillMaxWidth(),
            )
            Text(stringResource(R.string.line_promo), style = MaterialTheme.typography.titleSmall)
            PromotionFields(form.promoType, form.params, onType = { t -> onChange { it.withPromo(t) } }, onParams = { change -> onChange { it.withParams(change) } })
            // S-05 only: the discount it gives, which can be typed by hand (then saved as `other`).
            if (form.promoType != null && form.promoType != PromoType.MSI) {
                form.computedDiscount()?.takeIf { form.manualDiscountCents == null }?.let {
                    Text(stringResource(R.string.promo_discount, Money.format(it)), style = MaterialTheme.typography.bodyLarge)
                }
                MoneyField(
                    cents = form.manualDiscountCents,
                    onCentsChange = { c -> onChange { it.withManualDiscount(c) } },
                    label = stringResource(R.string.promo_override),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            form.error?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge) }
            form.preview()?.let { line ->
                Text(stringResource(R.string.line_total, Money.format(line.amounts.finalCents)), style = MaterialTheme.typography.titleMedium)
                val perUnit = line.perUnitCents()
                val unit = line.variant?.unit
                if (perUnit != null && unit != null) {
                    Text(stringResource(R.string.line_effective, stringResource(DesignR.string.ds_per_unit, Money.format(perUnit), unit.label())), style = MaterialTheme.typography.bodyLarge)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedButton(onClick = { onSave(true) }, modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.line_save_another)) }
                Button(onClick = { onSave(false) }, modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.line_save)) }
            }
        }
    }
}
