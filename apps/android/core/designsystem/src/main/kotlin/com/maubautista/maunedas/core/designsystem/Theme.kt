package com.maubautista.maunedas.core.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Everything here comes from Tokens.kt, generated from packages/design-tokens/tokens.json (`pnpm tokens`).

private fun c(argb: Long) = Color(argb)

private val LightColors: ColorScheme =
    with(Tokens.ColorLight) {
        lightColorScheme(
            primary = c(primary),
            onPrimary = c(onPrimary),
            secondary = c(primary),
            onSecondary = c(onPrimary),
            background = c(surface),
            onBackground = c(onSurface),
            surface = c(surface),
            onSurface = c(onSurface),
            surfaceVariant = c(surfaceVariant),
            onSurfaceVariant = c(onSurfaceVariant),
            outline = c(outline),
            error = c(error),
            onError = c(onError),
        )
    }

private val DarkColors: ColorScheme =
    with(Tokens.ColorDark) {
        darkColorScheme(
            primary = c(primary),
            onPrimary = c(onPrimary),
            secondary = c(primary),
            onSecondary = c(onPrimary),
            background = c(surface),
            onBackground = c(onSurface),
            surface = c(surface),
            onSurface = c(onSurface),
            surfaceVariant = c(surfaceVariant),
            onSurfaceVariant = c(onSurfaceVariant),
            outline = c(outline),
            error = c(error),
            onError = c(onError),
        )
    }

/** Colors Material 3 has no slot for: warning, success and one per price source (ARQUITECTURA §3.3). */
@Immutable
data class ExtendedColors(
    val warning: Color,
    val onWarning: Color,
    val success: Color,
    val onSuccess: Color,
    val purchase: Color,
    val shelf: Color,
    val web: Color,
)

private val LightExtended =
    ExtendedColors(
        warning = c(Tokens.ColorLight.warning),
        onWarning = c(Tokens.ColorLight.onWarning),
        success = c(Tokens.ColorLight.success),
        onSuccess = c(Tokens.ColorLight.onSuccess),
        purchase = c(Tokens.PriceSourceLight.purchase),
        shelf = c(Tokens.PriceSourceLight.shelf),
        web = c(Tokens.PriceSourceLight.web),
    )

private val DarkExtended =
    ExtendedColors(
        warning = c(Tokens.ColorDark.warning),
        onWarning = c(Tokens.ColorDark.onWarning),
        success = c(Tokens.ColorDark.success),
        onSuccess = c(Tokens.ColorDark.onSuccess),
        purchase = c(Tokens.PriceSourceDark.purchase),
        shelf = c(Tokens.PriceSourceDark.shelf),
        web = c(Tokens.PriceSourceDark.web),
    )

private fun style(
    sizeSp: Int,
    lineHeightSp: Int,
    weight: Int,
) = TextStyle(fontSize = sizeSp.sp, lineHeight = lineHeightSp.sp, fontWeight = FontWeight(weight))

private val MaunedasTypography =
    run {
        val display = style(Tokens.Typography.Display.sizeSp, Tokens.Typography.Display.lineHeightSp, Tokens.Typography.Display.weight)
        val title = style(Tokens.Typography.Title.sizeSp, Tokens.Typography.Title.lineHeightSp, Tokens.Typography.Title.weight)
        val body = style(Tokens.Typography.Body.sizeSp, Tokens.Typography.Body.lineHeightSp, Tokens.Typography.Body.weight)
        val label = style(Tokens.Typography.Label.sizeSp, Tokens.Typography.Label.lineHeightSp, Tokens.Typography.Label.weight)
        val caption = style(Tokens.Typography.Caption.sizeSp, Tokens.Typography.Caption.lineHeightSp, Tokens.Typography.Caption.weight)
        Typography(
            displaySmall = display,
            headlineSmall = display,
            titleLarge = title,
            titleMedium = label.copy(fontSize = body.fontSize, lineHeight = body.lineHeight),
            bodyLarge = body,
            bodyMedium = label.copy(fontWeight = body.fontWeight),
            bodySmall = caption,
            labelLarge = label,
            labelMedium = caption.copy(fontWeight = label.fontWeight),
            labelSmall = caption,
        )
    }

private val MaunedasShapes =
    with(Tokens.Radius) {
        Shapes(
            extraSmall = RoundedCornerShape(sm.dp),
            small = RoundedCornerShape(md.dp),
            medium = RoundedCornerShape(lg.dp),
            large = RoundedCornerShape(xl.dp),
        )
    }

/** Spacing of the tokens in dp. */
object Spacing {
    val xs: Dp = Tokens.Spacing.xs.dp
    val sm: Dp = Tokens.Spacing.sm.dp
    val md: Dp = Tokens.Spacing.md.dp
    val lg: Dp = Tokens.Spacing.lg.dp
    val xl: Dp = Tokens.Spacing.xl.dp
    val xxl: Dp = Tokens.Spacing.xxl.dp

    /** Smallest touch target (05 §7). */
    val touchTarget: Dp = Tokens.touchTargetMinDp.dp
}

val LocalExtendedColors = staticCompositionLocalOf { LightExtended }

/** Light and dark Material 3 theme of the app, from the design tokens (T-106). */
@Composable
fun MaunedasTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalExtendedColors provides if (darkTheme) DarkExtended else LightExtended) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            typography = MaunedasTypography,
            shapes = MaunedasShapes,
            content = content,
        )
    }
}

/** `MaunedasTheme.extended.purchase`… */
object MaunedasTheme {
    val extended: ExtendedColors
        @Composable get() = LocalExtendedColors.current
}
