plugins {
    id("maunedas.android.application")
    id("maunedas.android.compose")
    id("maunedas.hilt")
    alias(libs.plugins.kotlin.serialization)
}

val workersSubdomain = providers.gradleProperty("maunedas.workersSubdomain").get()
val syntheticEmailDomain = providers.gradleProperty("maunedas.syntheticEmailDomain").get()
fun webClientId(flavor: String) = providers.gradleProperty("maunedas.googleWebClientId.$flavor").getOrElse("")
fun quoted(value: String) = "\"$value\""

// Release signing (T-004 prod, 05 §1): the keystore and its passwords live outside git, in the user's
// ~/.gradle/gradle.properties. Without them a release build comes out unsigned.
val releaseStore = providers.gradleProperty("maunedas.release.storeFile").orNull

android {
    defaultConfig {
        applicationId = "com.maubautista.maunedas"
        versionCode = 1
        versionName = "0.0.1"
        buildConfigField("String", "SYNTHETIC_EMAIL_DOMAIN", quoted(syntheticEmailDomain))
    }

    signingConfigs {
        if (releaseStore != null) {
            create("release") {
                storeFile = file(releaseStore)
                storePassword = providers.gradleProperty("maunedas.release.storePassword").get()
                keyAlias = providers.gradleProperty("maunedas.release.keyAlias").get()
                keyPassword = providers.gradleProperty("maunedas.release.keyPassword").get()
            }
        }
    }
    buildTypes {
        getByName("release") { signingConfig = signingConfigs.findByName("release") }
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "API_BASE_URL", quoted("https://maunedas-dev.$workersSubdomain.workers.dev"))
            buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", quoted(webClientId("dev")))
        }
        create("prod") {
            dimension = "env"
            buildConfigField("String", "API_BASE_URL", quoted("https://maunedas.$workersSubdomain.workers.dev"))
            buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", quoted(webClientId("prod")))
        }
    }
}

// google-services.json lives in src/dev/ and src/prod/, outside git (CI writes the dev one from the
// GOOGLE_SERVICES_JSON_DEV secret). Until T-004 provides them the plugin is not applied.
if (listOf("dev", "prod").any { file("src/$it/google-services.json").exists() }) {
    apply(plugin = "com.google.gms.google-services")
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:designsystem"))
    implementation(project(":core:ui"))
    implementation(project(":core:auth"))
    implementation(project(":core:sync"))
    implementation(project(":core:data"))
    listOf("auth", "home", "purchases", "catalog", "scan", "shelf", "photo", "settings", "tracking")
        .forEach { implementation(project(":feature:$it")) }
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.kotlinx.serialization.json)
    implementation(project(":core:network"))
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.kotlinx.coroutines.test)
}
