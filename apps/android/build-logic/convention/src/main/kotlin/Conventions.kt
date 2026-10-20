import org.gradle.api.GradleException
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType

/** SDK levels of 05 §1: minSdk 26, the latest stable compile and target SDK. */
internal object Sdk {
    const val COMPILE = 37
    const val TARGET = 37
    const val MIN = 26
}

internal val JAVA_VERSION = JavaVersion.VERSION_17

internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

/** `:core:model` → `com.maubautista.maunedas.core.model`. */
internal val Project.derivedNamespace: String
    get() = "com.maubautista.maunedas" + path.replace(':', '.')

/** Dependencies allowed between modules (05 §2). */
internal object ModuleRules {
    private val DATA_DEPENDENCIES =
        setOf(":core:database", ":core:network", ":core:sync", ":core:pricing", ":core:model")

    fun allows(from: String, to: String): Boolean =
        when {
            from == ":app" -> true
            from.startsWith(":feature:") -> to.startsWith(":core:")
            from == ":core:data" -> to in DATA_DEPENDENCIES
            from.startsWith(":core:") -> to.startsWith(":core:") && to != ":core:data"
            else -> false
        }
}

/**
 * `checkModuleDependencies` fails when this module declares a project dependency 05 §2 does not allow,
 * and `unitTests` runs the module's unit tests for the variant CI builds.
 */
internal fun Project.registerVerificationTasks(unitTestTask: String) {
    val from = path
    val declared = provider {
        listOf("api", "implementation", "compileOnly", "runtimeOnly").flatMap { name ->
            configurations.findByName(name)?.dependencies?.withType(ProjectDependency::class.java)?.map { it.path }
                ?: emptyList()
        }
    }
    tasks.register("checkModuleDependencies") {
        group = "verification"
        description = "Checks the allowed module dependencies of SDD 05 §2."
        inputs.property("dependencies", declared)
        doLast {
            val forbidden = declared.get().filterNot { ModuleRules.allows(from, it) }
            if (forbidden.isNotEmpty()) {
                throw GradleException("$from no puede depender de ${forbidden.joinToString()} (SDD 05 §2)")
            }
        }
    }
    tasks.register("unitTests") {
        group = "verification"
        description = "Unit tests of the variant CI builds."
        dependsOn(unitTestTask)
    }
}
