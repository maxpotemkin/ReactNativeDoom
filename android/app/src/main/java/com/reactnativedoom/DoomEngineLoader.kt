package com.reactnativedoom

import android.content.Context
import android.util.Log
import com.margelo.nitro.JNIOnLoad
import java.io.File
import java.io.IOException

object DoomEngineLoader {
  private const val TAG = "DoomEngineLoader"
  private const val IWAD_ASSET_PATH = "doom/DOOM1.WAD"
  private const val IWAD_FILE_NAME = "DOOM1.WAD"

  @Volatile
  private var applicationContext: Context? = null

  fun initialize(context: Context) {
    applicationContext = context.applicationContext
    JNIOnLoad.initializeNativeNitro()
    System.loadLibrary("reactnativedoom_engine")
  }

  @JvmStatic
  fun defaultIWadPath(): String {
    val context = applicationContext ?: return ""
    val outputDir = File(context.filesDir, "doom")
    val outputFile = File(outputDir, IWAD_FILE_NAME)

    if (outputFile.isFile && outputFile.length() > 0) {
      return outputFile.absolutePath
    }

    return try {
      outputDir.mkdirs()
      context.assets.open(IWAD_ASSET_PATH).use { input ->
        outputFile.outputStream().use { output ->
          input.copyTo(output)
        }
      }
      outputFile.absolutePath
    } catch (error: IOException) {
      Log.e(TAG, "Failed to copy $IWAD_ASSET_PATH into app storage.", error)
      ""
    }
  }
}
