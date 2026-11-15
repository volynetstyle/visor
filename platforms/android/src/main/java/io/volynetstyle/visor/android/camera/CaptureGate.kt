package io.volynetstyle.visor.android.camera

/** Serializes camera actions while asynchronous saves and recording events complete. */
internal class CaptureGate {
    enum class State { READY, TAKING_PHOTO, STARTING_VIDEO, RECORDING, STOPPING_VIDEO }

    var state = State.READY
        private set

    val isReady: Boolean get() = state == State.READY

    fun beginPhoto(): Boolean = transition(State.READY, State.TAKING_PHOTO)
    fun beginVideo(): Boolean = transition(State.READY, State.STARTING_VIDEO)
    fun videoStarted(): Boolean = transition(State.STARTING_VIDEO, State.RECORDING)
    fun stopVideo(): Boolean = transition(State.RECORDING, State.STOPPING_VIDEO)

    fun finishPhoto() {
        if (state == State.TAKING_PHOTO) state = State.READY
    }

    fun finishVideo() {
        if (state == State.STARTING_VIDEO || state == State.RECORDING || state == State.STOPPING_VIDEO) {
            state = State.READY
        }
    }

    private fun transition(from: State, to: State): Boolean {
        if (state != from) return false
        state = to
        return true
    }
}
