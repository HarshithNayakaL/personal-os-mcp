package dev.personalmcp.companion
import org.junit.Assert.assertEquals
import org.junit.Test
class PathTest {
    @Test fun nestedPath() { assertEquals(listOf("docs", "note.txt"), Capabilities.segments("docs/note.txt")) }
    @Test(expected = IllegalArgumentException::class) fun traversal() { Capabilities.segments("../secret") }
    @Test(expected = IllegalArgumentException::class) fun absolute() { Capabilities.segments("/private") }
}
