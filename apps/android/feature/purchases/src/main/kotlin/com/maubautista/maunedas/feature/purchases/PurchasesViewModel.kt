package com.maubautista.maunedas.feature.purchases

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.maubautista.maunedas.core.data.PurchaseFilter
import com.maubautista.maunedas.core.data.PurchaseRepository
import com.maubautista.maunedas.core.data.StoreOption
import com.maubautista.maunedas.core.model.Clock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/** S-03 filters as chosen; [status] is "draft", "confirmed" or null. */
data class PurchaseFilters(
    val store: StoreOption? = null,
    val range: DateRange = DateRange.All,
    val status: String? = null,
) {
    val active: Boolean get() = store != null || range != DateRange.All || status != null

    /** What the repository filters by at [now]; the range ends one millisecond before the next day. */
    fun toFilter(now: Long): PurchaseFilter {
        val span = range.span(now)
        return PurchaseFilter(store?.id, status, span?.from ?: Long.MIN_VALUE, span?.let { it.until - 1 } ?: Long.MAX_VALUE)
    }
}

/** S-03 (05 §5): every purchase, newest first, grouped by day. */
@HiltViewModel
class PurchasesViewModel
    @Inject
    constructor(
        purchases: PurchaseRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val filterState = MutableStateFlow(PurchaseFilters())
        val filters: StateFlow<PurchaseFilters> = filterState.asStateFlow()

        @OptIn(ExperimentalCoroutinesApi::class)
        val items: Flow<PagingData<PurchaseListItem>> =
            filterState.flatMapLatest { purchases.page(it.toFilter(clock.nowMillis())) }.map { it.groupedByDay() }.cachedIn(viewModelScope)

        val stores: StateFlow<List<StoreOption>> = purchases.storesWithPurchases().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        /** Null until Room answers: neither empty message shows before that. */
        val hasPurchases: StateFlow<Boolean?> = purchases.hasPurchases().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

        fun now(): Long = clock.nowMillis()

        fun onStore(store: StoreOption?) = filterState.update { it.copy(store = store) }

        fun onRange(range: DateRange) = filterState.update { it.copy(range = range) }

        fun onStatus(status: String?) = filterState.update { it.copy(status = status) }
    }
