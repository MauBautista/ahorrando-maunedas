package com.maubautista.maunedas.core.designsystem.component

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.maubautista.maunedas.core.designsystem.R
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.model.Quantities

/**
 * A price in pesos with the decimal keyboard (05 §7): accepts "28.5" and "28,5" and reports cents, or null
 * while the text is empty or not a price (then it shows an error).
 */
@Composable
fun MoneyField(
    cents: Long?,
    onCentsChange: (Long?) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    imeAction: ImeAction = ImeAction.Next,
) {
    var text by rememberSaveable { mutableStateOf(cents?.let(Money::plain) ?: "") }
    val invalid = text.isNotBlank() && Money.parseCents(text) == null
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            onCentsChange(Money.parseCents(it))
        },
        label = { Text(label) },
        prefix = { Text("$") },
        isError = invalid,
        supportingText = if (invalid) ({ Text(stringResource(R.string.ds_invalid_price)) }) else null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = imeAction),
        modifier = modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget),
    )
}

/**
 * Quantity of a line: pieces, or kg/L with up to 3 decimals when sold by weight (05 §7). Reports a positive
 * number or null.
 */
@Composable
fun QuantityField(
    quantity: Double?,
    onQuantityChange: (Double?) -> Unit,
    label: String,
    soldByWeight: Boolean,
    modifier: Modifier = Modifier,
    imeAction: ImeAction = ImeAction.Next,
) {
    var text by rememberSaveable { mutableStateOf(quantity?.let(::plainQuantity) ?: "") }
    val parsed = Quantities.parse(text)
    val invalid = text.isNotBlank() && (parsed == null || (!soldByWeight && parsed % 1.0 != 0.0))
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            val value = Quantities.parse(it)
            onQuantityChange(if (value != null && (soldByWeight || value % 1.0 == 0.0)) value else null)
        },
        label = { Text(label) },
        isError = invalid,
        supportingText = if (invalid) ({ Text(stringResource(R.string.ds_invalid_quantity)) }) else null,
        singleLine = true,
        keyboardOptions =
            KeyboardOptions(keyboardType = if (soldByWeight) KeyboardType.Decimal else KeyboardType.Number, imeAction = imeAction),
        modifier = modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget),
    )
}

private fun plainQuantity(q: Double): String = if (q % 1.0 == 0.0) q.toLong().toString() else q.toString()
