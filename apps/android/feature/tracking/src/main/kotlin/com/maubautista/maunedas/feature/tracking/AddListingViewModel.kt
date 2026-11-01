package com.maubautista.maunedas.feature.tracking

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.ResolveOutcome
import com.maubautista.maunedas.core.data.ResolvedLink
import com.maubautista.maunedas.core.data.TrackingRepository
import com.maubautista.maunedas.core.data.VariantOption
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AddListingState(
    val text: String = "",
    val resolving: Boolean = false,
    val link: ResolvedLink? = null,
    @StringRes val problem: Int? = null,
    /** A message of the Worker shown as it came (an error that is not one of the known reasons). */
    val problemText: String? = null,
    val variant: VariantOption? = null,
    val query: String = "",
    val results: List<VariantOption> = emptyList(),
    val searched: Boolean = false,
    val saving: Boolean = false,
) {
    val canSave: Boolean get() = link != null && link.followedBy == null && variant != null && !saving
}

/**
 * S-21: a link typed or shared from another app (`ACTION_SEND`, T-220) → `POST /v1/listings/resolve` → the variant
 * → the listing by sync. A shared text is resolved at once; the product page's variant comes chosen.
 */
@HiltViewModel
class AddListingViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val tracking: TrackingRepository,
    ) : ViewModel() {
        private val ui = MutableStateFlow(AddListingState(text = savedState.get<String>("text").orEmpty()))
        val state: StateFlow<AddListingState> = ui.asStateFlow()
        private val finished = Channel<Unit>(Channel.CONFLATED)
        val done: Flow<Unit> = finished.receiveAsFlow()
        private var search: Job? = null

        init {
            val variantId = savedState.get<String>("variantId")
            viewModelScope.launch {
                if (variantId != null) {
                    tracking.variantName(variantId).first()?.let { name -> ui.update { it.copy(variant = VariantOption(variantId, name, null)) } }
                }
                if (ui.value.text.isNotBlank()) resolve()
            }
        }

        fun onText(text: String) = ui.update { it.copy(text = text, problem = null, problemText = null) }

        fun resolve() {
            val text = ui.value.text
            if (text.isBlank() || ui.value.resolving) return
            ui.update { it.copy(resolving = true, problem = null, problemText = null) }
            viewModelScope.launch {
                when (val outcome = tracking.resolve(text)) {
                    is ResolveOutcome.Resolved -> ui.update { it.copy(resolving = false, link = outcome.link) }
                    is ResolveOutcome.Unsupported -> ui.update { it.copy(resolving = false, problem = reasonText(outcome.reason)) }
                    ResolveOutcome.NoNetwork -> ui.update { it.copy(resolving = false, problem = R.string.add_no_network) }
                    is ResolveOutcome.Failed -> ui.update { it.copy(resolving = false, problemText = outcome.message) }
                }
            }
        }

        fun otherLink() = ui.update { it.copy(link = null, problem = null, problemText = null) }

        fun onQuery(query: String) {
            ui.update { it.copy(query = query, searched = false) }
            search?.cancel()
            search =
                viewModelScope.launch {
                    delay(SEARCH_DELAY_MS)
                    val results = tracking.searchVariants(query)
                    ui.update { if (it.query == query) it.copy(results = results, searched = query.isNotBlank()) else it }
                }
        }

        fun choose(variant: VariantOption) = ui.update { it.copy(variant = variant, query = "", results = emptyList(), searched = false) }

        fun changeVariant() = ui.update { it.copy(variant = null) }

        fun save() {
            val s = ui.value
            val link = s.link ?: return
            val variant = s.variant ?: return
            if (!s.canSave) return
            ui.update { it.copy(saving = true) }
            viewModelScope.launch {
                tracking.follow(link, variant.id)
                finished.trySend(Unit)
            }
        }

        companion object {
            const val SEARCH_DELAY_MS = 250L

            @StringRes
            fun reasonText(reason: String?): Int =
                when (reason) {
                    "NO_URL" -> R.string.add_reason_no_url
                    "SHORT_LINK" -> R.string.add_reason_short_link
                    "NOT_TRACKED" -> R.string.add_reason_not_tracked
                    "NO_STORE" -> R.string.add_reason_no_store
                    else -> R.string.add_unsupported
                }
        }
    }
