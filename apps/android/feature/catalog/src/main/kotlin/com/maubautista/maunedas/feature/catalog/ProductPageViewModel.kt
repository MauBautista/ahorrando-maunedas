package com.maubautista.maunedas.feature.catalog

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.auth.SessionStore
import com.maubautista.maunedas.core.data.CatalogEditor
import com.maubautista.maunedas.core.data.CatalogMerger
import com.maubautista.maunedas.core.data.HistoryFilter
import com.maubautista.maunedas.core.data.MergeCandidate
import com.maubautista.maunedas.core.data.MergeResult
import com.maubautista.maunedas.core.data.PageVariant
import com.maubautista.maunedas.core.data.ProductPage
import com.maubautista.maunedas.core.data.ProductPageRepository
import com.maubautista.maunedas.core.data.VariantHistory
import com.maubautista.maunedas.core.data.VariantHistoryRepository
import com.maubautista.maunedas.core.model.Clock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** [loaded] tells "not read yet" from "gone" (deleted or merged into another product). */
data class PageState(
    val loaded: Boolean = false,
    val page: ProductPage? = null,
)

/** Where the page sends the person after an action. */
sealed interface PageEvent {
    /** The product was merged into [productId]: show that one instead. */
    data class Moved(
        val productId: String,
    ) : PageEvent

    data object Deleted : PageEvent
}

/** S-08 (05 §5). Route argument `productId`. */
@HiltViewModel
class ProductPageViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        pages: ProductPageRepository,
        histories: VariantHistoryRepository,
        private val merger: CatalogMerger,
        private val editor: CatalogEditor,
        session: SessionStore,
        private val clock: Clock,
    ) : ViewModel() {
        private val productId: String = checkNotNull(savedState["productId"])

        val state: StateFlow<PageState> = pages.page(productId).map { PageState(true, it) }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PageState())
        val isAdmin: StateFlow<Boolean> = session.user.map { it?.isAdmin == true }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

        private val mergeState = MutableStateFlow<MergeState?>(null)
        val merge: StateFlow<MergeState?> = mergeState.asStateFlow()

        /** Candidates follow the kind and source of the merge in progress and its search. */
        @OptIn(ExperimentalCoroutinesApi::class)
        val candidates: StateFlow<List<MergeCandidate>> =
            mergeState.map { s -> s?.let { Triple(it.kind, it.sourceId, measureOf(it)) } }.distinctUntilChanged().flatMapLatest { key ->
                if (key == null) {
                    flowOf(emptyList())
                } else {
                    val query = mergeState.filterNotNull().map { it.query }
                    when (key.first) {
                        MergeKind.PRODUCT -> merger.productCandidates(key.second, query)
                        MergeKind.VARIANT -> merger.variantCandidates(key.second, checkNotNull(key.third), query)
                    }
                }
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        private val historyVariant = MutableStateFlow<String?>(null)
        private val historyFilterState = MutableStateFlow(HistoryFilter())
        val historyFilter: StateFlow<HistoryFilter> = historyFilterState.asStateFlow()

        /** The variant whose history shows: the one picked, or the first one. */
        val historyVariantId: StateFlow<String?> =
            combine(state, historyVariant) { s, picked -> picked?.takeIf { id -> s.page?.variants?.any { it.id == id } == true } ?: s.page?.variants?.firstOrNull()?.id }
                .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

        @OptIn(ExperimentalCoroutinesApi::class)
        val history: StateFlow<VariantHistory?> =
            combine(historyVariantId, state.map { it.page?.displayUnit }.distinctUntilChanged(), historyFilterState) { id, unit, filter -> Triple(id, unit, filter) }
                .distinctUntilChanged()
                .flatMapLatest { (id, unit, filter) -> if (id == null || unit == null) flowOf(null) else histories.history(id, unit, filter) }
                .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

        fun pickHistoryVariant(id: String) {
            historyVariant.value = id
        }

        fun onHistoryFilter(change: (HistoryFilter) -> HistoryFilter) = historyFilterState.update(change)

        private val messageState = MutableStateFlow<Int?>(null)

        @StringRes
        val message: StateFlow<Int?> = messageState.asStateFlow()

        private val confirmDeleteState = MutableStateFlow(false)
        val confirmDelete: StateFlow<Boolean> = confirmDeleteState.asStateFlow()

        private val events = Channel<PageEvent>(Channel.BUFFERED)
        val navigation = events.receiveAsFlow()

        fun now(): Long = clock.nowMillis()

        fun startProductMerge() {
            val page = state.value.page ?: return
            mergeState.value = MergeState(MergeKind.PRODUCT, page.id, page.name)
        }

        fun startVariantMerge(variant: PageVariant) {
            mergeState.value = MergeState(MergeKind.VARIANT, variant.id, variant.label)
        }

        fun onMergeQuery(query: String) = mergeState.update { it?.copy(query = query) }

        fun pickTarget(target: MergeCandidate?) = mergeState.update { it?.copy(target = target) }

        fun cancelMerge() {
            mergeState.value = null
        }

        fun confirmMerge() {
            val s = mergeState.value ?: return
            val target = s.target ?: return
            if (s.busy) return
            mergeState.value = s.copy(busy = true)
            viewModelScope.launch {
                val result =
                    when (s.kind) {
                        MergeKind.PRODUCT -> merger.mergeProducts(s.sourceId, target.id)
                        MergeKind.VARIANT -> merger.mergeVariants(s.sourceId, target.id)
                    }
                mergeState.value = null
                when {
                    result == MergeResult.Done && s.kind == MergeKind.PRODUCT -> events.send(PageEvent.Moved(target.id))
                    result == MergeResult.Done -> messageState.value = R.string.merge_done
                    else -> messageState.value = result.message()
                }
            }
        }

        fun dismissMessage() {
            messageState.value = null
        }

        fun askDelete() {
            confirmDeleteState.value = true
        }

        fun dismissDelete() {
            confirmDeleteState.value = false
        }

        fun delete() {
            confirmDeleteState.value = false
            viewModelScope.launch {
                editor.deleteProduct(productId)
                events.send(PageEvent.Deleted)
            }
        }

        private fun measureOf(s: MergeState) = if (s.kind == MergeKind.VARIANT) state.value.page?.variants?.firstOrNull { it.id == s.sourceId }?.measure else null
    }
