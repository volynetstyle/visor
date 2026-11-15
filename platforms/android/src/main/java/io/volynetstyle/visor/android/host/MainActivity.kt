package io.volynetstyle.visor.android.host

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.camera.view.PreviewView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import io.volynetstyle.visor.android.R
import io.volynetstyle.visor.android.camera.AndroidCameraBackend
import io.volynetstyle.visor.android.bridge.AndroidBridge
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private val camera = AndroidCameraBackend(this)
    private lateinit var webHost: WebHost
    private lateinit var bridge: AndroidBridge
    private var resumed = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        webHost = WebHost(this,
            onMessage = { bridge.receive(it) },
            onReady = { bridge.setActive(resumed); camera.publishState() },
            onRendererGone = { bridge.setActive(false); bridge.resetDelivery() })
        bridge = AndroidBridge(webHost::postFrame, webHost::cancelFrame, webHost::deliver, camera)
        camera.attach(findViewById<PreviewView>(R.id.preview), bridge.channel)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { _, windowInsets ->
            val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val density = resources.displayMetrics.density
            camera.setInsets((bars.top/density).roundToInt(), (bars.bottom/density).roundToInt(),
                (bars.left/density).roundToInt(), (bars.right/density).roundToInt())
            windowInsets
        }
        camera.onCreate(savedInstanceState)
        webHost.start()
    }
    override fun onResume() { super.onResume(); resumed = true; webHost.resume(); bridge.setActive(webHost.ready); camera.onResume() }
    override fun onPause() { resumed = false; bridge.setActive(false); camera.onPause(); webHost.pause(); super.onPause() }
    override fun onSaveInstanceState(outState: Bundle) { camera.onSaveInstanceState(outState); super.onSaveInstanceState(outState) }
    override fun onConfigurationChanged(newConfig: Configuration) { super.onConfigurationChanged(newConfig); camera.onConfigurationChanged() }
    override fun onDestroy() { bridge.resetDelivery(); camera.onDestroy(); webHost.destroy(); super.onDestroy() }
}
