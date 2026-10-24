plugins {
    id("maunedas.android.library")
    id("maunedas.android.compose")
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:designsystem"))
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    // The bundled model: scanning works without Play Services nor network (RF-SYN-01).
    implementation(libs.mlkit.barcode.scanning)
    // "Foto de ticket": Google Play services' scanner, with crop and straightening (05 §1).
    implementation(libs.mlkit.document.scanner)
    implementation(libs.androidx.lifecycle.runtime.compose)
    // The camera permission request and the photo picker.
    implementation(libs.androidx.activity.compose)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
