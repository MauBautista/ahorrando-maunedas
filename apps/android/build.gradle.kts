buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        // AGP 9 compiles Kotlin itself (built-in Kotlin); this pins the KGP version it uses.
        classpath(libs.kotlin.gradle.plugin)
    }
}

// Plugins applied by the convention plugins of build-logic must be on this classpath.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.room) apply false
    alias(libs.plugins.google.services) apply false
}
