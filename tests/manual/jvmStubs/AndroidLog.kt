@file:Suppress("UNUSED_PARAMETER")

package android.util

/** JVM-only boundary stub; Android integration is compiled separately by Gradle. */
object Log {
    fun d(tag: String, message: String) = 0
    fun w(tag: String, message: String) = 0
    fun e(tag: String, message: String, error: Throwable) = 0
}
