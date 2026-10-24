plugins {
    id("maunedas.android.library")
    id("maunedas.android.compose")
}

dependencies {
    implementation(project(":core:designsystem"))
    implementation(project(":core:model"))
    // Promotion types and the search key of the shared selectors.
    implementation(project(":core:pricing"))
    // Product photos; the app sets the image loader with the session's HTTP client.
    api(libs.coil.compose)
}
