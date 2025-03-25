#!/usr/bin/env node

const fs = require("fs-extra");
const path = require("path");

// First, check if convert.cjs exists
if (!fs.existsSync("convert.cjs")) {
  console.error("❌ convert.cjs not found in current directory");
  process.exit(1);
}

// Read the original file
const originalContent = fs.readFileSync("convert.cjs", "utf8");

// Add debug logging to the beginning
let modifiedContent = originalContent.replace(
  'const fs = require("fs-extra");',
  `const fs = require("fs-extra");

// Debug logging functions
function logDebug(message) {
  const timestamp = new Date().toISOString();
  console.log(\`[DEBUG \${timestamp}] \${message}\`);
}

// Start overall timer
const startTime = Date.now();
logDebug("Script started");
`
);

// Log before transcription
modifiedContent = modifiedContent.replace(
  "async function transcribeAudio(videoPath) {",
  `async function transcribeAudio(videoPath) {
  logDebug(\`Starting transcription of: \${path.basename(videoPath)}\`);
  logDebug(\`Full path: \${videoPath}\`);
  // Check if file exists and is readable
  try {
    await fs.access(videoPath, fs.constants.R_OK);
    logDebug("Video file is readable");
    
    const stats = await fs.stat(videoPath);
    logDebug(\`File size: \${(stats.size / (1024 * 1024)).toFixed(2)} MB\`);
  } catch (error) {
    logDebug(\`ERROR: Can't access video file: \${error.message}\`);
    throw error;
  }
`
);

// Log audio extraction
modifiedContent = modifiedContent.replace(
  "await new Promise((resolve, reject) => {",
  `logDebug("Beginning audio extraction with FFmpeg");
  await new Promise((resolve, reject) => {`
);

// Log after audio extraction
modifiedContent = modifiedContent.replace(
  'console.log("✅ Audio extraction complete");',
  `console.log("✅ Audio extraction complete");
        logDebug("Audio extraction finished successfully");`
);

// Log before sending to Whisper
modifiedContent = modifiedContent.replace(
  'console.log("🤖 Sending audio to Whisper...");',
  `console.log("🤖 Sending audio to Whisper...");
  logDebug("Checking extracted audio file");
  try {
    const audioStats = await fs.stat(audioPath);
    logDebug(\`Audio file size: \${(audioStats.size / (1024 * 1024)).toFixed(2)} MB\`);
  } catch (error) {
    logDebug(\`ERROR checking audio file: \${error.message}\`);
  }
  logDebug("Preparing to send audio to OpenAI API");`
);

// Log keyframe extraction
modifiedContent = modifiedContent.replace(
  "async function extractKeyframes(videoPath, numFrames) {",
  `async function extractKeyframes(videoPath, numFrames) {
  logDebug(\`Starting keyframe extraction for: \${path.basename(videoPath)}\`);`
);

// Log the API calls
modifiedContent = modifiedContent.replace(
  "const response = await openai.chat.completions.create({",
  `logDebug("Making OpenAI API request");
  const response = await openai.chat.completions.create({`
);

// Log any file writing operations
modifiedContent = modifiedContent.replace(
  "// Write the summaries and transcripts to files",
  `logDebug("Preparing to write summaries and transcripts to files");
  // Write the summaries and transcripts to files`
);

// Create a timestamped version of the script
const timestamp = Date.now();
const instrumentedFilePath = `convert-debug-${timestamp}.cjs`;

// Write the modified file
fs.writeFileSync(instrumentedFilePath, modifiedContent);
console.log(`✅ Created instrumented version: ${instrumentedFilePath}`);
console.log(`Run: node ${instrumentedFilePath} /path/to/directory [options]`);

// Make it executable
try {
  fs.chmodSync(instrumentedFilePath, 0o755);
  console.log("Made script executable");
} catch (error) {
  console.log("Note: Couldn't make executable, but still runnable with node");
}
