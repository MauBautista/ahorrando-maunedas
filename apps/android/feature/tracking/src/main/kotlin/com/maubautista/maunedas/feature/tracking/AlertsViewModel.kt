package com.maubautista.maunedas.feature.tracking

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.AlertEventItem
import com.maubautista.maunedas.core.data.AlertRuleItem
import com.maubautista.maunedas.core.data.AlertsRepository
import com.maubautista.maunedas.core.data.RuleDraft
import com.maubautista.maunedas.core.data.TrackingRepository
import com.maubautista.maunedas.core.data.VariantOption
import com.maubautista.maunedas.core.model.Clock
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AlertsState(
    val loading: Boolean = true,
    val rules: List<AlertRuleItem> = emptyList(),
    val events: List<AlertEventItem> = emptyList(),
    val variantName: String? = null,
    val variantId: String? = null,
)

/** S-22 and S-23: my rules (create, edit, pause, remove) and my alerts; one variant's when opened for it. */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AlertsViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val alerts: AlertsRepository,
        private val tracking: TrackingRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val variantId: String? = savedState.get<String>("variantId")

        val state: StateFlow<AlertsState> =
            combine(alerts.rules(variantId), alerts.events(), variantId?.let(tracking::variantName) ?: flowOf(null)) { rules, events, name ->
                AlertsState(loading = false, rules = rules, events = events, variantName = name, variantId = variantId)
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AlertsState(variantId = variantId))

        private val editing = MutableStateFlow<RuleFormState?>(null)

        /** The rule being written (S-22's sheet), or null. */
        val form: StateFlow<RuleFormState?> = editing.asStateFlow()

        private val removing = MutableStateFlow<AlertRuleItem?>(null)
        val confirmRemove: StateFlow<AlertRuleItem?> = removing.asStateFlow()

        private val firstRule = Channel<Unit>(Channel.CONFLATED)

        /** The first rule was saved: the screen asks for notifications then (05 §8). */
        val firstRuleSaved: Flow<Unit> = firstRule.receiveAsFlow()

        private var search: Job? = null

        init {
            // The followed links of the form's variant, for "Solo {tienda}".
            viewModelScope.launch {
                editing.map { it?.variant?.id }.distinctUntilChanged()
                    .flatMapLatest { id -> id?.let { tracking.listings(it) } ?: flowOf(emptyList()) }
                    .collect { listings -> editing.update { f -> f?.copy(stores = listings.map { it.id to it.storeName }) } }
            }
        }

        fun now(): Long = clock.nowMillis()

        fun newRule() {
            viewModelScope.launch {
                val preset = variantId?.let { id -> tracking.variantName(id).first()?.let { VariantOption(id, it, null) } }
                editing.value = RuleFormState(variant = preset)
            }
        }

        fun edit(rule: AlertRuleItem) {
            editing.value =
                RuleFormState(
                    id = rule.id, variant = VariantOption(rule.variantId, rule.name, null), variantLocked = true, type = rule.type,
                    priceCents = rule.thresholdCents, pct = rule.thresholdPct?.let(::plainPct) ?: "10", scope = rule.scope,
                    listingId = rule.listingId, cooldown = rule.cooldownHours.toString(), active = rule.active,
                )
        }

        fun closeForm() {
            editing.value = null
        }

        fun onForm(change: (RuleFormState) -> RuleFormState) = editing.update { it?.let { f -> change(f).copy(problem = null) } }

        fun onQuery(query: String) {
            onForm { it.copy(query = query, searched = false) }
            search?.cancel()
            search =
                viewModelScope.launch {
                    delay(AddListingViewModel.SEARCH_DELAY_MS)
                    val results = tracking.searchVariants(query)
                    editing.update { f -> if (f?.query == query) f.copy(results = results, searched = query.isNotBlank()) else f }
                }
        }

        fun chooseVariant(option: VariantOption) = onForm { it.copy(variant = option, listingId = null, query = "", results = emptyList(), searched = false) }

        fun save() {
            val f = editing.value ?: return
            RuleForm.problem(f)?.let { problem -> editing.value = f.copy(problem = problem) }
            if (RuleForm.problem(f) != null || f.saving) return
            editing.value = f.copy(saving = true)
            viewModelScope.launch {
                val first = f.id == null && alerts.isFirstRule()
                alerts.save(
                    RuleDraft(
                        id = f.id, variantId = f.variant!!.id, listingId = f.listingId, type = f.type, thresholdCents = f.priceCents,
                        thresholdPct = RuleForm.pct(f.pct), scope = f.scope, cooldownHours = RuleForm.cooldown(f.cooldown)!!, active = f.active,
                    ),
                )
                editing.value = null
                if (first) firstRule.trySend(Unit)
            }
        }

        fun toggle(rule: AlertRuleItem) {
            viewModelScope.launch { alerts.setActive(rule.id, !rule.active) }
        }

        fun askRemove(rule: AlertRuleItem) = removing.tryEmit(rule)

        fun dismissRemove() = removing.tryEmit(null)

        fun remove() {
            val rule = removing.value ?: return
            removing.value = null
            viewModelScope.launch { alerts.delete(rule.id) }
        }

        private companion object {
            fun plainPct(v: Double): String = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
        }
    }
