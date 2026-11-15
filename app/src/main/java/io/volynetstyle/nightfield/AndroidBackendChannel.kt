package io.volynetstyle.nightfield

import io.volynetstyle.visor.contract.CameraState
import io.volynetstyle.visor.contract.Protocol
import io.volynetstyle.visor.contract.VisorMethod
import org.json.JSONObject
import java.util.UUID

internal data class BackendRequest(
    val id: String, val method: VisorMethod, val params: JSONObject, val session: String, val notification: Boolean,
)

/** Versioned transport only. Camera operations are supplied by the physical backend. */
internal class AndroidBackendChannel(
    private val outbox: BackendOutbox<JSONObject>,
    private val onSessionReset: () -> Unit,
    private val execute: (BackendRequest) -> Unit,
) {
    private var session = UUID.randomUUID().toString()
    private var sequence = 0L
    private var state: CameraState? = null
    private val pending = mutableMapOf<String, BackendRequest>()
    private val answered = linkedSetOf<String>()
    private val terminalCaptures = linkedSetOf<String>()

    fun receive(raw: String) {
        if (raw.length > Protocol.MAX_MESSAGE_BYTES || raw.toByteArray(Charsets.UTF_8).size > Protocol.MAX_MESSAGE_BYTES) return
        val message = try { JSONObject(raw) } catch (_: Exception) { return }
        val id = message.optString("id")
        if (!id.matches(Regex("r[0-9]{1,15}"))) return
        val method = message.optString("method")
        val notification = message.optBoolean("notification", false)
        val params = message.optJSONObject("params") ?: JSONObject()
        if (method == "system.connect" && message.optInt("version") == Protocol.VERSION) {
            onSessionReset()
            pending.clear()
            answered.clear()
            terminalCaptures.clear()
            outbox.reset()
            session = UUID.randomUUID().toString()
            sequence = 0
            state = null
        }
        val parsedMethod = VisorMethod.entries.firstOrNull { it.wire == method }
        val request = BackendRequest(id, parsedMethod ?: VisorMethod.SYSTEM_CONNECT, params, session, notification)
        if (id in answered) return
        if (message.optInt("version") != Protocol.VERSION) { error(request, "PROTOCOL_MISMATCH"); return }
        if (method != "system.connect" && message.optString("session") != session) { error(request, "STALE_SESSION"); return }
        if (pending.containsKey(id)) return
        if (pending.size >= Protocol.MAX_PENDING) { error(request, "OVERLOADED"); return }
        if (parsedMethod == null) { error(request, "UNSUPPORTED"); return }
        val keys = params.keys().asSequence().toSet()
        if (keys != Protocol.PARAM_FIELDS[method]) { error(request, "INVALID_ARGUMENT"); return }
        if (!notification) pending[id] = request
        try { execute(request) }
        catch (_: IllegalArgumentException) { error(request, "INVALID_ARGUMENT") }
        catch (_: org.json.JSONException) { error(request, "INVALID_ARGUMENT") }
        catch (_: Exception) { error(request, "UNAVAILABLE") }
    }

    fun observe(value: CameraState) {
        if (value == state) return
        state = value
        sequence++
        outbox.observe(envelope("state"))
    }
    fun result(request: BackendRequest, value: JSONObject = JSONObject()) {
        if (request.session != session || request.notification) return
        if (pending[request.id] !== request) return
        pending.remove(request.id)
        remember(answered, request.id)
        outbox.reply(envelope("result").put("id", request.id).put("ok", true).put("value", value))
    }
    fun error(request: BackendRequest, code: String, message: String = code) {
        if (request.session != session || request.notification) return
        if (request.id in answered) return
        pending.remove(request.id)
        remember(answered, request.id)
        outbox.reply(envelope("result").put("id", request.id).put("ok", false)
            .put("error", JSONObject().put("code", code).put("message", message)
                .put("retryable", code in setOf("BUSY", "UNAVAILABLE", "SAVE_FAILED"))))
    }
    fun capture(request: BackendRequest, result: JSONObject?, error: String?) {
        if (request.session != session || request.id in terminalCaptures) return
        remember(terminalCaptures, request.id)
        outbox.reply(envelope("capture").put("event", JSONObject()
            .put("captureId", request.id).put("result", result ?: JSONObject.NULL)
            .put("error", if (error == null) JSONObject.NULL else JSONObject()
                .put("code", error).put("message", error).put("retryable", error == "SAVE_FAILED"))))
    }
    private fun remember(values: MutableSet<String>, id: String) {
        values.add(id)
        if (values.size > 32) values.remove(values.first())
    }
    fun setActive(value: Boolean) = outbox.setActive(value)
    fun resetDelivery() { outbox.reset() }

    private fun envelope(kind: String): JSONObject = JSONObject()
        .put("version", Protocol.VERSION).put("kind", kind).put("session", session).put("sequence", sequence)
        .also { message -> state?.let { message.put("state", it.toWire()) } }
}

internal fun CameraState.toWire(): JSONObject = JSONObject()
    .put("phase", phase.wire).put("mode", mode.wire).put("lens", lens.wire)
    .put("captureId", captureId ?: JSONObject.NULL).put("durationMs", durationMs)
    .put("zoomRatio", zoomRatio).put("flash", flash.wire).put("torch", torch)
    .put("active", active).put("access", access.wire).put("errorCode", errorCode?.wire ?: JSONObject.NULL)
    .put("capabilities", JSONObject()
        .put("photo", capabilities.photo.wire).put("video", capabilities.video.wire)
        .put("rawStream", capabilities.rawStream.wire).put("linearVideo", capabilities.linearVideo.wire)
        .put("accumulation", capabilities.accumulation.wire).put("motion", capabilities.motion.wire)
        .put("flash", capabilities.flash).put("switchLens", capabilities.switchLens).put("focus", capabilities.focus)
        .put("minZoom", capabilities.minZoom).put("maxZoom", capabilities.maxZoom))
    .put("insets", JSONObject().put("top", insets.top).put("bottom", insets.bottom)
        .put("left", insets.left).put("right", insets.right))
