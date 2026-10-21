package com.maubautista.maunedas.core.designsystem.component

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.DisplayUnit

/** Every base component with sample data; the font-scale test renders the same at 200 % (05 §7). */
@Composable
fun ComponentGallery() {
    Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MoneyField(cents = 2850, onCentsChange = {}, label = "Precio unitario")
        QuantityField(quantity = 0.845, onQuantityChange = {}, label = "Cantidad (kg)", soldByWeight = true)
        StorePicker(
            stores = listOf(StoreOption("s1", "Walmart Supercenter Plaza Dorada"), StoreOption("s2", "Costco")),
            selectedId = "s1",
            onSelect = {},
            label = "Tienda",
        )
        VariantSearchField(
            query = "leche",
            onQueryChange = {},
            results = listOf(VariantOption("v1", "Leche Lala Entera Ultrapasteurizada", "6 × 1 L", "Lala")),
            onSelect = {},
            label = "Buscar producto",
        )
        PriceText(cents = 15_900, perUnitCents = 2_650, unit = DisplayUnit.L, source = PriceSource.PURCHASE)
        PriceText(cents = 2_700, perUnitCents = 2_700, unit = DisplayUnit.L, source = PriceSource.SHELF)
        PriceText(cents = 32_900, perUnitCents = 685, unit = DisplayUnit.PZ, source = PriceSource.WEB)
    }
}

@Preview(name = "Claro", showBackground = true, widthDp = 360)
@Preview(name = "Oscuro", showBackground = true, widthDp = 360, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "Fuente 200 %", showBackground = true, widthDp = 360, fontScale = 2f)
@Composable
private fun ComponentGalleryPreview() {
    MaunedasTheme {
        Surface { ComponentGallery() }
    }
}
