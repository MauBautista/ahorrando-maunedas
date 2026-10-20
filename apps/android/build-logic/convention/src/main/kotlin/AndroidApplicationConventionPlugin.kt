import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            pluginManager.apply("com.android.application")
            extensions.configure<ApplicationExtension> {
                namespace = "com.maubautista.maunedas"
                compileSdk = Sdk.COMPILE
                defaultConfig {
                    minSdk = Sdk.MIN
                    targetSdk = Sdk.TARGET
                }
                compileOptions {
                    sourceCompatibility = JAVA_VERSION
                    targetCompatibility = JAVA_VERSION
                }
                buildFeatures {
                    buildConfig = true
                }
                lint {
                    abortOnError = true
                    // Library modules are checked as part of the app (05 §2).
                    checkDependencies = true
                    // Upgrades follow the catalog policy (stable and at least two weeks old), not lint.
                    disable += setOf("NewerVersionAvailable", "GradleDependency", "AndroidGradlePluginVersion")
                }
            }
            registerVerificationTasks(unitTestTask = "testDevDebugUnitTest")
        }
}
