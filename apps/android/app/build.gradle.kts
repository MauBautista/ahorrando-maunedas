plugins {
    alias(libs.plugins.android.application)
}

val workersSubdomain = providers.gradleProperty("maunedas.workersSubdomain").get()

android {
    namespace = "com.maubautista.maunedas"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.maubautista.maunedas"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.0.1"
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "API_BASE_URL", "\"https://maunedas-dev.$workersSubdomain.workers.dev\"")
        }
        create("prod") {
            dimension = "env"
            buildConfigField("String", "API_BASE_URL", "\"https://maunedas.$workersSubdomain.workers.dev\"")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
    }
}

dependencies {
    implementation(project(":core:designsystem"))
    testImplementation(libs.junit)
}
