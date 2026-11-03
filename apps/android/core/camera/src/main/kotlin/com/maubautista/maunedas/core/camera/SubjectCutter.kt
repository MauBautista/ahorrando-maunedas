package com.maubautista.maunedas.core.camera

import android.content.Context
import android.graphics.Bitmap
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/** The photo's subject on a transparent background, on the phone and without network (T1, 10 §5, RF-IMG-03). */
interface SubjectCutter {
    /** Whether Google Play services already has the model; until then "Sin fondo" waits. */
    suspend fun isReady(): Boolean

    /** Asks Google Play services for the model; it arrives in a few minutes. */
    fun prepare()

    /** The subject with a transparent background, or null when there is none or the model fails. */
    suspend fun cut(bitmap: Bitmap): Bitmap?
}

/** ML Kit's subject segmentation (a Google Play services module, beta API). */
@Singleton
class MlKitSubjectCutter
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : SubjectCutter {
        private val segmenter by lazy {
            SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundBitmap().build())
        }

        override suspend fun isReady(): Boolean =
            runCatching { ModuleInstall.getClient(context).areModulesAvailable(segmenter).await().areModulesAvailable() }.getOrDefault(false)

        override fun prepare() {
            ModuleInstall.getClient(context).installModules(ModuleInstallRequest.newBuilder().addApi(segmenter).build())
        }

        override suspend fun cut(bitmap: Bitmap): Bitmap? = runCatching { segmenter.process(InputImage.fromBitmap(bitmap, 0)).await().foregroundBitmap }.getOrNull()
    }

@Module
@InstallIn(SingletonComponent::class)
internal abstract class CutterModule {
    @Binds
    abstract fun cutter(impl: MlKitSubjectCutter): SubjectCutter
}
