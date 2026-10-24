package com.maubautista.maunedas.feature.shelf

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.ShelfDraft
import com.maubautista.maunedas.core.data.ShelfRepository
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.pricing.ShelfPrices
import com.maubautista.maunedas.core.pricing.Units
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

data class ShelfState(
    val loading: Boolean = true,
    val variant: LineVariant? = null,
    val query: String = "",
    val results: List<VariantChoice> = emptyList(),
    /** A scanned code that is not in the catalog. */
    val unknownCode: String? = null,
    val storeId: String? = null,
    val branchId: String? = null,
    val priceCents: Long? = null,
    val promoType: PromoType? = null,
    val params: PromoParams = PromoParams(),
    val photoPath: String? = null,
    @StringRes val error: Int? = null,
    val saving: Boolean = false,
    /** Grows with each "Guardar y otro", so the screen says "Precio guardado". */
    val saved: Int = 0,
) {
    /** One unit with the promotion (2x1 → half), or null without one or when it does not change the price. */
    val effectiveCents: Long? get() = priceCents?.let { p -> promoType?.let { ShelfPrices.effective(it, params, p) } }

    /** What it costs per display unit ("$22.25/L"), with the promotion when it lowers the price. */
    fun perUnitCents(): Long? {
        val v = variant ?: return null
        val cents = effectiveCents ?: priceCents ?: return null
        return Units.displayCents(Units.centsPerBase(cents.toDouble(), 1.0, v.unitAmount, v.packCount), v.measure, v.displayUnit)
    }
}

/**
 * S-13 (RF-PRE-01): the variant (search, scan, or the one the scanner found), the store and branch (my last ones), the
 * price, an optional promotion and an optional photo; saving writes a `shelf` observation at the current time.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ShelfViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val shelf: ShelfRepository,
        private val editor: PurchaseEditor,
        private val photos: LocalPhotos,
    ) : ViewModel() {
        private val ui = MutableStateFlow(ShelfState())
        val state: StateFlow<ShelfState> = ui.asStateFlow()
        private val finished = Channel<Unit>(Channel.CONFLATED)
        val done: Flow<Unit> = finished.receiveAsFlow()
        private var search: Job? = null

        val stores: StateFlow<List<StoreChoice>> = editor.storesByRecentUse().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
        val branches: StateFlow<List<BranchChoice>> =
            ui.map { it.storeId }.distinctUntilChanged().flatMapLatest { id -> id?.let(editor::branchesOf) ?: flowOf(emptyList()) }
                .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

        init {
            val variantId = savedState.get<String>("variantId")
            viewModelScope.launch {
                val variant = variantId?.let { editor.variant(it) }
                val place = shelf.lastPlace()
                ui.update { it.copy(loading = false, variant = variant, storeId = place?.storeId, branchId = place?.branchId) }
            }
        }

        fun onQuery(query: String) {
            ui.update { it.copy(query = query, unknownCode = null) }
            search?.cancel()
            search =
                viewModelScope.launch {
                    delay(SEARCH_DELAY_MS)
                    val results = editor.searchVariants(query, ui.value.storeId)
                    ui.update { if (it.query == query) it.copy(results = results) else it }
                }
        }

        fun chooseVariant(choice: VariantChoice) = ui.update { it.copy(variant = choice.variant, query = "", results = emptyList(), error = null) }

        fun changeVariant() = ui.update { it.copy(variant = null) }

        /** A code read with "Escanear código": its variant, or a note that it is not in the catalog. */
        fun onCode(code: String) {
            viewModelScope.launch {
                val variant = shelf.variantOfCode(code)?.let { editor.variant(it) }
                ui.update { if (variant != null) it.copy(variant = variant, unknownCode = null, error = null) else it.copy(unknownCode = code) }
            }
        }

        fun chooseStore(store: StoreChoice) = ui.update { if (it.storeId == store.id) it else it.copy(storeId = store.id, branchId = null, error = null) }

        fun createStore(
            name: String,
            kind: String,
        ) {
            viewModelScope.launch { chooseStore(editor.createStore(name, kind)) }
        }

        fun chooseBranch(branch: BranchChoice?) = ui.update { it.copy(branchId = branch?.id) }

        fun createBranch(
            name: String,
            city: String?,
        ) {
            val store = ui.value.storeId ?: return
            viewModelScope.launch { chooseBranch(editor.createBranch(store, name, city)) }
        }

        suspend fun defaultCity(): String = editor.defaultBranchCity()

        fun onPrice(cents: Long?) = ui.update { it.copy(priceCents = cents, error = null) }

        fun onPromo(type: PromoType?) = ui.update { if (it.promoType == type) it else it.copy(promoType = type, params = PromoParams()) }

        fun onParams(change: (PromoParams) -> PromoParams) = ui.update { it.copy(params = change(it.params)) }

        /** The camera app's photo, reduced as a product photo (10 §4.2). */
        fun onPhoto(taken: File) {
            viewModelScope.launch {
                val reduced = photos.reduce(taken, LocalPhotos.Size.PRODUCT)
                ui.value.photoPath?.let { File(it).delete() }
                ui.update { it.copy(photoPath = reduced?.path, error = if (reduced == null) R.string.shelf_photo_failed else null) }
            }
        }

        fun removePhoto() {
            ui.value.photoPath?.let { File(it).delete() }
            ui.update { it.copy(photoPath = null) }
        }

        /** Leaving without saving discards the photo too. */
        fun leave() {
            removePhoto()
            finished.trySend(Unit)
        }

        /**
         * Saves the price; [promoText] is how the promotion reads. With [another], the store and branch stay for the
         * next price on the same shelf walk.
         */
        fun save(
            another: Boolean,
            promoText: String?,
        ) {
            val s = ui.value
            if (s.saving) return
            val variant = s.variant
            val store = s.storeId
            val price = s.priceCents
            val problem =
                when {
                    variant == null -> R.string.shelf_need_variant
                    store == null -> R.string.shelf_need_store
                    price == null || price <= 0 -> R.string.shelf_need_price
                    else -> null
                }
            if (problem != null || variant == null || store == null || price == null) return ui.update { it.copy(error = problem) }
            ui.update { it.copy(saving = true, error = null) }
            viewModelScope.launch {
                shelf.save(ShelfDraft(variant.id, store, s.branchId, price, s.promoType, s.params, promoText.takeIf { s.promoType != null }, s.photoPath))
                if (another) {
                    ui.update { ShelfState(loading = false, storeId = it.storeId, branchId = it.branchId, saved = it.saved + 1) }
                } else {
                    ui.update { it.copy(saving = false, photoPath = null) }
                    finished.trySend(Unit)
                }
            }
        }

        private companion object {
            const val SEARCH_DELAY_MS = 250L
        }
    }
