package com.maubautista.maunedas.feature.catalog

import com.maubautista.maunedas.core.camera.CutFile
import com.maubautista.maunedas.core.camera.PhotoCutout
import com.maubautista.maunedas.core.data.Cutout
import com.maubautista.maunedas.core.data.RenditionFile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

/** What S-09 shows of "Sin fondo" for the photo just taken. */
data class CutoutUi(
    /** Google Play services has the model; until then the switch waits ("Disponible en unos minutos"). */
    val ready: Boolean,
    val on: Boolean = false,
    val working: Boolean = false,
    /** The last try found no product in the photo: it is saved whole. */
    val notFound: Boolean = false,
    val files: Cutout? = null,
)

/**
 * "Sin fondo" for a photo taken or picked in S-09 (T-118, 10 §5, decisión T101). It starts off, so the photo is saved
 * whole unless it is turned on and a product is found. Another photo cancels a cut still running, so its result never
 * lands on the new one.
 */
class CutoutSwitch(
    private val cutout: PhotoCutout,
    private val scratch: () -> File,
    private val scope: CoroutineScope,
) {
    private val current = MutableStateFlow<CutoutUi?>(null)
    val state: StateFlow<CutoutUi?> = current.asStateFlow()
    private var photo: String? = null
    private var job: Job? = null

    /** A new photo: off, and ready only when the model is here (asked for otherwise). */
    fun offer(path: String) {
        clear()
        photo = path
        scope.launch {
            val ready = cutout.isReady()
            if (!ready) cutout.prepare()
            if (photo == path) current.value = CutoutUi(ready = ready)
        }
    }

    fun toggle(on: Boolean) {
        val now = current.value ?: return
        val path = photo ?: return
        if (!now.ready || now.working || on == now.on) return
        if (!on) {
            drop(now.files)
            current.value = CutoutUi(ready = true)
            return
        }
        current.value = now.copy(on = true, working = true, notFound = false)
        job =
            scope.launch {
                val dir = scratch()
                val made = cutout.make(File(path), dir)
                current.value =
                    if (made == null) {
                        dir.deleteRecursively()
                        CutoutUi(ready = true, notFound = true)
                    } else {
                        CutoutUi(ready = true, on = true, files = Cutout(made.processed.file(), made.thumb.file(), made.mask.file()))
                    }
            }
    }

    /** The cut renditions to save with the photo: only when it is on (and done, since only then are there files). */
    fun toSave(): Cutout? = current.value?.takeIf { it.on }?.files

    /** The photo is gone (removed, replaced, or the screen left without saving): its cut files go too. */
    fun clear() {
        job?.cancel()
        drop(current.value?.files)
        photo = null
        current.value = null
    }

    private fun drop(files: Cutout?) {
        files?.let { File(it.processed.path).parentFile?.deleteRecursively() }
    }

    private fun CutFile.file() = RenditionFile(path, width, height)
}
