package com.maubautista.maunedas.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.R
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Money

/** Where a price comes from; the UI always tells them apart (ARQUITECTURA §3.3). */
enum class PriceSource { PURCHASE, SHELF, WEB }

@Composable
fun DisplayUnit.label(): String =
    stringResource(
        when (this) {
            DisplayUnit.KG -> R.string.ds_unit_kg
            DisplayUnit.G100 -> R.string.ds_unit_100g
            DisplayUnit.L -> R.string.ds_unit_l
            DisplayUnit.ML100 -> R.string.ds_unit_100ml
            DisplayUnit.PZ -> R.string.ds_unit_pz
        },
    )

/**
 * A price as the family reads it: "$159.00  $26.50/L", with a dot of the source color (paid, shelf, web)
 * that screen readers announce. The per-unit price is rounded only here (CLAUDE.md rule 1).
 */
@Composable
fun PriceText(
    cents: Long,
    modifier: Modifier = Modifier,
    perUnitCents: Long? = null,
    unit: DisplayUnit? = null,
    source: PriceSource? = null,
) {
    val perUnit = if (perUnitCents != null && unit != null) stringResource(R.string.ds_per_unit, Money.format(perUnitCents), unit.label()) else null
    val price = MaterialTheme.typography.titleMedium.toSpanStyle()
    val secondary = MaterialTheme.typography.bodyMedium.toSpanStyle().copy(color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (source != null) {
            val (color, name) =
                when (source) {
                    PriceSource.PURCHASE -> MaunedasTheme.extended.purchase to stringResource(R.string.ds_source_purchase)
                    PriceSource.SHELF -> MaunedasTheme.extended.shelf to stringResource(R.string.ds_source_shelf)
                    PriceSource.WEB -> MaunedasTheme.extended.web to stringResource(R.string.ds_source_web)
                }
            Box(Modifier.size(Spacing.md).background(color, CircleShape).semantics { contentDescription = name })
        }
        // One text with two styles: at large font sizes the price per unit wraps to the next line (RNF-08).
        Text(
            buildAnnotatedString {
                withStyle(price) { append(Money.format(cents)) }
                if (perUnit != null) {
                    append("  ")
                    withStyle(secondary) { append(perUnit) }
                }
            },
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
