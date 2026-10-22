package com.maubautista.maunedas.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.maubautista.maunedas.core.data.CatalogItem
import com.maubautista.maunedas.core.data.CatalogRepository
import com.maubautista.maunedas.core.data.CategoryNode
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.model.Clock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import javax.inject.Inject

data class CatalogFilters(
    val query: String = "",
    val category: CategoryNode? = null,
    val tag: TagItem? = null,
)

/** S-07 (05 §5): local search and filters over Room. */
@HiltViewModel
class CatalogViewModel
    @Inject
    constructor(
        catalog: CatalogRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val filterState = MutableStateFlow(CatalogFilters())
        val filters: StateFlow<CatalogFilters> = filterState.asStateFlow()

        /** Typing waits a moment before searching, so each key does not start a new query. */
        @OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
        val products: Flow<PagingData<CatalogItem>> =
            filterState
                .debounce(SEARCH_DELAY_MS)
                .distinctUntilChanged()
                .flatMapLatest { catalog.products(it.query, it.category?.id, it.tag?.id) }
                .cachedIn(viewModelScope)

        val categories: StateFlow<List<CategoryNode>> = catalog.categories().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
        val tags: StateFlow<List<TagItem>> = catalog.tags().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        /** Null until Room answers: neither empty message shows before that. */
        val hasProducts: StateFlow<Boolean?> = catalog.hasProducts().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

        fun now(): Long = clock.nowMillis()

        fun onQueryChange(query: String) = filterState.update { it.copy(query = query) }

        fun onCategory(category: CategoryNode?) = filterState.update { it.copy(category = category) }

        fun onTag(tag: TagItem?) = filterState.update { it.copy(tag = tag) }

        private companion object {
            const val SEARCH_DELAY_MS = 250L
        }
    }
