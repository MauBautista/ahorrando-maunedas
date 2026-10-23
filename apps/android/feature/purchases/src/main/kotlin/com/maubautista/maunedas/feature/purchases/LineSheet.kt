package com.maubautista.maunedas.feature.purchases

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.text.input.KeyboardType
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.designsystem.component.QuantityField
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.designsystem.R as DesignR

@StringRes
internal fun PromoType.label(): Int =
    when (this) {
        PromoType.PRICE_CUT -> R.string.promo_price_cut
        PromoType.PERCENT -> R.string.promo_percent
        PromoType.NXM -> R.string.promo_nxm
        PromoType.NTH_UNIT_DISCOUNT -> R.string.promo_nth
        PromoType.MEMBER_PRICE -> R.string.promo_member
        PromoType.COUPON -> R.string.promo_coupon
        PromoType.MSI -> R.string.promo_msi
        PromoType.BUNDLE -> R.string.promo_bundle
        PromoType.OTHER -> R.string.promo_other
    }

/** S-05 (05 §5): the variant, quantity (whole pieces, or kilos when sold by weight), list price and promotion. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                FilterChip(selected = form.promoType == null, onClick = { onChange { it.withPromo(null) } }, label = { Text(stringResource(R.string.promo_none)) })
                PromoType.entries.forEach { type ->
                    FilterChip(selected = form.promoType == type, onClick = { onChange { it.withPromo(type) } }, label = { Text(stringResource(type.label())) })
                }
            }
            form.promoType?.let { type -> PromoFields(type, form, onChange) }
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

/** The parameters of each promotion type (09 §6.1) and the discount they give, which can be typed by hand. */
@Composable
private fun PromoFields(
    type: PromoType,
    form: LineForm,
    onChange: ((LineForm) -> LineForm) -> Unit,
) {
    val p = form.params
    fun set(change: (PromoParams) -> PromoParams) = onChange { it.withParams(change) }
    fun money(cents: Long?) = cents?.toDouble()
    when (type) {
        PromoType.PRICE_CUT ->
            MoneyField(cents = p.toCents?.toLong(), onCentsChange = { c -> set { it.copy(toCents = money(c)) } }, label = stringResource(R.string.promo_to_price), modifier = Modifier.fillMaxWidth())
        PromoType.PERCENT -> NumberField(p.percent, R.string.promo_percent_value) { v -> set { it.copy(percent = v) } }
        PromoType.NXM ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                NumberField(p.n, R.string.promo_take, Modifier.weight(1f)) { v -> set { it.copy(n = v) } }
                NumberField(p.m, R.string.promo_pay, Modifier.weight(1f)) { v -> set { it.copy(m = v) } }
            }
        PromoType.NTH_UNIT_DISCOUNT -> {
            NumberField(p.nth, R.string.promo_every) { v -> set { it.copy(nth = v) } }
            NumberField(p.percent, R.string.promo_percent_value) { v -> set { it.copy(percent = v) } }
        }
        PromoType.MEMBER_PRICE ->
            MoneyField(cents = p.memberCents?.toLong(), onCentsChange = { c -> set { it.copy(memberCents = money(c)) } }, label = stringResource(R.string.promo_member_price), modifier = Modifier.fillMaxWidth())
        PromoType.COUPON, PromoType.BUNDLE, PromoType.OTHER ->
            MoneyField(cents = p.amountCents?.toLong(), onCentsChange = { c -> set { it.copy(amountCents = money(c)) } }, label = stringResource(R.string.promo_amount), modifier = Modifier.fillMaxWidth())
        PromoType.MSI -> NumberField(p.months, R.string.promo_months) { v -> set { it.copy(months = v) } }
    }
    if (type != PromoType.MSI) {
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
}

/** A whole or decimal number for promotion parameters (n, m, percent, months). */
@Composable
private fun NumberField(
    value: Double?,
    @StringRes label: Int,
    modifier: Modifier = Modifier,
    onValue: (Double?) -> Unit,
) {
    val text = value?.let { if (it == kotlin.math.floor(it)) it.toLong().toString() else it.toString() }.orEmpty()
    OutlinedTextField(
        value = text,
        onValueChange = { s -> onValue(s.replace(',', '.').toDoubleOrNull()?.takeIf { it >= 0 }) },
        label = { Text(stringResource(label)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = modifier.fillMaxWidth(),
    )
}
