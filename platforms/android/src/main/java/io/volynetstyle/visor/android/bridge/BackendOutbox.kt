package io.volynetstyle.visor.android.bridge

/** Reliable command replies plus one coalesced observation, one delivery in flight. */
internal class BackendOutbox<T : Any>(
    private val postFrame: (Runnable) -> Unit,
    private val cancelFrame: (Runnable) -> Unit,
    private val deliver: (T, () -> Unit) -> Unit,
) {
    private val replies = ArrayDeque<T>()
    private var snapshot: T? = null
    private var active = false
    private var scheduled = false
    private var inFlight = false
    private var generation = 0L
    private val dispatch = Runnable {
        scheduled = false
        if (active && !inFlight) {
            val next = if (replies.isNotEmpty()) replies.removeFirst() else snapshot.also { snapshot = null }
            if (next != null) {
                inFlight = true
                val token = ++generation
                deliver(next) {
                    if (generation == token && inFlight) {
                        inFlight = false
                        requestFrame()
                    }
                }
            }
        }
    }

    fun reply(value: T): Boolean {
        if (replies.size >= 32) return false
        replies.addLast(value)
        requestFrame()
        return true
    }

    fun observe(value: T) { snapshot = value; requestFrame() }
    fun setActive(value: Boolean) {
        active = value
        if (!active && scheduled) { cancelFrame(dispatch); scheduled = false }
        requestFrame()
    }
    fun reset() {
        setActive(false)
        generation++
        replies.clear()
        snapshot = null
        inFlight = false
    }
    private fun requestFrame() {
        if (active && !scheduled && !inFlight && (replies.isNotEmpty() || snapshot != null)) {
            scheduled = true
            postFrame(dispatch)
        }
    }
}
