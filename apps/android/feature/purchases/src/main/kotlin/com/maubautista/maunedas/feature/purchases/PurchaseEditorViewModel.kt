package com.maubautista.maunedas.feature.purchases

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.PurchaseDraft
import com.maubautista.maunedas.core.data.PurchaseEditor
import com.maubautista.maunedas.core.data.PurchaseLine
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.data.TicketDiscount
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
        private val clock: Clock,
    ) : ViewModel() {
        private val purchaseId: String? = savedState["purchaseId"]
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

        init {
            viewModelScope.launch {
                val draft = purchaseId?.let { editor.load(it) } ?: PurchaseDraft(purchasedAt = clock.nowMillis())
                saved = draft.takeIf { it.id != null }
                ui.value = EditorState(loading = false, draft = draft)
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
