plugins {
    `kotlin-dsl`
}

dependencies {
    compileOnly(libs.android.gradlePlugin)
}

gradlePlugin {
    plugins {
        register("androidApplication") {
            id = "maunedas.android.application"
            implementationClass = "AndroidApplicationConventionPlugin"
        }
        register("androidLibrary") {
            id = "maunedas.android.library"
            implementationClass = "AndroidLibraryConventionPlugin"
        }
        register("androidCompose") {
            id = "maunedas.android.compose"
            implementationClass = "AndroidComposeConventionPlugin"
        }
        register("androidFeature") {
            id = "maunedas.android.feature"
            implementationClass = "AndroidFeatureConventionPlugin"
        }
        register("fixtures") {
            id = "maunedas.fixtures"
            implementationClass = "FixturesConventionPlugin"
        }
        register("hilt") {
            id = "maunedas.hilt"
            implementationClass = "HiltConventionPlugin"
        }
    }
}
