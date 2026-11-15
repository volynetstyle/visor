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

    sourceSets.getByName("main").assets.directories.add("../web/build")
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

// Every Android entry point (including Android Studio) verifies the UI contract.
val checkWebPerformance = tasks.register<Exec>("checkWebPerformance") {
    group = "verification"
    description = "Check web UI scheduling, bridge and resource budgets"
    workingDir(rootProject.projectDir)
    commandLine(
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", rootProject.file("scripts/web-check.ps1").absolutePath,
    )
}
tasks.named("preBuild") { dependsOn(checkWebPerformance) }
