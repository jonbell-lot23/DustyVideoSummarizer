const fs = require("fs-extra");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const OpenAI = require("openai");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const { execSync } = require("child_process");
const bplistCreator = require("bplist-creator");
const { createCanvas } = require("canvas");

dotenv.config();

const startTimes = new Map();
function startTimer(label) {
  startTimes.set(label, Date.now());
}

function endTimer(label) {
  const startTime = startTimes.get(label);
  if (!startTime) return;
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`⏱️  ${label}: ${elapsed.toFixed(1)}s`);
  startTimes.delete(label);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(videoPath) {
  console.log("🎯 Starting audio transcription...");
  startTimer("transcription");
  const audioPath = "temp_audio.mp3";

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

  console.log("🤖 Sending audio to Whisper...");
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-1",
  });

  await fs.remove(audioPath);
  endTimer("transcription");
  console.log(
    `📝 Transcription length: ${transcription.text.length} characters`
  );
  return transcription.text;
}

async function extractKeyframes(videoPath, numFrames) {
  console.log(`🎯 Starting keyframe extraction (${numFrames} frames)...`);
  startTimer("keyframes");
  const frameDir = "frames";
  await fs.ensureDir(frameDir);
  await fs.emptyDir(frameDir);

  console.log("📊 Getting video metadata...");
  const metadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) {
        console.error("❌ Failed to get video metadata:", err);
        reject(err);
      } else {
        console.log(`📺 Video duration: ${meta.format.duration.toFixed(1)}s`);
        resolve(meta);
      }
    });
  });

  const duration = metadata.format.duration;
  const interval = duration / numFrames;
  console.log(`⏱️  Frame interval: ${interval.toFixed(2)}s`);

  const framePromises = [];
  let completedFrames = 0;

  for (let i = 0; i < numFrames; i++) {
    const time = i * interval;
    const framePath = path.join(frameDir, `frame_${i}.jpg`);
    framePromises.push(
      new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .screenshots({
            timestamps: [time],
            filename: `frame_${i}.jpg`,
            folder: frameDir,
          })
          .on("end", () => {
            completedFrames++;
            console.log(`📸 Frame ${completedFrames}/${numFrames} extracted`);
            resolve(framePath);
          })
          .on("error", (err) => {
            console.error(`❌ Failed to extract frame ${i}:`, err);
            reject(err);
          });
      })
    );
  }

  const results = await Promise.all(framePromises);
  endTimer("keyframes");
  return results;
}

async function describeFrame(framePath, frameNumber, totalFrames) {
  console.log(`🤖 Analyzing frame ${frameNumber}/${totalFrames}...`);
  startTimer(`frame_${frameNumber}`);
  const imageData = await fs.readFile(framePath, { encoding: "base64" });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Briefly describe what is happening in this image.",
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageData}` },
          },
        ],
      },
    ],
    max_tokens: 100,
  });

  if (!response.choices || response.choices.length === 0) {
    console.error(
      "❌ Unexpected response from OpenAI:",
      JSON.stringify(response, null, 2)
    );
    throw new Error("OpenAI response did not contain expected choices");
  }

  const description = response.choices[0].message.content.trim();
  endTimer(`frame_${frameNumber}`);
  console.log(`📝 Frame ${frameNumber} description: ${description}`);
  return description;
}

async function summariseContent(transcript, descriptions) {
  console.log("🤖 Generating video summary...");
  startTimer("summary");
  const prompt = `
Here's a transcript from a video:
${transcript}

And here are descriptions of several keyframes:
${descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Please provide:

1. A concise one-line summary suitable for a filename.
2. A detailed one-paragraph summary of the video.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  const parts = response.choices[0].message.content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const shortSummary = parts[0].replace("1. ", "").trim();
  const detailedSummary = parts.slice(1).join(" ").replace("2. ", "").trim();

  endTimer("summary");
  console.log("📝 Summary generated successfully");
  return { shortSummary, detailedSummary };
}

function setMacMetadataXattr(filePath, summary) {
  console.log("💾 Saving metadata via xattr...");
  startTimer("metadata");
  const absolutePath = path.resolve(process.cwd(), filePath);
  // Create a binary plist containing the summary string.
  const plistBuffer = bplistCreator([summary]);
  // Convert the binary plist to hex.
  const hexData = plistBuffer.toString("hex");
  // Build command to convert hex back to binary and write it to the extended attribute.
  const cmd = `echo "${hexData}" | xxd -r -p | xattr -w com.apple.metadata:kMDItemFinderComment - "${absolutePath}"`;

  try {
    execSync(cmd);
    // Restart Finder to update cached metadata.
    execSync("killall Finder");
    console.log("✅ Finder comment updated via xattr.");
  } catch (error) {
    console.error("❌ Failed to update metadata via xattr:", error.message);
  }
  endTimer("metadata");
}

function drawSummaryOnCanvas(text) {
  const width = 400;
  const height = 200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.font = "20px sans-serif";
  ctx.fillText(text, 10, 50);

  return canvas.toBuffer("image/png");
}

async function writeSummaryFile(newFileName, transcript, detailedSummary) {
  const summaryContent = `File: ${newFileName}\n\nTranscript:\n${transcript}\n\nSummary:\n${detailedSummary}\n\n${"-".repeat(
    80
  )}\n\n`;
  await fs.appendFile("summaries_and_transcripts.txt", summaryContent);
}

function hasMetadata(filePath) {
  try {
    const absolutePath = path.resolve(process.cwd(), filePath);
    const result = execSync(
      `osascript -e 'tell application "Finder"
        set theFile to (POSIX file "${absolutePath}") as alias
        get comment of theFile
      end tell'`
    )
      .toString()
      .trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

async function processVideo(videoPath, force = false) {
  console.log("\n🎬 ===========================================");
  console.log(`🎬 Processing video: ${path.basename(videoPath)}`);
  console.log("===========================================\n");
  startTimer("total");

  if (!force && hasMetadata(videoPath)) {
    console.log(
      `⏭️  Skipping "${videoPath}", already summarised. Use --force to reprocess.`
    );
    return;
  }

  try {
    const transcript = await transcribeAudio(videoPath);

    const { size } = await fs.stat(videoPath);
    const numFrames = Math.min(
      Math.max(Math.floor(size / (1024 * 1024 * 5)), 5),
      20
    );
    console.log(
      `📊 Video size: ${(size / (1024 * 1024)).toFixed(
        1
      )}MB, extracting ${numFrames} frames`
    );
    const framePaths = await extractKeyframes(videoPath, numFrames);

    const descriptions = [];
    for (let i = 0; i < framePaths.length; i++) {
      descriptions.push(
        await describeFrame(framePaths[i], i + 1, framePaths.length)
      );
    }

    const { shortSummary, detailedSummary } = await summariseContent(
      transcript,
      descriptions
    );

    const cleanSummary = shortSummary
      .toLowerCase()
      .replace(/^(?:filename[-\s]*)+/i, "")
      .replace(/[\/:]/g, "-")
      .replace(/\s+/g, "_")
      .replace(/mp4|mov/gi, "")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/-+/g, "-")
      .replace(/_+/g, "_")
      .replace(/^[-_]+|[-_]+$/g, "");
    const newFileName = `${cleanSummary}${path.extname(videoPath)}`;
    const newPath = path.join(path.dirname(videoPath), newFileName);
    console.log(`📝 Renaming to: ${newFileName}`);
    await fs.rename(videoPath, newPath);

    setMacMetadataXattr(newPath, detailedSummary);
    // Optional: generate a canvas image preview of the summary.
    // const canvasBuffer = drawSummaryOnCanvas(detailedSummary);
    // await fs.writeFile("summary_preview.png", canvasBuffer);

    await writeSummaryFile(newFileName, transcript, detailedSummary);
    await fs.remove("frames");
    endTimer("total");
    console.log(`\n✅ Successfully processed: ${newFileName}`);
  } catch (error) {
    console.error("\n❌ Error processing video:", error);
    throw error;
  }
}

async function processDirectory(dir, force = false) {
  console.log(`📂 Scanning directory: ${dir}`);
  const files = (await fs.readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(".mov"))
    .map((f) => path.join(dir, f));

  console.log(`📊 Found ${files.length} MOV files`);
  files.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);

  for (let i = 0; i < files.length; i++) {
    console.log(`\n🎬 Processing file ${i + 1}/${files.length}`);
    await processVideo(files[i], force);
  }
}

const args = process.argv.slice(2);
const dirPath = args[0];
const force = args.includes("--force");

if (!dirPath) {
  console.log("Usage: node convert.js path/to/video/folder [--force]");
  process.exit(1);
}

processDirectory(dirPath, force).catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
