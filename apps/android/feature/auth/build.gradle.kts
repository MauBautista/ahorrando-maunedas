plugins {
    id("maunedas.android.feature")
}

android {
    testOptions.unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation(project(":core:auth"))
    implementation(project(":core:sync"))
    testImplementation(libs.kotlinx.coroutines.test)
}
