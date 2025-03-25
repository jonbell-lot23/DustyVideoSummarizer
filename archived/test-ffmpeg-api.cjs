#!/usr/bin/env node

const fs = require("fs-extra");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { execSync } = require("child_process");
const OpenAI = require("openai");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Simple function to log with timestamps
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testFFmpegAndAPI(videoPath) {
  log(`Starting tests for video: ${videoPath}`);

  try {
    // Test 1: Check if the video file exists
    log("Test 1: Checking if video file exists");
    const exists = await fs.pathExists(videoPath);
    log(`Video exists: ${exists}`);

    if (!exists) {
      log("Video does not exist, stopping tests");
      return;
    }

    // Test 2: Get video metadata with FFmpeg
    log("Test 2: Getting video metadata with FFmpeg");
    try {
      log("Running ffprobe...");
      const metadata = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, meta) => {
          if (err) reject(err);
          else resolve(meta);
        });
      });

      log("FFprobe completed successfully");
      log(`Video duration: ${metadata.format.duration.toFixed(1)}s`);
      log(
        `Video size: ${(metadata.format.size / (1024 * 1024)).toFixed(2)} MB`
      );
      log(`Video format: ${metadata.format.format_name}`);
    } catch (error) {
      log(`FFprobe ERROR: ${error.message}`);
      log("Skipping remaining FFmpeg tests");
      return;
    }

    // Test 3: Extract a small sample of audio (5 seconds)
    log("Test 3: Extracting a small audio sample with FFmpeg");
    const audioPath = "test_audio_sample.mp3";

    try {
      log("Running FFmpeg to extract audio...");
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime("00:00:00")
          .setDuration(5)
          .output(audioPath)
          .on("end", () => {
            log("Audio sample extraction complete");
            resolve();
          })
          .on("error", (err) => {
            log(`Audio extraction ERROR: ${err.message}`);
            reject(err);
          })
          .run();
      });

      // Check the audio file
      if (await fs.pathExists(audioPath)) {
        const audioStats = await fs.stat(audioPath);
        log(`Audio sample size: ${(audioStats.size / 1024).toFixed(2)} KB`);
      } else {
        log("WARNING: Audio file was not created");
      }
    } catch (error) {
      log(`Audio extraction ERROR: ${error.message}`);
      log("Skipping remaining tests");
      return;
    }

    // Test 4: Test OpenAI API connection
    log("Test 4: Testing OpenAI API connection");
    try {
      log("Making a simple API request...");
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Hello, are you working?" }],
        max_tokens: 10,
      });

      log("API request successful");
      log(`Response: ${response.choices[0].message.content}`);
    } catch (error) {
      log(`OpenAI API ERROR: ${error.message}`);
      log("API test failed");
      return;
    }

    // Test 5: Transcribe a small audio sample
    if (await fs.pathExists(audioPath)) {
      log("Test 5: Testing audio transcription API");
      try {
        log("Sending audio to Whisper API...");
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: "whisper-1",
        });

        log("Transcription successful");
        log(`Transcription text: "${transcription.text}"`);
      } catch (error) {
        log(`Transcription API ERROR: ${error.message}`);
      }
    }

    // Clean up
    if (await fs.pathExists(audioPath)) {
      await fs.remove(audioPath);
      log("Cleaned up test audio file");
    }

    log("All tests completed");
  } catch (error) {
    log(`FATAL ERROR: ${error.message}`);
    log(`Error stack: ${error.stack}`);
  }
}

// Get video path from command line argument
const videoPath = process.argv[2];
if (!videoPath) {
  console.log("Usage: node test-ffmpeg-api.cjs <video_file_path>");
  process.exit(1);
}

// Run the tests
testFFmpegAndAPI(videoPath);
