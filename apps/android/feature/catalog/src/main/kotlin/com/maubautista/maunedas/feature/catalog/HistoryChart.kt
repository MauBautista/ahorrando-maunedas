package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.maubautista.maunedas.core.data.HistoryPoint
import com.maubautista.maunedas.core.data.VariantHistory
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.HouseholdTime
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.Dates
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.Zoom
import com.patrykandpatrick.vico.compose.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModel
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.compose.cartesian.data.lineSeries
import com.patrykandpatrick.vico.compose.cartesian.layer.LineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLine
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.cartesian.rememberVicoZoomState
import com.patrykandpatrick.vico.compose.common.Fill
import com.patrykandpatrick.vico.compose.common.component.rememberShapeComponent
import com.maubautista.maunedas.core.designsystem.R as DesignR

/**
 * One series of the chart: x is the calendar day in Mexico City, y the price per unit in pesos. [steps] series are
 * lines without points; the others, points without lines.
 */
data class ChartSeries(
    val source: String,
    val x: List<Long>,
    val y: List<Double>,
    val steps: Boolean = false,
    /** The listing of a web steps series. */
    val listingId: String? = null,
) {
    val key: String get() = if (steps) "$STEPS_PREFIX$listingId" else source
}

private const val STEPS_PREFIX = "web-steps:"

/**
 * The history (RF-PRE-02): purchases and shelf prices as points, web prices as points over steps (T-222), one per
 * listing: each price holds until the next one, and the last until the listing's last check ([confirmedUntil],
 * `web_confirmed_until`). Steps go first so the points are drawn over them; empty sources are left out.
 */
fun chartSeries(
    points: List<HistoryPoint>,
    confirmedUntil: Map<String, Long> = emptyMap(),
): List<ChartSeries> {
    val steps =
        points.filter { it.source == "web" && it.listingId != null }.groupBy { it.listingId!! }.mapNotNull { (listing, own) ->
            val xs = mutableListOf<Long>()
            val ys = mutableListOf<Double>()
            own.forEachIndexed { i, p ->
                val x = HouseholdTime.epochDay(p.observedAt)
                if (i > 0) {
                    xs += x
                    ys += ys.last()
                }
                xs += x
                ys += p.displayCents / 100.0
            }
            confirmedUntil[listing]?.let(HouseholdTime::epochDay)?.takeIf { it > xs.last() }?.let { until ->
                xs += until
                ys += ys.last()
            }
            if (xs.size < 2) null else ChartSeries("web", xs, ys, steps = true, listingId = listing)
        }
    val dots =
        SOURCES.mapNotNull { source ->
            val own = points.filter { it.source == source }
            if (own.isEmpty()) null else ChartSeries(source, own.map { HouseholdTime.epochDay(it.observedAt) }, own.map { it.displayCents / 100.0 })
        }
    return steps + dots
}

/** A sentence for screen readers: how many prices, from when to when, the lowest and the highest. */
@Composable
fun chartDescription(
    history: VariantHistory,
    now: Long,
): String {
    val points = history.points
    val unit = history.unit.label()
    val lowest = stringResource(DesignR.string.ds_per_unit, Money.format(points.minOf { it.displayCents }), unit)
    val highest = stringResource(DesignR.string.ds_per_unit, Money.format(points.maxOf { it.displayCents }), unit)
    return stringResource(
        R.string.history_chart,
        points.size,
        unit,
        Dates.shortDate(points.first().observedAt, now),
        Dates.shortDate(points.last().observedAt, now),
        lowest,
        highest,
    )
}

private val SOURCES = listOf("purchase", "shelf", "web")

@Composable
fun HistoryChart(
    history: VariantHistory,
    now: Long,
    modifier: Modifier = Modifier,
) {
    val series = remember(history.points, history.webConfirmedUntil) { chartSeries(history.points, history.webConfirmedUntil) }
    val producer = remember { CartesianChartModelProducer() }
    LaunchedEffect(series) {
        producer.runTransaction { lineSeries { series.forEach { series(x = it.x, y = it.y, key = it.key) } } }
    }
    // Points without lines: a line between two purchases would suggest prices nobody saw. Web prices are known to
    // hold between checks, so they also get steps (T-222).
    val colors = mapOf("purchase" to MaunedasTheme.extended.purchase, "shelf" to MaunedasTheme.extended.shelf, "web" to MaunedasTheme.extended.web)
    val lines =
        SOURCES.associateWith { source ->
            val color = colors.getValue(source)
            LineCartesianLayer.rememberLine(
                fill = remember { LineCartesianLayer.LineFill.single(Fill(Color.Transparent)) },
                pointProvider = LineCartesianLayer.PointProvider.single(LineCartesianLayer.Point(rememberShapeComponent(Fill(color), CircleShape), 10.dp)),
            )
        }
    val webSteps = LineCartesianLayer.rememberLine(fill = remember { LineCartesianLayer.LineFill.single(Fill(colors.getValue("web"))) }, pointProvider = null)
    val lineProvider =
        remember(lines, webSteps) {
            LineCartesianLayer.LineProvider { key, _, _ -> if ((key as String).startsWith(STEPS_PREFIX)) webSteps else lines.getValue(key) }
        }
    // About five dates on the axis, whatever the period.
    val span = series.flatMap { it.x }.let { xs -> if (xs.isEmpty()) 0L else xs.max() - xs.min() }
    val spacing = (span / 4).toInt().coerceAtLeast(1)
    val chart =
        rememberCartesianChart(
            rememberLineCartesianLayer(lineProvider = lineProvider),
            startAxis =
                VerticalAxis.rememberStart(
                    valueFormatter = remember { CartesianValueFormatter { _, value, _ -> Money.format(kotlin.math.round(value * 100).toLong()) } },
                ),
            bottomAxis =
                HorizontalAxis.rememberBottom(
                    valueFormatter = remember(now) { CartesianValueFormatter { _, value, _ -> Dates.shortDateOfDay(value.toLong(), now) } },
                    itemPlacer = remember(spacing) { HorizontalAxis.ItemPlacer.aligned(spacing = { spacing }) },
                ),
            getXStep = { _: CartesianChartModel -> 1.0 },
        )
    val description = chartDescription(history, now)
    CartesianChartHost(
        chart = chart,
        modelProducer = producer,
        modifier = modifier.fillMaxWidth().height(240.dp).semantics { contentDescription = description },
        zoomState = rememberVicoZoomState(zoomEnabled = true, initialZoom = remember { Zoom.Content }),
    )
}
