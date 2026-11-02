package com.maubautista.maunedas.feature.tracking

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.AgentHealth
import com.maubautista.maunedas.core.data.AgentStatusRepository
import com.maubautista.maunedas.core.data.TrackedListing
import com.maubautista.maunedas.core.data.TrackingRepository
import com.maubautista.maunedas.core.model.Clock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TrackingState(
    val loading: Boolean = true,
    val listings: List<TrackedListing> = emptyList(),
    /** "Producto · Variante" when the screen shows one variant (the product page's "Precios en línea"). */
    val variantName: String? = null,
    val variantId: String? = null,
    /** The home agent's latest report: S-20 says when it stopped reporting (RF-ADM-03). */
    val agent: AgentHealth? = null,
)

/** S-20: the followed links (all, or one variant's), "Revisar ahora", pause and stop following. */
@HiltViewModel
class TrackingViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val tracking: TrackingRepository,
        private val clock: Clock,
        agents: AgentStatusRepository,
    ) : ViewModel() {
        private val variantId: String? = savedState.get<String>("variantId")

        val state: StateFlow<TrackingState> =
            combine(tracking.listings(variantId), variantId?.let(tracking::variantName) ?: flowOf(null), agents.status()) { listings, name, agent ->
                TrackingState(loading = false, listings = listings, variantName = name, variantId = variantId, agent = agent)
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TrackingState(variantId = variantId))

        private val stopping = MutableStateFlow<TrackedListing?>(null)

        /** The listing whose "Dejar de seguir" waits for confirmation. */
        val confirmStop: StateFlow<TrackedListing?> = stopping.asStateFlow()

        private val notices = Channel<String>(Channel.BUFFERED)

        /** The store whose check was asked, for "El servidor casero revisará … en unos minutos". */
        val checkAsked: Flow<String> = notices.receiveAsFlow()

        fun now(): Long = clock.nowMillis()

        fun checkNow(listing: TrackedListing) {
            tracking.checkNow(listing.id)
            notices.trySend(listing.storeName)
        }

        fun toggle(listing: TrackedListing) {
            viewModelScope.launch { tracking.setActive(listing.id, !listing.active) }
        }

        fun askStop(listing: TrackedListing) = stopping.tryEmit(listing)

        fun dismissStop() = stopping.tryEmit(null)

        fun stop() {
            val listing = stopping.value ?: return
            stopping.value = null
            viewModelScope.launch { tracking.stopFollowing(listing.id) }
        }
    }
