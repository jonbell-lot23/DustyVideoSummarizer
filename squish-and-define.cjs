const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Runs a command and captures the output
 */
async function runCommand(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    console.log(`🔄 Running: ${command} ${args.join(" ")}`);

    const proc = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

/**
 * Main function to compress and process videos
 */
async function squishAndDefine(dirPath, options = {}) {
  const { force, limit } = options;

  try {
    console.log("🎬 Step 1: Compressing videos and replacing originals");

    // First compress the videos with --clobber to replace originals
    const compressArgs = ["compress.cjs", dirPath, "--clobber"];

    if (force) compressArgs.push("--force");
    if (limit) compressArgs.push(`--limit=${limit}`);

    // Run the compression script
    await runCommand("node", compressArgs);

    console.log("\n🔍 Step 2: Analyzing and processing compressed videos");

    // Now run the analysis/transcription script on the compressed files
    const convertArgs = ["convert.cjs", dirPath, "--mp4"];

    if (force) convertArgs.push("--force");
    if (limit) convertArgs.push(`--limit=${limit}`);

    // Run the conversion/analysis script
    await runCommand("node", convertArgs);

    console.log("\n✅ All processing complete!");
  } catch (error) {
    console.error("❌ Process failed:", error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dirPath = args[0];
const options = {
  force: args.includes("--force"),
  limit: null,
};

const limitArg = args.find((arg) => arg.startsWith("--limit="));
if (limitArg) {
  options.limit = parseInt(limitArg.split("=")[1]);
}

if (!dirPath) {
  console.log(
    "Usage: node squish-and-define.cjs path/to/video/folder [--force] [--limit=N]"
  );
  process.exit(1);
}

// Run the script
squishAndDefine(dirPath, options);
