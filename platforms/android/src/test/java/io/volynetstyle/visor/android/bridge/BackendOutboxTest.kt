package io.volynetstyle.visor.android.bridge

import org.junit.Assert.*
import org.junit.Test

class BackendOutboxTest {
    private class Harness {
        val frames = mutableSetOf<Runnable>()
        val sent = mutableListOf<Int>()
        val complete = mutableListOf<() -> Unit>()
        val box = BackendOutbox<Int>(
            postFrame = { frames.add(it) }, cancelFrame = { frames.remove(it) },
            deliver = { value, callback -> sent.add(value); complete.add(callback) },
        )
        fun frame() { val callbacks = frames.toList(); frames.clear(); callbacks.forEach { it.run() } }
    }
    @Test fun telemetryIsLatestOnlyAndRepliesAreReliableAndOrdered() {
        val h = Harness()
        h.box.setActive(true)
        repeat(10_000) { h.box.observe(it) }
        assertTrue(h.box.reply(-1))
        assertTrue(h.box.reply(-2))
        assertEquals(1, h.frames.size)
        h.frame()
        assertEquals(listOf(-1), h.sent)
        assertTrue(h.frames.isEmpty())
        h.complete[0]()
        h.frame()
        h.complete[1]()
        h.frame()
        assertEquals(listOf(-1, -2, 9999), h.sent)
    }
    @Test fun reliableQueueHasAHardBound() {
        val h = Harness()
        repeat(32) { assertTrue(h.box.reply(it)) }
        assertFalse(h.box.reply(33))
    }
    @Test fun backgroundCancelsScheduledDeliveryAndResumesWithLatestObservation() {
        val h = Harness()
        h.box.setActive(true)
        h.box.observe(1)
        h.box.setActive(false)
        repeat(1000) { h.box.observe(it) }
        assertTrue(h.frames.isEmpty())
        h.box.setActive(true)
        h.frame()
        assertEquals(listOf(999), h.sent)
    }
    @Test fun oldRendererCallbackCannotReleaseNewDelivery() {
        val h = Harness()
        h.box.setActive(true)
        h.box.reply(1)
        h.frame()
        h.box.reset()
        h.box.setActive(true)
        h.box.reply(2)
        h.frame()
        h.box.reply(3)
        h.complete[0]()
        assertTrue(h.frames.isEmpty())
        h.complete[1]()
        h.frame()
        assertEquals(listOf(1, 2, 3), h.sent)
    }
}
