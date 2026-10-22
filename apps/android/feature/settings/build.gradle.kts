plugins {
    id("maunedas.android.feature")
}

dependencies {
    implementation(project(":core:auth"))
    implementation(project(":core:sync"))
}
