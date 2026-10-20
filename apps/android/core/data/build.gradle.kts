plugins {
    id("maunedas.android.library")
}

dependencies {
    implementation(project(":core:database"))
    implementation(project(":core:network"))
    implementation(project(":core:sync"))
    implementation(project(":core:pricing"))
    implementation(project(":core:model"))
}
