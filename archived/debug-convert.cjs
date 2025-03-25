#!/usr/bin/env node

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables immediately and check for OpenAI key
dotenv.config();
console.log("🔍 Starting debug wrapper for convert.cjs");
console.log(`📂 Current directory: ${process.cwd()}`);

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ ERROR: OPENAI_API_KEY is not set in .env file");
  console.error(
    "💡 Make sure you have an .env file with a valid OpenAI API key"
  );
  process.exit(1);
}

console.log("✅ OPENAI_API_KEY is set");

// Check args
if (process.argv.length < 3) {
  console.log("Usage: node debug-convert.cjs <directory_path> [options]");
  process.exit(1);
}

const dirPath = process.argv[2];
console.log(`📂 Target directory: ${dirPath}`);

// Check if directory exists
if (!fs.existsSync(dirPath)) {
  console.error(`❌ Directory does not exist: ${dirPath}`);
  process.exit(1);
}

console.log("✅ Directory exists");

// Check for convert.cjs
if (!fs.existsSync("convert.cjs")) {
  console.error("❌ convert.cjs not found in current directory");
  process.exit(1);
}

console.log("✅ convert.cjs exists");

// Find MP4 files in the directory
const isMP4Mode = process.argv.includes("--mp4");
console.log(
  `🔍 Looking for ${isMP4Mode ? "MP4" : "MOV"} files in directory...`
);

const files = fs
  .readdirSync(dirPath)
  .filter((f) => f.toLowerCase().endsWith(isMP4Mode ? ".mp4" : ".mov"))
  .map((f) => path.join(dirPath, f));

console.log(`📊 Found ${files.length} video files`);
if (files.length === 0) {
  console.error(`❌ No ${isMP4Mode ? "MP4" : "MOV"} files found in directory`);
  process.exit(1);
}

// Print the first few files
console.log("📁 First few files:");
files.slice(0, 3).forEach((f, i) => {
  console.log(`   ${i + 1}. ${path.basename(f)}`);
});

// Now run convert.cjs with timeout monitoring
console.log("\n🚀 Running convert.cjs with the same arguments...");
const args = process.argv.slice(2);

// Set a timer to report progress even if stalled
let counter = 0;
const interval = setInterval(() => {
  counter += 10;
  console.log(`⏱️ Still running after ${counter} seconds...`);
}, 10000); // Log every 10 seconds

const child = spawn("node", ["convert.cjs", ...args], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  clearInterval(interval);
  if (code === 0) {
    console.log("✅ convert.cjs completed successfully");
  } else {
    console.error(`❌ convert.cjs exited with code ${code}`);
  }
});

child.on("error", (err) => {
  clearInterval(interval);
  console.error(`❌ Error starting convert.cjs: ${err.message}`);
});
