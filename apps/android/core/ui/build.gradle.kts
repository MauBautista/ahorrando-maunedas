plugins {
    id("maunedas.android.library")
    id("maunedas.android.compose")
}

dependencies {
    implementation(project(":core:designsystem"))
    implementation(project(":core:model"))
}
