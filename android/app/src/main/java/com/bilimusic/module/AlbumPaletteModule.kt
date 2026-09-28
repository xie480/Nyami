package com.bilimusic.module

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.palette.graphics.Palette
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

/** Extracts a small album-cover palette off the UI thread. */
class AlbumPaletteModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()

    override fun getName(): String = "AlbumPaletteModule"

    @ReactMethod
    fun getColors(uri: String, promise: Promise) {
        val parsedUrl = try {
            normalizeArtworkUrl(URL(uri))
        } catch (error: Exception) {
            promise.reject("INVALID_ALBUM_URI", "Album artwork URL is not allowed", error)
            return
        }

        executor.execute {
            var bitmap: Bitmap? = null
            try {
                val imageBytes = downloadArtwork(parsedUrl)
                val bounds = BitmapFactory.Options().apply {inJustDecodeBounds = true}
                BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                    throw IOException("Album artwork is not a decodable image")
                }

                var sampleSize = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / sampleSize > 96) {
                    sampleSize *= 2
                }
                val decodedBitmap = BitmapFactory.decodeByteArray(
                    imageBytes,
                    0,
                    imageBytes.size,
                    BitmapFactory.Options().apply {inSampleSize = sampleSize},
                ) ?: throw IOException("Album artwork could not be decoded")
                bitmap = decodedBitmap

                val palette = Palette.from(decodedBitmap).maximumColorCount(16).generate()
                val primary = palette.vibrantSwatch?.rgb
                    ?: palette.mutedSwatch?.rgb
                    ?: palette.dominantSwatch?.rgb
                    ?: android.graphics.Color.rgb(240, 201, 120)
                val secondary = palette.lightMutedSwatch?.rgb
                    ?: palette.darkVibrantSwatch?.rgb
                    ?: palette.dominantSwatch?.rgb
                    ?: primary
                val average = averageColor(decodedBitmap, primary)
                val result = Arguments.createMap().apply {
                    putString("primary", colorHex(primary))
                    putString("secondary", colorHex(secondary))
                    putString("average", colorHex(average))
                }
                promise.resolve(result)
            } catch (error: Exception) {
                promise.reject("ALBUM_PALETTE_ERROR", "Could not read album artwork colors", error)
            } finally {
                bitmap?.recycle()
            }
        }
    }

    private fun normalizeArtworkUrl(url: URL): URL {
        val host = url.host.lowercase(Locale.ROOT)
        val isAllowedHost = ALLOWED_ARTWORK_DOMAINS.any { domain ->
            host == domain || host.endsWith(".$domain")
        }
        val isAllowedScheme = url.protocol.equals("https", ignoreCase = true) ||
            (url.protocol.equals("http", ignoreCase = true) && url.port in listOf(-1, 80))
        if (!isAllowedHost || !isAllowedScheme || url.userInfo != null) {
            throw IOException("Artwork host or URL scheme is not allowed")
        }

        // Bilibili cover hosts support HTTPS; upgrade HTTP URLs before fetching.
        return URL("https", url.host, -1, url.file)
    }

    private fun downloadArtwork(initialUrl: URL): ByteArray {
        var currentUrl = initialUrl
        var redirectCount = 0
        while (true) {
            val connection = currentUrl.openConnection() as? HttpURLConnection
                ?: throw IOException("Unsupported artwork connection")
            connection.instanceFollowRedirects = false
            try {
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 BiliMusic")
                connection.setRequestProperty("Referer", "https://www.bilibili.com/")

                val responseCode = connection.responseCode
                if (responseCode in 300..399) {
                    if (redirectCount >= MAX_REDIRECTS) {
                        throw IOException("Artwork URL exceeded the redirect limit")
                    }
                    val location = connection.getHeaderField("Location")
                        ?: throw IOException("Artwork redirect did not include a location")
                    currentUrl = normalizeArtworkUrl(URL(currentUrl, location))
                    redirectCount++
                    continue
                }
                if (responseCode !in 200..299) {
                    throw IOException("Artwork server returned HTTP $responseCode")
                }
                return connection.inputStream.use(::readBounded)
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun readBounded(input: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var totalBytes = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            totalBytes += count
            if (totalBytes > MAX_IMAGE_BYTES) {
                throw IOException("Album artwork exceeds the 6 MB extraction limit")
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun averageColor(bitmap: Bitmap, fallback: Int): Int {
        var red = 0L
        var green = 0L
        var blue = 0L
        var count = 0L
        val stepX = maxOf(1, bitmap.width / 48)
        val stepY = maxOf(1, bitmap.height / 48)
        for (y in 0 until bitmap.height step stepY) {
            for (x in 0 until bitmap.width step stepX) {
                val color = bitmap.getPixel(x, y)
                if (android.graphics.Color.alpha(color) < 128) continue
                red += android.graphics.Color.red(color)
                green += android.graphics.Color.green(color)
                blue += android.graphics.Color.blue(color)
                count++
            }
        }
        return if (count == 0L) fallback else android.graphics.Color.rgb(
            (red / count).toInt(),
            (green / count).toInt(),
            (blue / count).toInt(),
        )
    }

    private fun colorHex(color: Int): String = String.format("#%06X", 0xFFFFFF and color)

    private companion object {
        const val MAX_IMAGE_BYTES = 6 * 1024 * 1024
        const val MAX_REDIRECTS = 4
        val ALLOWED_ARTWORK_DOMAINS = listOf("hdslb.com", "biliimg.com")
    }
}
