#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Check prerequisites before running scripts
function checkPrerequisites() {
  console.log("🔍 Checking prerequisites...");

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ ERROR: OPENAI_API_KEY is not set in .env file");
    console.error(
      "💡 Create a .env file with your OpenAI API key in this format:"
    );
    console.error("OPENAI_API_KEY=your-api-key-here");
    return false;
  }
  console.log("✅ OpenAI API key found");

  // Check for FFmpeg
  try {
    const ffmpegPath = execSync("which ffmpeg").toString().trim();
    console.log(`✅ FFmpeg found at ${ffmpegPath}`);
  } catch (error) {
    console.error("❌ FFmpeg not found on your system");
    console.error("💡 Install FFmpeg using: brew install ffmpeg");
    return false;
  }

  // Check for ffprobe
  try {
    const ffprobePath = execSync("which ffprobe").toString().trim();
    console.log(`✅ FFprobe found at ${ffprobePath}`);
  } catch (error) {
    console.error("❌ FFprobe not found on your system");
    console.error("💡 It should be installed with FFmpeg: brew install ffmpeg");
    return false;
  }

  // All prerequisites met
  console.log("✅ All prerequisites met!");
  return true;
}

function runScript(scriptName, args) {
  console.log(`🚀 Running ${scriptName} with args: ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptName, ...args], {
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ ${scriptName} completed successfully`);
        resolve();
      } else {
        console.error(`❌ ${scriptName} exited with code ${code}`);
        reject(new Error(`Script exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      console.error(`❌ Error launching ${scriptName}: ${err.message}`);
      reject(err);
    });
  });
}

async function main() {
  // Get script and args from command line
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: node check-and-run.cjs <script-to-run> [args...]");
    console.log(
      "Example: node check-and-run.cjs squish-and-define.cjs /path/to/video"
    );
    process.exit(1);
  }

  const scriptToRun = args[0];
  const scriptArgs = args.slice(1);

  // Check if script file exists
  if (!fs.existsSync(scriptToRun)) {
    console.error(`❌ Script not found: ${scriptToRun}`);
    process.exit(1);
  }

  // Check prerequisites
  if (!checkPrerequisites()) {
    console.error("❌ Prerequisites check failed");
    process.exit(1);
  }

  // Run the script
  try {
    await runScript(scriptToRun, scriptArgs);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
