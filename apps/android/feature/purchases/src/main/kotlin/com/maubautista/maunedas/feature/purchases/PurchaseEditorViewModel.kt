package com.maubautista.maunedas.feature.purchases

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.PurchaseLine
import com.maubautista.maunedas.core.data.RemoteLookup
import com.maubautista.maunedas.core.data.ScanRepository
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.data.TicketDiscount
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.HouseholdTime
import com.maubautista.maunedas.core.pricing.PurchaseMath
import com.maubautista.maunedas.core.pricing.PurchaseTotals
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
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import javax.inject.Inject

/** A ticket discount being typed. */
data class DiscountForm(
    val index: Int? = null,
    val description: String = "",
    val amountCents: Long? = null,
)

/** A code read in continuous mode that is not here yet. */
data class PendingCode(
    val code: String,
    /** "Producto · presentación" when the server has it and it is being pulled; null when it is not in the catalog. */
    val name: String?,
    val offline: Boolean = false,
)

/**
 * Continuous scanning (RF-COM-09): each code read becomes a line, or adds one to the same product already in the
 * purchase, and [lineIndex] is the line whose price is typed next.
 */
data class ScanSession(
    val lineIndex: Int? = null,
    /** Grows with each line added or counted, so the price field starts over and takes the focus. */
    val reads: Int = 0,
    val looking: String? = null,
)

data class EditorState(
    val loading: Boolean = true,
    val draft: PurchaseDraft = PurchaseDraft(purchasedAt = 0),
    val line: LineForm? = null,
    val discount: DiscountForm? = null,
    /** The last line taken away, with its place, until "Deshacer" or the next change. */
    val removed: Pair<Int, PurchaseLine>? = null,
    @StringRes val problem: Int? = null,
    /** RF-COM-06: asking to confirm a total that does not match by this much. */
    val mismatchCents: Long? = null,
    val confirmDelete: Boolean = false,
    val busy: Boolean = false,
    /** Continuous scanning is open. */
    val scan: ScanSession? = null,
    /** Codes read that are not here yet; they wait with the camera closed too, and each becomes a line when it arrives. */
    val pending: List<PendingCode> = emptyList(),
) {
    val isNew: Boolean get() = draft.id == null

    val totals: PurchaseTotals get() = PurchaseMath.totals(draft.lines.map { it.amounts.finalCents }, draft.ticketDiscounts.map { it.amountCents }, draft.ticketTotalCents)
}

/** S-04 (05 §5). Route argument `purchaseId`: null starts a new purchase now. */
@HiltViewModel
class PurchaseEditorViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val editor: PurchaseEditor,
        private val scans: ScanRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val purchaseId: String? = savedState["purchaseId"]

        /** "Agregar a la compra abierta" from the scanner (S-12): the line sheet opens with this variant. */
        private val addVariantId: String? = savedState["addVariantId"]
        private val ui = MutableStateFlow(EditorState())
        val state: StateFlow<EditorState> = ui.asStateFlow()

        val stores: StateFlow<List<StoreChoice>> = editor.storesByRecentUse().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        @OptIn(ExperimentalCoroutinesApi::class)
        val branches: StateFlow<List<BranchChoice>> =
            ui.map { it.draft.storeId }.flatMapLatest { id -> id?.let(editor::branchesOf) ?: flowOf(emptyList()) }
                .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        private val finished = Channel<Unit>(Channel.BUFFERED)
        val done: Flow<Unit> = finished.receiveAsFlow()

        /** What was last written, so leaving without changes writes nothing. */
        private var saved: PurchaseDraft? = null

        /** One write at a time: leaving and going to the background both autosave, and a new purchase must be created once. */
        private val writing = Mutex()
        private var search: Job? = null

        /** Codes waiting to be here (pulled, or added to the catalog meanwhile); each becomes a line when it arrives. */
        private val watching = mutableMapOf<String, Job>()

        init {
            viewModelScope.launch {
                val draft = purchaseId?.let { editor.load(it) } ?: PurchaseDraft(purchasedAt = clock.nowMillis())
                saved = draft.takeIf { it.id != null }
                val line =
                    addVariantId?.let { id ->
                        editor.variant(id)?.let { v -> LineForm().withVariant(VariantChoice(v, draft.storeId?.let { store -> editor.lastListPrice(id, store) })) }
                    }
                ui.value = EditorState(loading = false, draft = draft, line = line)
            }
        }

        fun now(): Long = clock.nowMillis()

        private fun change(block: (PurchaseDraft) -> PurchaseDraft) = ui.update { it.copy(draft = block(it.draft), problem = null, removed = null) }

        fun chooseStore(store: StoreChoice) = change { if (it.storeId == store.id) it else it.copy(storeId = store.id, branchId = null) }

        fun chooseBranch(branch: BranchChoice?) = change { it.copy(branchId = branch?.id) }

        fun createStore(
            name: String,
            kind: String,
        ) {
            if (name.isBlank()) return
            viewModelScope.launch { chooseStore(editor.createStore(name, kind)) }
        }

        fun createBranch(
            name: String,
            city: String,
        ) {
            val store = ui.value.draft.storeId ?: return
            if (name.isBlank()) return
            viewModelScope.launch { chooseBranch(editor.createBranch(store, name, city)) }
        }

        suspend fun defaultCity(): String = editor.defaultBranchCity()

        /** Day and time are Mexico City's; the other part stays. */
        fun setDate(date: LocalDate) =
            change {
                val time = Instant.ofEpochMilli(it.purchasedAt).atZone(HouseholdTime.ZONE).toLocalTime()
                it.copy(purchasedAt = date.atTime(time).atZone(HouseholdTime.ZONE).toInstant().toEpochMilli())
            }

        fun setTime(time: LocalTime) =
            change {
                val date = Instant.ofEpochMilli(it.purchasedAt).atZone(HouseholdTime.ZONE).toLocalDate()
                it.copy(purchasedAt = date.atTime(time).atZone(HouseholdTime.ZONE).toInstant().toEpochMilli())
            }

        fun setTicketTotal(cents: Long?) = change { it.copy(ticketTotalCents = cents) }

        // Lines (S-05)

        fun newLine() {
            if (ui.value.draft.storeId == null) {
                ui.update { it.copy(problem = R.string.editor_store_first) }
                return
            }
            ui.update { it.copy(line = LineForm()) }
        }

        fun editLine(index: Int) = ui.update { s -> s.copy(line = s.draft.lines.getOrNull(index)?.let(LineForm::of)) }

        fun onLine(change: (LineForm) -> LineForm) = ui.update { s -> s.copy(line = s.line?.let(change)) }

        /** Searches as someone types (a short pause first, so each key does not query). */
        fun onLineQuery(query: String) {
            onLine { it.copy(query = query) }
            search?.cancel()
            val store = ui.value.draft.storeId
            search =
                viewModelScope.launch {
                    delay(SEARCH_DELAY_MS)
                    val results = editor.searchVariants(query, store)
                    onLine { if (it.query == query) it.copy(results = results) else it }
                }
        }

        fun closeLine() = ui.update { it.copy(line = null) }

        /** Saves the line in its place (or at the end); [another] opens an empty form for the next one. */
        fun saveLine(another: Boolean) {
            val form = ui.value.line ?: return
            val (line, checked) = form.validate()
            if (line == null) {
                ui.update { it.copy(line = checked) }
                return
            }
            change { d ->
                val index = d.lines.indexOfFirst { form.lineId != null && it.id == form.lineId }
                d.copy(lines = if (index >= 0) d.lines.toMutableList().also { it[index] = line } else d.lines + line)
            }
            ui.update { it.copy(line = if (another) LineForm() else null) }
        }

        fun removeLine(index: Int) {
            val line = ui.value.draft.lines.getOrNull(index) ?: return
            change { d -> d.copy(lines = d.lines.filterIndexed { i, _ -> i != index }) }
            ui.update { it.copy(removed = index to line) }
        }

        fun undoRemove() {
            val (index, line) = ui.value.removed ?: return
            change { d -> d.copy(lines = d.lines.toMutableList().also { it.add(index.coerceAtMost(it.size), line) }) }
        }

        // Continuous scanning (RF-COM-09, S-11)

        fun startScanning() {
            if (ui.value.draft.storeId == null) {
                ui.update { it.copy(problem = R.string.editor_store_first) }
                return
            }
            ui.update { it.copy(scan = ScanSession(), problem = null) }
        }

        fun stopScanning() = ui.update { it.copy(scan = null) }

        /** A code read: a line if the code is here; otherwise the server is asked and the code waits for its product. */
        fun onScannedCode(code: String) {
            if (ui.value.scan == null || ui.value.pending.any { it.code == code }) return
            viewModelScope.launch {
                editor.variantOfCode(code)?.let { return@launch addScanned(it) }
                updateScan { it.copy(looking = code) }
                val pending =
                    when (val found = scans.lookup(code)) {
                        is RemoteLookup.Match -> {
                            scans.pullNow()
                            PendingCode(code, "${found.productName} · ${found.variantLabel}")
                        }
                        RemoteLookup.NoNetwork -> PendingCode(code, null, offline = true)
                        else -> PendingCode(code, null)
                    }
                updateScan { it.copy(looking = null) }
                ui.update { s -> s.copy(pending = s.pending.filter { it.code != code } + pending) }
                watch(code)
            }
        }

        /** Takes a waiting code off the list (a code read by mistake, or one not wanted any more). */
        fun dismissPending(code: String) {
            watching.remove(code)?.cancel()
            ui.update { s -> s.copy(pending = s.pending.filter { it.code != code }) }
        }

        /** The price of the line just scanned; empty means it has none yet. */
        fun onScanPrice(cents: Long?) = changeScanned { it.copy(unitPriceCents = cents ?: 0) }

        /** Whole pieces, at least one. */
        fun onScanStep(delta: Int) = changeScanned { it.copy(quantity = (it.quantity + delta).coerceAtLeast(1.0)) }

        fun onScanKilos(kilos: Double?) = changeScanned { if (kilos != null && kilos > 0) it.copy(quantity = kilos) else it }

        private fun updateScan(block: (ScanSession) -> ScanSession) = ui.update { s -> s.copy(scan = s.scan?.let(block)) }

        private fun changeScanned(block: (PurchaseLine) -> PurchaseLine) {
            val index = ui.value.scan?.lineIndex ?: return
            change { d -> d.copy(lines = d.lines.mapIndexed { i, line -> if (i == index) block(line) else line }) }
        }

        /**
         * The same product again counts one more on its line (if it has no promotion and is not weighed); anything else
         * is a new line of one piece at its last price at this store, or with no price yet.
         */
        private suspend fun addScanned(variant: LineVariant) {
            val store = ui.value.draft.storeId
            val price = store?.let { editor.lastListPrice(variant.id, it) }
            ui.update { s ->
                val lines = s.draft.lines
                val same = if (variant.soldByWeight) -1 else lines.indexOfLast { it.variant?.id == variant.id && it.promotion == null }
                val updated =
                    if (same >= 0) {
                        lines.mapIndexed { i, line -> if (i == same) line.copy(quantity = line.quantity + 1) else line }
                    } else {
                        lines + PurchaseLine(variant = variant, quantity = 1.0, unitPriceCents = price ?: 0)
                    }
                val index = if (same >= 0) same else lines.size
                s.copy(draft = s.draft.copy(lines = updated), problem = null, removed = null, scan = s.scan?.let { it.copy(lineIndex = index, reads = it.reads + 1) })
            }
        }

        private fun watch(code: String) {
            if (code in watching) return
            watching[code] =
                viewModelScope.launch {
                    val variant = editor.watchCode(code).filterNotNull().first()
                    watching.remove(code)
                    ui.update { s -> s.copy(pending = s.pending.filter { it.code != code }) }
                    addScanned(variant)
                }
        }

        // Ticket discounts (RF-COM-05)

        fun newDiscount() = ui.update { it.copy(discount = DiscountForm()) }

        fun editDiscount(index: Int) = ui.update { s -> s.copy(discount = s.draft.ticketDiscounts.getOrNull(index)?.let { DiscountForm(index, it.description, it.amountCents) }) }

        fun onDiscount(change: (DiscountForm) -> DiscountForm) = ui.update { s -> s.copy(discount = s.discount?.let(change)) }

        fun closeDiscount() = ui.update { it.copy(discount = null) }

        fun saveDiscount(defaultDescription: String) {
            val form = ui.value.discount ?: return
            val amount = form.amountCents?.takeIf { it > 0 } ?: return
            val description = form.description.trim().ifEmpty { defaultDescription }
            change { d ->
                val list = d.ticketDiscounts.toMutableList()
                val index = form.index
                if (index != null && index in list.indices) list[index] = list[index].copy(description = description, amountCents = amount) else list += TicketDiscount(description = description, amountCents = amount)
                d.copy(ticketDiscounts = list)
            }
            ui.update { it.copy(discount = null) }
        }

        fun removeDiscount(index: Int) = change { d -> d.copy(ticketDiscounts = d.ticketDiscounts.filterIndexed { i, _ -> i != index }) }

        // Saving

        fun saveDraft() {
            val d = ui.value.draft
            if (d.storeId == null) {
                ui.update { it.copy(problem = R.string.editor_need_store) }
                return
            }
            write(confirm = false)
        }

        /** RF-COM-06/07: needs a store and a line; a total that does not match asks first. */
        fun confirm() {
            val s = ui.value
            val problem =
                when {
                    s.draft.storeId == null -> R.string.editor_need_store
                    s.draft.lines.isEmpty() -> R.string.editor_need_lines
                    // A scanned line without a price would enter the price history at $0 (decision T64).
                    s.draft.lines.any { it.unitPriceCents == 0L } -> R.string.editor_need_prices
                    else -> null
                }
            if (problem != null) {
                ui.update { it.copy(problem = problem) }
                return
            }
            if (s.totals.mismatch) ui.update { it.copy(mismatchCents = s.totals.differenceCents) } else write(confirm = true)
        }

        fun confirmAnyway() {
            ui.update { it.copy(mismatchCents = null) }
            write(confirm = true)
        }

        fun dismissMismatch() = ui.update { it.copy(mismatchCents = null) }

        fun askDelete() = ui.update { it.copy(confirmDelete = true) }

        fun dismissDelete() = ui.update { it.copy(confirmDelete = false) }

        fun delete() {
            val id = ui.value.draft.id ?: return
            ui.update { it.copy(confirmDelete = false, busy = true) }
            viewModelScope.launch {
                editor.delete(id)
                saved = null
                finished.send(Unit)
            }
        }

        /** "Autoguardado del borrador al salir" (05 §5): anything with a store that changed is written. */
        fun leave() {
            viewModelScope.launch {
                autosave()
                finished.send(Unit)
            }
        }

        /** Also when the app goes to the background; nothing to write without a store or without changes. */
        fun autosave() {
            viewModelScope.launch { autosaveNow() }
        }

        private suspend fun autosaveNow() =
            writing.withLock {
                val d = ui.value.draft
                if (ui.value.busy || d.storeId == null || d == saved) return@withLock
                if (d.id == null && d.lines.isEmpty() && d.ticketDiscounts.isEmpty()) return@withLock
                persist(d, confirm = false)
            }

        private fun write(confirm: Boolean) {
            if (ui.value.busy) return
            ui.update { it.copy(busy = true) }
            viewModelScope.launch {
                writing.withLock { persist(ui.value.draft, confirm) }
                finished.send(Unit)
            }
        }

        private suspend fun persist(
            draft: PurchaseDraft,
            confirm: Boolean,
        ) {
            val id = editor.save(draft, confirm)
            // Reloaded: lines and discounts now carry their ids, so the next save updates them.
            val reloaded = editor.load(id) ?: return
            saved = reloaded
            ui.update { it.copy(draft = reloaded) }
        }

        private companion object {
            const val SEARCH_DELAY_MS = 250L
        }
    }
