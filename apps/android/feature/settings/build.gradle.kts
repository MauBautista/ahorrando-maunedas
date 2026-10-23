plugins {
    id("maunedas.android.feature")
}

android {
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core:auth"))
    implementation(project(":core:sync"))
    implementation(project(":core:network"))
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
