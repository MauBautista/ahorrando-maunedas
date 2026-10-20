import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

/** Compose with Material 3 (05 §1), for the app or a library already configured. */
class AndroidComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
            pluginManager.withPlugin("com.android.application") {
                extensions.getByType(ApplicationExtension::class.java).buildFeatures.compose = true
            }
            pluginManager.withPlugin("com.android.library") {
                extensions.getByType(LibraryExtension::class.java).buildFeatures.compose = true
            }
            dependencies {
                val bom = platform(libs.findLibrary("androidx-compose-bom").get())
                add("implementation", bom)
                add("implementation", libs.findLibrary("androidx-compose-ui").get())
                add("implementation", libs.findLibrary("androidx-compose-material3").get())
                add("implementation", libs.findLibrary("androidx-compose-ui-tooling-preview").get())
                add("debugImplementation", libs.findLibrary("androidx-compose-ui-tooling").get())
            }
        }
}
