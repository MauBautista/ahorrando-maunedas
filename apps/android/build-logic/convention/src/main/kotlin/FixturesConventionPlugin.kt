import com.android.build.api.variant.HostTestBuilder
import com.android.build.api.variant.LibraryAndroidComponentsExtension
import org.gradle.api.DefaultTask
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.register
import javax.inject.Inject

/**
 * Copies the JSON files of the repository's `fixtures` folder (CLAUDE.md rule 7) to `fixtures/` in test resources,
 * and the schema contracts (docs/esquema-d1.sql, packages/shared/sync-schema.json) to `contracts/`.
 */
abstract class CopyFixturesTask : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val fixtures: DirectoryProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NAME_ONLY)
    abstract val contracts: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun copy() {
        fs.sync {
            into(outputDir)
            from(fixtures) {
                include("*.json")
                into("fixtures")
            }
            from(contracts) { into("contracts") }
        }
    }
}

/** Unit tests read the same fixtures as TypeScript and Python (T-101), parsed with kotlinx.serialization. */
class FixturesConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            val copy =
                tasks.register<CopyFixturesTask>("copyFixtures") {
                    // apps/android → repository root.
                    val repo = rootProject.layout.projectDirectory.dir("../..")
                    fixtures.set(repo.dir("fixtures"))
                    contracts.from(repo.file("docs/esquema-d1.sql"), repo.file("packages/shared/sync-schema.json"))
                }
            extensions.configure<LibraryAndroidComponentsExtension> {
                onVariants { variant ->
                    variant.hostTests[HostTestBuilder.UNIT_TEST_TYPE]
                        ?.sources
                        ?.resources
                        ?.addGeneratedSourceDirectory(copy, CopyFixturesTask::outputDir)
                }
            }
            dependencies {
                add("testImplementation", libs.findLibrary("kotlinx-serialization-json").get())
            }
        }
}
