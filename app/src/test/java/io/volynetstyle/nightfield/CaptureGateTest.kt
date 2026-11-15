package io.volynetstyle.nightfield

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureGateTest {
    @Test fun photoPreventsOverlappingCapturesUntilSaveCompletes() {
        val gate = CaptureGate()
        assertTrue(gate.beginPhoto())
        assertFalse(gate.beginPhoto())
        assertFalse(gate.beginVideo())
        gate.finishVideo()
        assertEquals(CaptureGate.State.TAKING_PHOTO, gate.state)
        gate.finishPhoto()
        assertTrue(gate.beginVideo())
    }

    @Test fun recordingWaitsForStartAndFinalizeEvents() {
        val gate = CaptureGate()
        assertTrue(gate.beginVideo())
        assertFalse(gate.stopVideo())
        assertFalse(gate.beginPhoto())
        assertTrue(gate.videoStarted())
        assertTrue(gate.stopVideo())
        assertFalse(gate.stopVideo())
        assertFalse(gate.beginPhoto())
        gate.finishVideo()
        assertTrue(gate.beginPhoto())
    }

    @Test fun failedVideoStartDoesNotLockTheCamera() {
        val gate = CaptureGate()
        assertTrue(gate.beginVideo())
        gate.finishVideo()
        assertFalse(gate.videoStarted())
        assertTrue(gate.isReady)
        assertTrue(gate.beginVideo())
    }
}
