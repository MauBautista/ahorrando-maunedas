package com.maubautista.maunedas.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.auth.SessionStore
import com.maubautista.maunedas.core.data.PurchaseRepository
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.data.SyncHealthRepository
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.HouseholdTime
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import java.time.YearMonth
import javax.inject.Inject

/** S-02 (05 §5). [loaded] is false until Room answers, so the empty state does not flash. */
data class HomeUiState(
    val loaded: Boolean = false,
    val displayName: String = "",
    val month: YearMonth = YearMonth.of(2026, 1),
    val monthSpentCents: Long = 0,
    val recent: List<PurchaseSummary> = emptyList(),
    val openDrafts: Int = 0,
    val pending: Int = 0,
    val rejected: Int = 0,
    /** For "Hoy" and "Ayer" in the dates. */
    val now: Long = 0,
)

@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        session: SessionStore,
        purchases: PurchaseRepository,
        health: SyncHealthRepository,
        clock: Clock,
    ) : ViewModel() {
        /** The month is read each time the screen starts observing: reopening the app in a new month moves it. */
        @OptIn(ExperimentalCoroutinesApi::class)
        val state: StateFlow<HomeUiState> =
            flow { emit(clock.nowMillis()) }
                .flatMapLatest { now ->
                    val month = HouseholdTime.monthOf(now)
                    combine(session.user, purchases.recent(RECENT), purchases.spentIn(month), purchases.openDrafts(), health.backlog()) {
                            user, recent, spent, drafts, backlog ->
                        HomeUiState(true, user?.displayName.orEmpty(), month, spent, recent, drafts, backlog.pending, backlog.rejected, now)
                    }
                }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUiState())

        private companion object {
            const val RECENT = 5
        }
    }
