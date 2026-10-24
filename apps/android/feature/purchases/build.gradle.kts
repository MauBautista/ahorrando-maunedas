plugins {
    id("maunedas.android.feature")
    id("maunedas.fixtures")
}

android {
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core:pricing"))
    implementation(project(":core:camera"))
    implementation(libs.androidx.paging.compose)
    // BackHandler: leaving the editor saves the draft first (05 §5).
    implementation(libs.androidx.activity.compose)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.paging.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    // The view model test runs the real editor over Room in memory.
    testImplementation(project(":core:database"))
    testImplementation(project(":core:sync"))
    // Continuous scanning asks the Worker for unknown codes (a mock server) and pulls with WorkManager.
    testImplementation(project(":core:network"))
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.androidx.work.testing)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
