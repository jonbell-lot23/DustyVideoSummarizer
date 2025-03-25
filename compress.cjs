const fs = require("fs-extra");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { execSync } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

// Add verbose flag check
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Configure ffmpeg paths
function configureFfmpeg() {
  try {
    // Try to use ffmpeg-static first
    if (ffmpegStatic) {
      console.log(`🔧 Setting FFmpeg path to (from ffmpeg-static): ${ffmpegStatic}`);
      ffmpeg.setFfmpegPath(ffmpegStatic);
      
      // For ffprobe, still use system path
      const ffprobePath = execSync("which ffprobe").toString().trim();
      console.log(`🔧 Setting FFprobe path to: ${ffprobePath}`);
      ffmpeg.setFfprobePath(ffprobePath);
    } else {
      // Fallback to system paths
      const ffmpegPath = execSync("which ffmpeg").toString().trim();
      const ffprobePath = execSync("which ffprobe").toString().trim();

      console.log(`🔧 Setting FFmpeg path to (from system): ${ffmpegPath}`);
      console.log(`🔧 Setting FFprobe path to: ${ffprobePath}`);

      ffmpeg.setFfmpegPath(ffmpegPath);
      ffmpeg.setFfprobePath(ffprobePath);
    }

    return true;
  } catch (error) {
    console.error("❌ Error configuring FFmpeg paths:", error.message);
    console.error("💡 Make sure FFmpeg is installed: brew install ffmpeg");
    return false;
  }
}

// Configure FFmpeg at startup
if (!configureFfmpeg()) {
  console.error("❌ Failed to configure FFmpeg. Exiting.");
  process.exit(1);
}

const startTimes = new Map();

function startTimer(label) {
  startTimes.set(label, Date.now());
}

function endTimer(label) {
  const startTime = startTimes.get(label);
  if (!startTime) return;
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`⏱️  Duration: ${elapsed.toFixed(1)}s`);
  startTimes.delete(label);
}

// Add logging helper
function log(message, forceOutput = false) {
  if (VERBOSE || forceOutput) {
    console.log(message);
  }
}

// Helper function to delay execution
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to check if a drive is accessible
async function isDriveAccessible(filePath) {
  try {
    // For "/Volumes/..." paths, check if the volume exists
    if (filePath.startsWith('/Volumes/')) {
      const volumeName = filePath.split('/')[2]; // Get the volume name
      const volumePath = `/Volumes/${volumeName}`;
      await fs.access(volumePath, fs.constants.R_OK);
    } else {
      // For other paths, check the root directory
      const driveRoot = path.parse(filePath).root;
      await fs.access(driveRoot, fs.constants.R_OK);
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function compressVideo(inputPath, outputPath, retryCount = 0) {
  log(`\n🎬 Compressing: ${path.basename(inputPath)}`, true);
  startTimer("compression");

  // List file details
  log(`📂 Input file: ${inputPath}`);

  // Check if the drive is accessible
  if (inputPath.includes(":") || inputPath.startsWith("/Volumes/")) {
    log(`🔍 Checking if drive is accessible...`);
    const driveAccessible = await isDriveAccessible(inputPath);
    if (!driveAccessible) {
      console.error(`❌ Drive containing ${inputPath} is not accessible`);
      console.error(`💡 Please make sure the drive is connected and try again`);
      throw new Error(`Drive not accessible for ${inputPath}`);
    }
    log(`✅ Drive is accessible`);
  }

  // Verify input file exists and is readable
  try {
    await fs.access(inputPath, fs.constants.R_OK);
    log(`✅ Input file is readable`);
  } catch (error) {
    console.error(`❌ Input file not readable: ${error.message}`);

    // If we've already retried the maximum number of times, give up
    if (retryCount >= MAX_RETRIES) {
      throw new Error(
        `Failed to access input file after ${MAX_RETRIES} attempts: ${error.message}`
      );
    }

    // Otherwise retry after a delay
    console.log(
      `⏱️ Retrying in ${RETRY_DELAY / 1000} seconds... (Attempt ${
        retryCount + 1
      }/${MAX_RETRIES})`
    );
    await delay(RETRY_DELAY);
    return compressVideo(inputPath, outputPath, retryCount + 1);
  }

  // Get original video metadata
  log(`🔍 Getting video metadata...`);
  let metadata;
  try {
    metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, meta) => {
        if (err) reject(err);
        else resolve(meta);
      });
    });
  } catch (error) {
    console.error(`❌ Error getting video metadata: ${error.message}`);

    if (retryCount >= MAX_RETRIES) {
      throw new Error(
        `Failed to get video metadata after ${MAX_RETRIES} attempts: ${error.message}`
      );
    }

    console.log(
      `⏱️ Retrying in ${RETRY_DELAY / 1000} seconds... (Attempt ${
        retryCount + 1
      }/${MAX_RETRIES})`
    );
    await delay(RETRY_DELAY);
    return compressVideo(inputPath, outputPath, retryCount + 1);
  }

  const originalSize = fs.statSync(inputPath).size;
  const duration = metadata.format.duration;
  const originalBitrate = (originalSize * 8) / duration; // bits per second

  log(
    `📊 Original: ${(originalSize / (1024 * 1024)).toFixed(
      1
    )}MB, Duration: ${duration.toFixed(1)}s, Bitrate: ${Math.round(
      originalBitrate / 1000
    )} kbps`,
    true
  );

  // Create temporary directory for processing
  const tempDir = "temp_processing";
  await fs.ensureDir(tempDir);
  await fs.emptyDir(tempDir);

  try {
    // Compress video
    log(`🔄 Starting FFmpeg compression...`, true);
    await new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          "-c:v libx264", // Use H.264 codec
          "-preset medium", // Balance between speed and compression
          "-crf 23", // Constant Rate Factor (18-28 is good, lower = better quality)
          "-c:a aac", // Audio codec
          "-b:a 192k", // Audio bitrate
          "-movflags +faststart", // Enable fast start for QuickTime compatibility
          "-y", // Overwrite output file
        ])
        .save(outputPath);

      command.on("progress", (progress) => {
        if (progress.percent) {
          process.stdout.write(`\rProgress: ${progress.percent.toFixed(1)}%`);
        }
      });

      command.on("end", () => {
        process.stdout.write("\n");
        log(`✅ FFmpeg processing complete`, true);
        resolve();
      });

      command.on("error", (err) => {
        console.error(`❌ Compression error: ${err.message}`);

        // If the error message indicates a drive or I/O issue, suggest reconnecting
        if (
          err.message.includes("ECANCELED") ||
          err.message.includes("read") ||
          err.message.includes("I/O") ||
          err.message.includes("operation canceled")
        ) {
          console.error(
            "💡 This appears to be a drive connection issue. Please check your external drive."
          );
        }

        reject(err);
      });
    });

    // Get compressed file size
    const compressedSize = fs.statSync(outputPath).size;
    const compressionRatio = (1 - compressedSize / originalSize) * 100;

    log(
      `📊 Compressed: ${(compressedSize / (1024 * 1024)).toFixed(
        1
      )}MB (${compressionRatio.toFixed(1)}% smaller)`,
      true
    );

    endTimer("compression");
    log(`✅ Done: ${path.basename(outputPath)}`, true);
  } catch (error) {
    console.error(`❌ Failed: ${error.message}`);

    // If we haven't retried too many times and it looks like a drive issue, retry
    if (
      retryCount < MAX_RETRIES &&
      (error.message.includes("ECANCELED") ||
        error.message.includes("read") ||
        error.message.includes("I/O") ||
        error.message.includes("operation canceled"))
    ) {
      console.log(
        `⏱️ Retrying in ${RETRY_DELAY / 1000} seconds... (Attempt ${
          retryCount + 1
        }/${MAX_RETRIES})`
      );
      await delay(RETRY_DELAY);
      return compressVideo(inputPath, outputPath, retryCount + 1);
    }

    throw error;
  } finally {
    // Clean up temporary files
    await fs.remove(tempDir);
  }
}

async function processDirectory(
  dir,
  force = false,
  limit = null,
  clobber = false
) {
  log(`📂 Scanning: ${dir}`, true);

  // Check if directory exists
  if (!fs.existsSync(dir)) {
    console.error(`❌ Directory does not exist: ${dir}`);
    process.exit(1);
  }

  const allFiles = await fs.readdir(dir);
  log(`📊 Total files in directory: ${allFiles.length}`);

  const files = (await fs.readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(".mov"))
    .map((f) => path.join(dir, f));

  log(`📊 Found ${files.length} MOV files`, true);

  if (files.length === 0) {
    console.error("❌ No MOV files found to process");
    process.exit(1);
  }

  // Create compressed directory if not using clobber
  let compressedDir = dir;
  if (!clobber) {
    compressedDir = path.join(dir, "compressed");
    await fs.ensureDir(compressedDir);
  }

  // Sort files by size (smallest first)
  files.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);

  // Log file sizes
  if (VERBOSE) {
    log(`📁 Files to process (sorted by size):`);
    files.forEach((file, index) => {
      const size = fs.statSync(file).size;
      log(
        `   ${index + 1}. ${path.basename(file)} - ${(
          size /
          (1024 * 1024)
        ).toFixed(1)}MB`
      );
    });
  }

  // Apply limit if specified
  const filesToProcess = limit ? files.slice(0, limit) : files;
  log(`🎯 Processing ${filesToProcess.length} files`, true);

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];
    log(
      `\n📄 File ${i + 1}/${filesToProcess.length}: ${path.basename(file)}`,
      true
    );

    // Determine output path based on clobber flag
    let outputPath;
    if (clobber) {
      // Create temporary path for compression, then we'll replace the original
      const tempDir = path.join(dir, "temp_output");
      await fs.ensureDir(tempDir);

      // Use a temp file during compression
      outputPath = path.join(tempDir, `${path.basename(file, ".mov")}.mp4`);
    } else {
      // Use the compressed directory
      outputPath = path.join(
        compressedDir,
        `${path.basename(file, ".mov")}.mp4`
      );
    }

    // Skip if already compressed and not forcing (only applies to non-clobber mode)
    if (!clobber && !force && fs.existsSync(outputPath)) {
      log(`⏭️  Skipping ${path.basename(file)}, already compressed`, true);
      continue;
    }

    try {
      await compressVideo(file, outputPath);

      // If clobber mode, replace the original file
      if (clobber) {
        log(`🔄 Replacing original file: ${path.basename(file)}`, true);
        // Remove original file
        await fs.remove(file);
        // Move the compressed file to the original location but with .mp4 extension
        const finalPath = file.replace(/\.mov$/, ".mp4");
        await fs.move(outputPath, finalPath);
        // Remove the temp directory if it's empty
        try {
          await fs.rmdir(path.dirname(outputPath));
        } catch (e) {
          // Ignore error if directory isn't empty
        }
      }
    } catch (error) {
      console.error(`❌ Failed: ${path.basename(file)}`);
      // Continue with next file even if one fails
    }
  }
}

const dirPath = args[0];
const force = args.includes("--force");
const clobber = args.includes("--clobber");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : null;

if (!dirPath) {
  console.log(
    "Usage: node compress.cjs path/to/video/folder [--force] [--limit=N] [--clobber] [--verbose]"
  );
  process.exit(1);
}

processDirectory(dirPath, force, limit, clobber).catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  process.exit(1);
});
