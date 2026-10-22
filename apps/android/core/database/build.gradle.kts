plugins {
    id("maunedas.android.library")
    id("maunedas.hilt")
    id("maunedas.fixtures")
    alias(libs.plugins.room)
    alias(libs.plugins.kotlin.serialization)
}

room {
    // Exported schemas are versioned: each version change needs a migration (CLAUDE.md rule 6).
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    implementation(project(":core:model"))
    api(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    api(libs.androidx.room.paging)
    ksp(libs.androidx.room.compiler)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.kotlinx.coroutines.test)
}
