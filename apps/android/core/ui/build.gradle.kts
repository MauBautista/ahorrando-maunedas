plugins {
    id("maunedas.android.library")
    id("maunedas.android.compose")
}

dependencies {
    implementation(project(":core:designsystem"))
    implementation(project(":core:model"))
    // Promotion types and the search key of the shared selectors.
    implementation(project(":core:pricing"))
}
