plugins {
    id("maunedas.android.feature")
}

android {
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core:pricing"))
    implementation(project(":core:camera"))
    // BackHandler: leaving discards the photo taken.
    implementation(libs.androidx.activity.compose)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.kotlinx.coroutines.test)
    // The view model test runs the real repositories over Room in memory.
    testImplementation(project(":core:database"))
    testImplementation(project(":core:sync"))
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
