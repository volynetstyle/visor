package io.volynetstyle.visor.android.bridge

import io.volynetstyle.visor.contract.CameraState
import io.volynetstyle.visor.contract.Protocol
import io.volynetstyle.visor.contract.VisorMethod
import io.volynetstyle.visor.contract.Capabilities
import io.volynetstyle.visor.contract.CaptureRef
import io.volynetstyle.visor.contract.CaptureResult
import io.volynetstyle.visor.contract.ErrorCode
import io.volynetstyle.visor.android.camera.BackendRequest
import io.volynetstyle.visor.android.camera.CameraParams
import io.volynetstyle.visor.android.camera.CameraSink
import org.json.JSONObject
import java.util.UUID

/** Versioned transport only. Camera operations are supplied by the physical backend. */
internal class AndroidBackendChannel(
    private val outbox: BackendOutbox<JSONObject>,
    private val onSessionReset: () -> Unit,
    private val execute: (BackendRequest) -> Unit,
) : CameraSink {
    private data class Token(val session: String, val notification: Boolean)
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
        val values = params.keys().asSequence().associateWith { params.get(it) }
        val request = BackendRequest(id, parsedMethod ?: VisorMethod.SYSTEM_CONNECT, CameraParams(values), Token(session, notification))
        if (id in answered) return
        if (message.optInt("version") != Protocol.VERSION) { error(request, ErrorCode.PROTOCOL_MISMATCH); return }
        if (method != "system.connect" && message.optString("session") != session) { error(request, ErrorCode.STALE_SESSION); return }
        if (pending.containsKey(id)) return
        if (pending.size >= Protocol.MAX_PENDING) { error(request, ErrorCode.OVERLOADED); return }
        if (parsedMethod == null) { error(request, ErrorCode.UNSUPPORTED); return }
        val keys = params.keys().asSequence().toSet()
        if (keys != Protocol.PARAM_FIELDS[method]) { error(request, ErrorCode.INVALID_ARGUMENT); return }
        if (!notification) pending[id] = request
        try { execute(request) }
        catch (_: IllegalArgumentException) { error(request, ErrorCode.INVALID_ARGUMENT) }
        catch (_: org.json.JSONException) { error(request, ErrorCode.INVALID_ARGUMENT) }
        catch (_: Exception) { error(request, ErrorCode.UNAVAILABLE) }
    }

    override fun observe(value: CameraState) {
        if (value == state) return
        state = value
        sequence++
        outbox.observe(envelope("state"))
    }
    override fun result(request: BackendRequest, value: Any?) {
        val token = request.token as Token
        if (token.session != session || token.notification) return
        if (pending[request.id] !== request) return
        pending.remove(request.id)
        remember(answered, request.id)
        outbox.reply(envelope("result").put("id", request.id).put("ok", true).put("value", encode(value)))
    }
    override fun error(request: BackendRequest, code: ErrorCode, message: String) {
        val token = request.token as Token
        if (token.session != session || token.notification) return
        if (request.id in answered) return
        pending.remove(request.id)
        remember(answered, request.id)
        outbox.reply(envelope("result").put("id", request.id).put("ok", false)
            .put("error", JSONObject().put("code", code.wire).put("message", message)
                .put("retryable", code in setOf(ErrorCode.BUSY, ErrorCode.UNAVAILABLE, ErrorCode.SAVE_FAILED))))
    }
    override fun capture(request: BackendRequest, result: CaptureResult?, error: ErrorCode?) {
        val token = request.token as Token
        if (token.session != session || request.id in terminalCaptures) return
        remember(terminalCaptures, request.id)
        outbox.reply(envelope("capture").put("event", JSONObject()
            .put("captureId", request.id).put("result", result?.let(::encode) ?: JSONObject.NULL)
            .put("error", if (error == null) JSONObject.NULL else JSONObject()
                .put("code", error.wire).put("message", error.wire).put("retryable", error == ErrorCode.SAVE_FAILED))))
    }
    private fun remember(values: MutableSet<String>, id: String) {
        values.add(id)
        if (values.size > 32) values.remove(values.first())
    }
    fun setActive(value: Boolean) = outbox.setActive(value)
    fun resetDelivery() { outbox.reset() }

    private fun encode(value: Any?): JSONObject = when (value) {
        null -> JSONObject()
        is CameraState -> value.toWire()
        is Capabilities -> value.toWire()
        is CaptureRef -> JSONObject().put("captureId", value.captureId)
        is CaptureResult -> JSONObject().put("captureId", value.captureId).put("uri", value.uri).put("mime", value.mime)
        else -> throw IllegalArgumentException("Unsupported semantic result")
    }

    private fun envelope(kind: String): JSONObject = JSONObject()
        .put("version", Protocol.VERSION).put("kind", kind).put("session", session).put("sequence", sequence)
        .also { message -> state?.let { message.put("state", it.toWire()) } }
}

internal fun CameraState.toWire(): JSONObject = JSONObject()
    .put("phase", phase.wire).put("mode", mode.wire).put("lens", lens.wire)
    .put("captureId", captureId ?: JSONObject.NULL).put("durationMs", durationMs)
    .put("zoomRatio", zoomRatio).put("flash", flash.wire).put("torch", torch)
    .put("active", active).put("access", access.wire).put("errorCode", errorCode?.wire ?: JSONObject.NULL)
    .put("capabilities", capabilities.toWire())
    .put("insets", JSONObject().put("top", insets.top).put("bottom", insets.bottom)
        .put("left", insets.left).put("right", insets.right))

private fun Capabilities.toWire(): JSONObject = JSONObject()
    .put("photo", photo.wire).put("video", video.wire)
    .put("rawStream", rawStream.wire).put("linearVideo", linearVideo.wire)
    .put("accumulation", accumulation.wire).put("motion", motion.wire)
    .put("flash", flash).put("switchLens", switchLens).put("focus", focus)
    .put("minZoom", minZoom).put("maxZoom", maxZoom)
