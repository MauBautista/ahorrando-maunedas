package com.maubautista.maunedas.core.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType

@StringRes
fun PromoType.label(): Int =
    when (this) {
        PromoType.PRICE_CUT -> R.string.ui_promo_price_cut
        PromoType.PERCENT -> R.string.ui_promo_percent
        PromoType.NXM -> R.string.ui_promo_nxm
        PromoType.NTH_UNIT_DISCOUNT -> R.string.ui_promo_nth
        PromoType.MEMBER_PRICE -> R.string.ui_promo_member
        PromoType.COUPON -> R.string.ui_promo_coupon
        PromoType.MSI -> R.string.ui_promo_msi
        PromoType.BUNDLE -> R.string.ui_promo_bundle
        PromoType.OTHER -> R.string.ui_promo_other
    }

/**
 * The promotion selector of S-05 and S-13: "Ninguna" or a type (09 §6.1), then the parameters that type needs. The
 * discount it gives is computed by the caller with `Promotions.discount`.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PromotionFields(
    type: PromoType?,
    params: PromoParams,
    onType: (PromoType?) -> Unit,
    onParams: ((PromoParams) -> PromoParams) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FilterChip(selected = type == null, onClick = { onType(null) }, label = { Text(stringResource(R.string.ui_promo_none)) })
        PromoType.entries.forEach { t -> FilterChip(selected = type == t, onClick = { onType(t) }, label = { Text(stringResource(t.label())) }) }
    }
    fun money(cents: Long?) = cents?.toDouble()
    when (type) {
        null -> Unit
        PromoType.PRICE_CUT ->
            MoneyField(cents = params.toCents?.toLong(), onCentsChange = { c -> onParams { it.copy(toCents = money(c)) } }, label = stringResource(R.string.ui_promo_to_price), modifier = Modifier.fillMaxWidth())
        PromoType.PERCENT -> NumberField(params.percent, R.string.ui_promo_percent_value) { v -> onParams { it.copy(percent = v) } }
        PromoType.NXM ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                NumberField(params.n, R.string.ui_promo_take, Modifier.weight(1f)) { v -> onParams { it.copy(n = v) } }
                NumberField(params.m, R.string.ui_promo_pay, Modifier.weight(1f)) { v -> onParams { it.copy(m = v) } }
            }
        PromoType.NTH_UNIT_DISCOUNT -> {
            NumberField(params.nth, R.string.ui_promo_every) { v -> onParams { it.copy(nth = v) } }
            NumberField(params.percent, R.string.ui_promo_percent_value) { v -> onParams { it.copy(percent = v) } }
        }
        PromoType.MEMBER_PRICE ->
            MoneyField(cents = params.memberCents?.toLong(), onCentsChange = { c -> onParams { it.copy(memberCents = money(c)) } }, label = stringResource(R.string.ui_promo_member_price), modifier = Modifier.fillMaxWidth())
        PromoType.COUPON, PromoType.BUNDLE, PromoType.OTHER ->
            MoneyField(cents = params.amountCents?.toLong(), onCentsChange = { c -> onParams { it.copy(amountCents = money(c)) } }, label = stringResource(R.string.ui_promo_amount), modifier = Modifier.fillMaxWidth())
        PromoType.MSI -> NumberField(params.months, R.string.ui_promo_months) { v -> onParams { it.copy(months = v) } }
    }
}

/**
 * How a promotion reads ("2x1", "15 % de descuento"…), saved as a shelf price's `promo_text`; the type's name when a
 * parameter is missing.
 */
@Composable
fun promotionText(
    type: PromoType,
    params: PromoParams,
): String {
    fun n(v: Double?) = v?.let(::number)
    fun money(v: Double?) = v?.let { Money.format(it.toLong()) }
    val text =
        when (type) {
            PromoType.PRICE_CUT -> money(params.toCents)?.let { stringResource(R.string.ui_promo_text_price_cut, it) }
            PromoType.PERCENT -> n(params.percent)?.let { stringResource(R.string.ui_promo_text_percent, it) }
            PromoType.NXM -> n(params.n)?.let { a -> n(params.m)?.let { b -> stringResource(R.string.ui_promo_text_nxm, a, b) } }
            PromoType.NTH_UNIT_DISCOUNT -> n(params.nth)?.let { a -> n(params.percent)?.let { b -> stringResource(R.string.ui_promo_text_nth, a, b) } }
            PromoType.MEMBER_PRICE -> money(params.memberCents)?.let { stringResource(R.string.ui_promo_text_member, it) }
            PromoType.COUPON -> money(params.amountCents)?.let { stringResource(R.string.ui_promo_text_coupon, it) }
            PromoType.MSI -> n(params.months)?.let { stringResource(R.string.ui_promo_text_msi, it) }
            PromoType.BUNDLE -> money(params.amountCents)?.let { stringResource(R.string.ui_promo_text_bundle, it) }
            PromoType.OTHER -> money(params.amountCents)?.let { stringResource(R.string.ui_promo_text_other, it) }
        }
    return text ?: stringResource(type.label())
}

private fun number(v: Double): String = if (v == kotlin.math.floor(v)) v.toLong().toString() else v.toString()

/** A whole or decimal number for promotion parameters (n, m, percent, months). */
@Composable
private fun NumberField(
    value: Double?,
    @StringRes label: Int,
    modifier: Modifier = Modifier,
    onValue: (Double?) -> Unit,
) {
    val text = value?.let(::number).orEmpty()
    OutlinedTextField(
        value = text,
        onValueChange = { s -> onValue(s.replace(',', '.').toDoubleOrNull()?.takeIf { it >= 0 }) },
        label = { Text(stringResource(label)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = modifier.fillMaxWidth(),
    )
}
