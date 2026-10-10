package com.brevia.brevia_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class UpdateDownloadTest {
    @get:Rule val temporary = TemporaryFolder()
    private val digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

    @Test fun acceptsOnlyCompleteUntamperedDownload() {
        val directory = temporary.newFolder("updates")
        val file = File(directory, "release.apk").apply { writeText("abc") }
        assertEquals(file.canonicalFile, verifyUpdateFile(file, directory, 3, digest))
        assertThrows(IllegalArgumentException::class.java) { verifyUpdateFile(file, directory, 4, digest) }
        file.writeText("abd")
        assertThrows(IllegalArgumentException::class.java) { verifyUpdateFile(file, directory, 3, digest) }
    }

    @Test fun rejectsFilesOutsideUpdateDirectoryAndMissingDownloads() {
        val directory = temporary.newFolder("updates")
        val outside = temporary.newFile("outside.apk").apply { writeText("abc") }
        assertThrows(IllegalArgumentException::class.java) { verifyUpdateFile(outside, directory, 3, digest) }
        assertThrows(IllegalArgumentException::class.java) { verifyUpdateFile(File(directory, "missing.apk"), directory, 0, digest) }
    }
}
