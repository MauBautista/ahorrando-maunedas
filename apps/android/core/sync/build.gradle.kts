plugins {
    id("maunedas.android.library")
    id("maunedas.hilt")
    id("maunedas.fixtures")
}

dependencies {
    implementation(project(":core:database"))
    implementation(project(":core:network"))
    implementation(project(":core:model"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.lifecycle.process)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.work.testing)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
