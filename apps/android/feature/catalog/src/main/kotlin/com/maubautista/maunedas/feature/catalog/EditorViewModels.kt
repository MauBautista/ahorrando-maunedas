package com.maubautista.maunedas.feature.catalog

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.auth.SessionStore
import com.maubautista.maunedas.core.data.BarcodeTakenException
import com.maubautista.maunedas.core.data.CatalogEditor
import com.maubautista.maunedas.core.data.CatalogMerger
import com.maubautista.maunedas.core.data.CatalogRepository
import com.maubautista.maunedas.core.data.CategoryNode
import com.maubautista.maunedas.core.data.LocalPhotos
import com.maubautista.maunedas.core.data.MergeResult
import com.maubautista.maunedas.core.data.PhotoChange
import com.maubautista.maunedas.core.data.ProductPhotos
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.data.VariantSummary
import com.maubautista.maunedas.core.model.Measure
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.File
import javax.inject.Inject
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * What the scanner hands an editor (S-12): route arguments `code`, `name`, `brand`, `measure`, `unitAmount` (base
 * units) and `packCount`, all text and all optional.
 */
internal data class Prefill(
    val code: String?,
    val name: String?,
    val brand: String?,
    val measure: Measure?,
    val unitAmount: Double?,
    val packCount: Int?,
    /** The open catalog's photo, imported when the product is saved (10 §2.3). */
    val photo: PhotoChange.OpenCatalog? = null,
) {
    companion object {
        fun from(savedState: SavedStateHandle) =
            Prefill(
                code = savedState["code"],
                name = savedState["name"],
                brand = savedState["brand"],
                measure = savedState.get<String>("measure")?.let { runCatching { Measure.fromWire(it) }.getOrNull() },
                unitAmount = savedState.get<String>("unitAmount")?.toDoubleOrNull(),
                packCount = savedState.get<String>("packCount")?.toIntOrNull(),
                photo =
                    savedState.get<String>("imageUrl")?.let {
                        PhotoChange.OpenCatalog(it, savedState["imageLicense"], savedState["imageAttribution"], savedState["imageSourceUrl"])
                    },
            )
    }
}

/** Done editing: back to where the editor was opened from. */
enum class EditorResult { SAVED, DELETED }

data class ProductEditorState(
    val loading: Boolean = true,
    val product: ProductForm = ProductForm(),
    /** Only for a new product: its first variant is created with it. */
    val firstVariant: VariantForm? = null,
    val busy: Boolean = false,
    val confirmDelete: Boolean = false,
    /** S-18: the photo as it is saved now (something Coil loads), and the change the save brings. */
    val savedPhoto: Any? = null,
    val photoChange: PhotoChange? = null,
    @StringRes val photoError: Int? = null,
) {
    val isNew: Boolean get() = product.id == null
}

/** S-09 (05 §5). Route argument `productId`: null for a new product. */
@HiltViewModel
class ProductEditorViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val editor: CatalogEditor,
        catalog: CatalogRepository,
        session: SessionStore,
        private val photos: ProductPhotos,
        private val localPhotos: LocalPhotos,
    ) : ViewModel() {
        private val productId: String? = savedState["productId"]

        /** S-12 opens a new product with the scanned code and what an open catalog knew (all optional). */
        private val prefill = Prefill.from(savedState)
        private val ui = MutableStateFlow(ProductEditorState())
        val state: StateFlow<ProductEditorState> = ui.asStateFlow()

        val categories: StateFlow<List<CategoryNode>> = catalog.categories().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
        val tags: StateFlow<List<TagItem>> = catalog.tags().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
        val variants: StateFlow<List<VariantSummary>> =
            (productId?.let(editor::variantsOf) ?: emptyFlow()).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
        val isAdmin: StateFlow<Boolean> = session.user.map { it?.isAdmin == true }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

        private val results = Channel<EditorResult>(Channel.BUFFERED)
        val done = results.receiveAsFlow()

        init {
            viewModelScope.launch {
                val loaded = productId?.let { editor.loadProduct(it) }
                ui.value =
                    if (loaded != null) {
                        ProductEditorState(loading = false, product = ProductForm.of(loaded), savedPhoto = photos.large(loaded.primaryImageId))
                    } else {
                        // A new product starts with one variant; its measure suggests the display unit.
                        val first = VariantForm.prefilled(prefill.measure ?: Measure.VOLUME, prefill.code, prefill.unitAmount, prefill.packCount)
                        val product = ProductForm(name = prefill.name.orEmpty(), brand = prefill.brand.orEmpty()).followingMeasure(first.measure)
                        ProductEditorState(loading = false, product = product, firstVariant = first, photoChange = prefill.photo)
                    }
            }
        }

        fun onProduct(change: (ProductForm) -> ProductForm) = ui.update { it.copy(product = change(it.product)) }

        fun onFirstVariant(change: (VariantForm) -> VariantForm) =
            ui.update { s ->
                val variant = s.firstVariant?.let(change) ?: return@update s
                s.copy(firstVariant = variant, product = s.product.followingMeasure(variant.measure))
            }

        fun addTypedTag() = onProduct { it.addTypedTag(tags.value) }

        /** "Tomar foto" or "Elegir de la galería" (S-18): reduced as a product photo (10 §4.2), saved with the product. */
        fun onPhoto(taken: File) {
            viewModelScope.launch {
                val reduced = localPhotos.reduce(taken, LocalPhotos.Size.PRODUCT)
                ui.update { s ->
                    if (reduced == null) return@update s.copy(photoError = R.string.editor_photo_failed)
                    s.discardTaken()
                    s.copy(photoChange = PhotoChange.Taken(reduced.path), photoError = null)
                }
            }
        }

        /** "Quitar foto": the saved one goes when the product is saved; a new one is just dropped. */
        fun removePhoto() =
            ui.update { s ->
                s.discardTaken()
                s.copy(photoChange = if (s.savedPhoto != null) PhotoChange.Removed else null, photoError = null)
            }

        private fun ProductEditorState.discardTaken() {
            (photoChange as? PhotoChange.Taken)?.let { File(it.path).delete() }
        }

        fun addCode() {
            val form = ui.value.firstVariant ?: return
            viewModelScope.launch { onFirstVariant(codeOutcome(form, editor)) }
        }

        fun save() {
            val s = ui.value
            if (s.busy) return
            val (product, productForm) = s.product.validate()
            val (variant, variantForm) = s.firstVariant?.validate() ?: (null to null)
            ui.update { it.copy(product = productForm, firstVariant = variantForm) }
            if (product == null || (s.isNew && variant == null)) return
            ui.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    editor.saveProduct(product, variant, s.photoChange)
                    results.send(EditorResult.SAVED)
                } catch (e: BarcodeTakenException) {
                    ui.update { it.copy(firstVariant = it.firstVariant?.withCodeProblem(R.string.editor_code_taken, "${e.owner.productName} · ${e.owner.variantLabel}", e.owner.variantId)) }
                } finally {
                    ui.update { it.copy(busy = false) }
                }
            }
        }

        fun askDelete() = ui.update { it.copy(confirmDelete = true) }

        fun dismissDelete() = ui.update { it.copy(confirmDelete = false) }

        fun delete() {
            val id = productId ?: return
            ui.update { it.copy(confirmDelete = false, busy = true) }
            viewModelScope.launch {
                editor.deleteProduct(id)
                results.send(EditorResult.DELETED)
            }
        }
    }

data class VariantEditorState(
    val loading: Boolean = true,
    val variant: VariantForm = VariantForm(),
    val busy: Boolean = false,
    val confirmDelete: Boolean = false,
    /** RF-CAT-03: the admin asked to merge this variant into the one that has the typed code. */
    val confirmMerge: Boolean = false,
    @StringRes val message: Int? = null,
)

/** S-10 (05 §5). Route arguments `productId` and `variantId` (null for a new variant of that product). */
@HiltViewModel
class VariantEditorViewModel
    @Inject
    constructor(
        savedState: SavedStateHandle,
        private val editor: CatalogEditor,
        private val merger: CatalogMerger,
        session: SessionStore,
    ) : ViewModel() {
        private val productId: String = checkNotNull(savedState["productId"])
        private val variantId: String? = savedState["variantId"]
        private val prefill = Prefill.from(savedState)
        private val ui = MutableStateFlow(VariantEditorState())
        val state: StateFlow<VariantEditorState> = ui.asStateFlow()
        val isAdmin: StateFlow<Boolean> = session.user.map { it?.isAdmin == true }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

        private val results = Channel<EditorResult>(Channel.BUFFERED)
        val done = results.receiveAsFlow()

        init {
            viewModelScope.launch {
                val loaded = variantId?.let { editor.loadVariant(it) }
                // A new variant starts in the measure of the product's display unit.
                val measure = editor.loadProduct(productId)?.displayUnit?.measure ?: Measure.VOLUME
                val fresh = VariantForm.prefilled(prefill.measure ?: measure, prefill.code, prefill.unitAmount, prefill.packCount)
                ui.value = VariantEditorState(loading = false, variant = loaded?.let(VariantForm::of) ?: fresh)
            }
        }

        fun onVariant(change: (VariantForm) -> VariantForm) = ui.update { it.copy(variant = change(it.variant)) }

        fun addCode() {
            val form = ui.value.variant
            viewModelScope.launch { onVariant(codeOutcome(form, editor)) }
        }

        fun save() {
            val s = ui.value
            if (s.busy) return
            val (draft, form) = s.variant.validate()
            ui.update { it.copy(variant = form) }
            if (draft == null) return
            ui.update { it.copy(busy = true) }
            viewModelScope.launch {
                try {
                    editor.saveVariant(productId, draft)
                    results.send(EditorResult.SAVED)
                } catch (e: BarcodeTakenException) {
                    ui.update { it.copy(variant = it.variant.withCodeProblem(R.string.editor_code_taken, "${e.owner.productName} · ${e.owner.variantLabel}", e.owner.variantId)) }
                } finally {
                    ui.update { it.copy(busy = false) }
                }
            }
        }

        fun askDelete() = ui.update { it.copy(confirmDelete = true) }

        fun dismissDelete() = ui.update { it.copy(confirmDelete = false) }

        fun delete() {
            val id = variantId ?: return
            ui.update { it.copy(confirmDelete = false, busy = true) }
            viewModelScope.launch {
                editor.deleteVariant(id)
                results.send(EditorResult.DELETED)
            }
        }

        fun askMerge() = ui.update { it.copy(confirmMerge = true) }

        fun dismissMerge() = ui.update { it.copy(confirmMerge = false, message = null) }

        /** This variant goes into the one that owns the typed code; afterwards it no longer exists here. */
        fun mergeIntoCodeOwner() {
            val source = variantId ?: return
            val target = ui.value.variant.codeOwnerId ?: return
            ui.update { it.copy(confirmMerge = false, busy = true) }
            viewModelScope.launch {
                val result = merger.mergeVariants(source, target)
                ui.update { it.copy(busy = false, message = result.message()) }
                if (result == MergeResult.Done) results.send(EditorResult.DELETED)
            }
        }
    }

/**
 * What adding the typed code of [form] does: add it, or say why not (RF-CAT-03: whose it already is). Returned as a
 * change, so whatever was typed while Room answered is kept.
 */
private suspend fun codeOutcome(
    form: VariantForm,
    editor: CatalogEditor,
): (VariantForm) -> VariantForm {
    val code = form.checkCode().getOrElse { e -> return { it.withCodeProblem((e as VariantForm.CodeProblem).reason) } }
    val owner = editor.barcodeOwner(code, exceptVariant = form.id) ?: return { it.withCode(code) }
    return { it.withCodeProblem(R.string.editor_code_taken, "${owner.productName} · ${owner.variantLabel}", owner.variantId) }
}
