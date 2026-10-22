package com.maubautista.maunedas.core.ui

import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/** Whether the phone is set to a 24-hour clock; times in the app follow it ([Dates.time]). */
@Composable
fun clock24h(): Boolean = DateFormat.is24HourFormat(LocalContext.current)
