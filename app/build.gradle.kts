plugins {
    id("com.android.application")
}

android {
    namespace = "io.volynetstyle.nightfield"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.volynetstyle.nightfield.purecamera"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    sourceSets.getByName("main").assets.directories.add("../web/www")
}

dependencies {
    val cameraX = "1.6.2"
    implementation("androidx.activity:activity:1.12.4")
    implementation("androidx.camera:camera-camera2:$cameraX")
    implementation("androidx.camera:camera-lifecycle:$cameraX")
    implementation("androidx.camera:camera-view:$cameraX")
    implementation("androidx.camera:camera-video:$cameraX")
    implementation("androidx.webkit:webkit:1.18.0")
    testImplementation("junit:junit:4.13.2")
}
