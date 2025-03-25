const fs = require("fs-extra");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { execSync } = require("child_process");

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

const startTimes = new Map();

async function compressVideo(inputPath, outputPath) {
  console.log(`\n🎬 Compressing: ${path.basename(inputPath)}`);
  startTimer("compression");

  // Verify input file exists and is readable
  try {
    await fs.access(inputPath, fs.constants.R_OK);
  } catch (error) {
    console.error("❌ Input file not readable");
    throw error;
  }

  // Get original video metadata
  const metadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      if (err) reject(err);
      else resolve(meta);
    });
  });

  const originalSize = fs.statSync(inputPath).size;
  const duration = metadata.format.duration;
  const originalBitrate = (originalSize * 8) / duration; // bits per second

  console.log(
    `📊 Original: ${(originalSize / (1024 * 1024)).toFixed(
      1
    )}MB, Duration: ${duration.toFixed(1)}s`
  );

  // Create temporary directory for processing
  const tempDir = "temp_processing";
  await fs.ensureDir(tempDir);
  await fs.emptyDir(tempDir);

  try {
    // Compress video
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
        resolve();
      });

      command.on("error", (err) => {
        console.error("❌ Compression error");
        reject(err);
      });
    });

    // Get compressed file size
    const compressedSize = fs.statSync(outputPath).size;
    const compressionRatio = (1 - compressedSize / originalSize) * 100;

    console.log(
      `📊 Compressed: ${(compressedSize / (1024 * 1024)).toFixed(
        1
      )}MB (${compressionRatio.toFixed(1)}% smaller)`
    );

    endTimer("compression");
    console.log(`✅ Done: ${path.basename(outputPath)}`);
  } catch (error) {
    console.error("❌ Failed");
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
  console.log(`📂 Scanning: ${dir}`);
  const files = (await fs.readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(".mov"))
    .map((f) => path.join(dir, f));

  console.log(`📊 Found ${files.length} MOV files`);

  // Create compressed directory if not using clobber
  let compressedDir = dir;
  if (!clobber) {
    compressedDir = path.join(dir, "compressed");
    await fs.ensureDir(compressedDir);
  }

  // Sort files by size (smallest first)
  files.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);

  // Apply limit if specified
  const filesToProcess = limit ? files.slice(0, limit) : files;
  console.log(`🎯 Processing ${filesToProcess.length} files`);

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];

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
      console.log(`⏭️  Skipping ${path.basename(file)}, already compressed`);
      continue;
    }

    try {
      await compressVideo(file, outputPath);

      // If clobber mode, replace the original file
      if (clobber) {
        console.log(`🔄 Replacing original file: ${path.basename(file)}`);
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

const args = process.argv.slice(2);
const dirPath = args[0];
const force = args.includes("--force");
const clobber = args.includes("--clobber");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : null;

if (!dirPath) {
  console.log(
    "Usage: node compress.cjs path/to/video/folder [--force] [--limit=N] [--clobber]"
  );
  process.exit(1);
}

processDirectory(dirPath, force, limit, clobber).catch((error) => {
  console.error("\n❌ Fatal error");
  process.exit(1);
});
