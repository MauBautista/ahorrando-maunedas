package com.maubautista.maunedas.feature.scan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.CatalogGuess
import com.maubautista.maunedas.core.data.OpenDraft
import com.maubautista.maunedas.core.data.ProductChoice
import com.maubautista.maunedas.core.data.RemoteLookup
import com.maubautista.maunedas.core.data.ScanHit
import com.maubautista.maunedas.core.data.ScanRepository
import com.maubautista.maunedas.core.model.Clock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** S-12 (05 §5): the four paths of a scanned code. */
sealed interface ScanResult {
    val code: String

    data class Looking(
        override val code: String,
    ) : ScanResult

    /** Path 2: it is here. */
    data class Found(
        override val code: String,
        val hit: ScanHit,
        val draft: OpenDraft?,
    ) : ScanResult

    /** Path 3 "match": on the server, coming down with a pull. */
    data class Pulling(
        override val code: String,
        val productName: String,
        val variantLabel: String,
    ) : ScanResult

    /** Path 3 "catalog" (with [guess]) or path 4 (without): a new product, or a new variant of one we have. */
    data class New(
        override val code: String,
        val guess: CatalogGuess?,
        val offline: Boolean,
        /** Searching an existing product for "¿Es otra presentación…?". */
        val query: String = "",
        val choices: List<ProductChoice> = emptyList(),
        val choosing: Boolean = false,
    ) : ScanResult
}

@HiltViewModel
class ScanViewModel
    @Inject
    constructor(
        private val repo: ScanRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val state = MutableStateFlow<ScanResult?>(null)

        /** Null while the camera is looking for a code. */
        val result: StateFlow<ScanResult?> = state.asStateFlow()

        private var job: Job? = null
        private var search: Job? = null

        fun now(): Long = clock.nowMillis()

        fun onCode(code: String) {
            job?.cancel()
            state.value = ScanResult.Looking(code)
            job =
                viewModelScope.launch {
                    if (repo.local(code).first() == null) {
                        when (val remote = repo.lookup(code)) {
                            is RemoteLookup.Match -> {
                                state.value = ScanResult.Pulling(code, remote.productName, remote.variantLabel)
                                repo.pullNow()
                            }
                            is RemoteLookup.Catalog -> {
                                state.value = ScanResult.New(code, remote.guess, offline = false)
                                return@launch
                            }
                            RemoteLookup.NotFound, RemoteLookup.Failed -> {
                                state.value = ScanResult.New(code, null, offline = false)
                                return@launch
                            }
                            RemoteLookup.NoNetwork -> {
                                state.value = ScanResult.New(code, null, offline = true)
                                return@launch
                            }
                        }
                    }
                    // Found here, or once the pull brings it; the open draft and prices follow Room.
                    combine(repo.local(code).filterNotNull(), repo.openDraft()) { hit, draft -> ScanResult.Found(code, hit, draft) }
                        .collect { state.value = it }
                }
        }

        fun chooseExisting() = state.update { (it as? ScanResult.New)?.copy(choosing = true) ?: it }

        fun onProductQuery(query: String) {
            state.update { (it as? ScanResult.New)?.copy(query = query) ?: it }
            search?.cancel()
            search =
                viewModelScope.launch {
                    delay(SEARCH_DELAY_MS)
                    val choices = repo.searchProducts(query)
                    state.update { s -> (s as? ScanResult.New)?.takeIf { it.query == query }?.copy(choices = choices) ?: s }
                }
        }

        /** Back to the camera. */
        fun dismiss() {
            job?.cancel()
            state.value = null
        }

        private companion object {
            const val SEARCH_DELAY_MS = 250L
        }
    }
