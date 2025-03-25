import OpenAI from "openai";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testTranscription(videoPath) {
  console.log("🎯 Starting audio transcription test...");
  console.log("📺 Video path:", videoPath);

  // Extract audio
  const audioPath = "test_audio.mp3";
  console.log("🎵 Extracting audio...");

  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .format("mp3")
      .save(audioPath)
      .on("end", () => {
        console.log("✅ Audio extraction complete");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Audio extraction failed:", err);
        reject(err);
      });
  });

  // Transcribe
  console.log("🤖 Sending to Whisper...");
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-1",
  });

  // Cleanup
  await fs.remove(audioPath);

  console.log("\n📝 Transcription result:");
  console.log(transcription.text);
}

// Get the first MOV file from the directory
const dirPath =
  "/Volumes/May2022-PurpleDuck/BACKUPS/iMessage_archive_backup/backup/chat73259720714860168/Attachments";
const files = fs
  .readdirSync(dirPath)
  .filter((f) => f.toLowerCase().endsWith(".mov"))
  .map((f) => `${dirPath}/${f}`)
  .sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);

if (files.length === 0) {
  console.error("❌ No MOV files found in directory");
  process.exit(1);
}

console.log(
  "🎬 Found MOV files:",
  files
    .map(
      (f) =>
        `${path.basename(f)} (${(fs.statSync(f).size / (1024 * 1024)).toFixed(
          1
        )}MB)`
    )
    .join("\n")
);
console.log("\n🎯 Testing with smallest file:", path.basename(files[0]));

testTranscription(files[0]).catch(console.error);
