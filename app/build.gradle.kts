plugins {
    id("com.android.application")
}

android {
    namespace = "io.volynetstyle.nightfield"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.volynetstyle.nightfield"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
}
