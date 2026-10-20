import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            pluginManager.apply("com.android.library")
            extensions.configure<LibraryExtension> {
                namespace = derivedNamespace
                compileSdk = Sdk.COMPILE
                defaultConfig {
                    minSdk = Sdk.MIN
                }
                compileOptions {
                    sourceCompatibility = JAVA_VERSION
                    targetCompatibility = JAVA_VERSION
                }
            }
            dependencies {
                add("testImplementation", libs.findLibrary("junit").get())
            }
            registerVerificationTasks(unitTestTask = "testDebugUnitTest")
        }
}
