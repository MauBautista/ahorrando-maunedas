plugins {
    id("maunedas.android.library")
    id("maunedas.hilt")
}

dependencies {
    implementation(project(":core:database"))
    implementation(project(":core:network"))
    implementation(project(":core:sync"))
    implementation(project(":core:pricing"))
    api(project(":core:model"))
    api(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    api(libs.androidx.paging.runtime)
    // Turning photos upright (LocalPhotos, 10 §4.2).
    implementation(libs.androidx.exifinterface)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.androidx.paging.testing)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.androidx.work.testing)
}
