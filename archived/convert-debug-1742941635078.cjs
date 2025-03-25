const fs = require("fs-extra");

// Debug logging functions
function logDebug(message) {
  const timestamp = new Date().toISOString();
  console.log(`[DEBUG ${timestamp}] ${message}`);
}

// Start overall timer
const startTime = Date.now();
logDebug("Script started");

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

function generateShortGuid() {
  return Math.random().toString(36).substring(2, 6); // 4 character alphanumeric
}

async function generateShortName(description, importance) {
  logDebug("Making OpenAI API request");
  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [
      {
        role: "user",
        content: `Create a very short (3-5 words) filename-friendly description of this scene: "${description}"
Response should:
1. Use only lowercase letters, numbers, and hyphens
2. Be clear but concise
3. Capture the key content
4. NOT include any quotes or special formatting
5. NOT include importance rating (will be added separately)

Example good responses:
dirt-track-racing
kids-birthday-party
beach-sunset-walk
family-car-trip

Example bad responses:
"dirt-track-racing"
A dirt track racing video
[dirt-track-racing]
1_dirt-track-racing

Respond with ONLY the short name, no other text.`,
      },
    ],
    max_tokens: 50,
    temperature: 0.7,
  });

  const shortName = response.choices[0].message.content
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${importance}_${shortName}-${generateShortGuid()}`;
}

async function transcribeAudio(videoPath) {
  logDebug(`Starting transcription of: ${path.basename(videoPath)}`);
  logDebug(`Full path: ${videoPath}`);
  // Check if file exists and is readable
  try {
    await fs.access(videoPath, fs.constants.R_OK);
    logDebug("Video file is readable");
    
    const stats = await fs.stat(videoPath);
    logDebug(`File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  } catch (error) {
    logDebug(`ERROR: Can't access video file: ${error.message}`);
    throw error;
  }

  console.log("🎯 Starting audio transcription...");
  startTimer("transcription");
  const audioPath = "temp_audio.mp3";

  logDebug("Beginning audio extraction with FFmpeg");
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .format("mp3")
      .save(audioPath)
      .on("end", () => {
        console.log("✅ Audio extraction complete");
        logDebug("Audio extraction finished successfully");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Audio extraction failed:", err);
        reject(err);
      });
  });

  console.log("🤖 Sending audio to Whisper...");
  logDebug("Checking extracted audio file");
  try {
    const audioStats = await fs.stat(audioPath);
    logDebug(`Audio file size: ${(audioStats.size / (1024 * 1024)).toFixed(2)} MB`);
  } catch (error) {
    logDebug(`ERROR checking audio file: ${error.message}`);
  }
  logDebug("Preparing to send audio to OpenAI API");
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
  logDebug(`Starting keyframe extraction for: ${path.basename(videoPath)}`);
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
  console.log("💾 Setting Finder comment...");
  startTimer("metadata");
  const absolutePath = path.resolve(process.cwd(), filePath);

  try {
    // Write the AppleScript to a temporary file
    const tempScriptPath = path.join(process.cwd(), "_temp_script.scpt");
    const cleanSummary = summary
      .replace(/[\\"']/g, "'") // Replace quotes with single quotes
      .replace(/[\n\r\t]/g, " ") // Replace newlines and tabs with spaces
      .replace(/\s+/g, " ") // Collapse multiple spaces
      .trim();

    const scriptContent = `tell application "Finder"
  set theFile to (POSIX file "${absolutePath}") as alias
  set comment of theFile to "${cleanSummary}"
end tell
`;

    fs.writeFileSync(tempScriptPath, scriptContent, "utf8");

    // Execute the script file
    execSync(`osascript "${tempScriptPath}"`);
    fs.unlinkSync(tempScriptPath);

    console.log("✅ Comment set successfully");

    // Verify the comment was set
    const verifyScript = `tell application "Finder" to get comment of (POSIX file "${absolutePath}" as alias)`;
    const result = execSync(`osascript -e '${verifyScript}'`).toString().trim();
    console.log("📝 Verified comment length:", result.length, "characters");
  } catch (error) {
    console.error("❌ Failed to set comment:", error.message);
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

async function writeSummaryFile(summary, newPath, targetDir) {
  const summaryTxtPath = path.join(targetDir, "summaries_and_transcripts.txt");
  const summaryJsonPath = path.join(
    targetDir,
    "summaries_and_transcripts.json"
  );

  // Write text format
  const textContent = `File: ${newPath}
Duration: ${summary.duration_seconds.toFixed(1)} seconds
Importance: ${summary.importance.rating}/9 - ${summary.importance.reason}

Description:
${summary.description}

${
  summary.additional_descriptions.length > 0
    ? `Additional scenes:\n${summary.additional_descriptions.join("\n")}\n\n`
    : ""
}${
    summary.transcript ? `Transcript:\n${summary.transcript}\n\n` : ""
  }${"-".repeat(80)}\n\n`;

  await fs.appendFile(summaryTxtPath, textContent);

  // Write JSON format
  let jsonContent = [];
  try {
    if (await fs.pathExists(summaryJsonPath)) {
      const content = await fs.readFile(summaryJsonPath, "utf8");
      if (content.trim()) {
        jsonContent = JSON.parse(
          content.endsWith(",\n") ? `[${content.slice(0, -2)}]` : content
        );
      }
    }
  } catch (error) {
    console.warn("Warning: Could not read existing JSON file, starting fresh");
  }

  // Add full path to the summary object
  const summaryWithPath = {
    ...summary,
    path: newPath,
  };

  jsonContent.push(summaryWithPath);
  await fs.writeFile(summaryJsonPath, JSON.stringify(jsonContent, null, 2));
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

async function analyzeInitialFrame(videoPath) {
  console.log("🔍 Analyzing initial frame for content assessment...");
  const frameDir = "frames";
  await fs.ensureDir(frameDir);
  await fs.emptyDir(frameDir);

  // Get video duration
  const metadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) reject(err);
      else resolve(meta);
    });
  });
  const duration = metadata.format.duration;
  console.log(`📊 Video duration: ${duration.toFixed(1)}s`);

  // Extract a single frame from 20% into the video
  const framePath = path.join(frameDir, "initial_frame.jpg");
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [duration * 0.2],
        filename: "initial_frame.jpg",
        folder: frameDir,
      })
      .on("end", resolve)
      .on("error", reject);
  });

  // Analyze the frame
  const imageData = await fs.readFile(framePath, { encoding: "base64" });
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Analyze this image and return a JSON object with EXACTLY this format:\n" +
              "{\n" +
              '  "description": "A clear, factual description without flowery language",\n' +
              '  "needsTranscript": true/false,\n' +
              '  "additionalKeyframes": number between 0-4\n' +
              "}\n\n" +
              "CRITICAL TRANSCRIPT RULES:\n" +
              "1. ALWAYS set needsTranscript=true if:\n" +
              "   - Video is longer than 5 seconds\n" +
              "   - There are any people visible\n" +
              "   - There are any children visible\n" +
              "   - There appears to be any conversation or interaction\n" +
              "   - There is any text or signage visible\n" +
              "   - There is any audio that might contain speech\n" +
              "2. Only set needsTranscript=false if:\n" +
              "   - Video is very short (under 5 seconds)\n" +
              "   - Contains only scenery or objects\n" +
              "   - No people or text visible\n" +
              "   - No apparent conversation or interaction\n" +
              "\n" +
              "Guidelines:\n" +
              "- description: Keep it simple and factual\n" +
              "- needsTranscript: Follow the rules above strictly\n" +
              "- additionalKeyframes: Request more if scene is dynamic or multiple angles would help\n" +
              "\nRespond ONLY with the JSON object, no other text.",
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageData}` },
          },
        ],
      },
    ],
    max_tokens: 500,
  });

  try {
    // Try to parse the response
    const responseText = response.choices[0].message.content
      .trim()
      .replace(/^```json\n/, "") // Remove opening markdown
      .replace(/\n```$/, "") // Remove closing markdown
      .trim();

    console.log("Raw response:", responseText); // Debug log
    const analysis = JSON.parse(responseText);

    // Force transcript if duration > 5 seconds
    if (duration > 5) {
      analysis.needsTranscript = true;
    }

    // Validate the required fields
    if (
      !analysis.description ||
      typeof analysis.needsTranscript !== "boolean" ||
      typeof analysis.additionalKeyframes !== "number" ||
      analysis.additionalKeyframes < 0 ||
      analysis.additionalKeyframes > 4
    ) {
      throw new Error("Invalid response format from OpenAI");
    }

    console.log("📋 Initial Analysis:", analysis);
    return { ...analysis, duration };
  } catch (error) {
    console.error("Failed to parse OpenAI response:", error);
    console.error("Response was:", response.choices[0].message.content);
    throw new Error("Failed to get valid analysis from OpenAI");
  }
}

async function determineImportance(
  initialDescription,
  additionalDescriptions,
  transcript,
  duration
) {
  console.log("🤔 Determining video importance and full description...");

  const prompt = `
Analyze this video content and provide a JSON response with two parts:
1. A clear, factual description of the complete video content
2. An importance rating (1-9, where 1 = absolutely must keep, 9 = can delete)

Content to analyze:
Initial scene: ${initialDescription}
${
  additionalDescriptions.length > 0
    ? `\nAdditional scenes:\n${additionalDescriptions.join("\n")}`
    : ""
}
${transcript ? `\nTranscript: ${transcript}` : "\nNo speech detected in video."}
Duration: ${duration.toFixed(1)} seconds

Return a JSON object with EXACTLY this format:
{
  "importance": number between 1-9,
  "reason": "brief explanation of the rating",
  "fullDescription": "clear, factual description of the complete video content"
}

CRITICAL IMPORTANCE RATING GUIDELINES:
Rating 1-2 (Must Keep Forever):
- ANY content with children/kids (playing, learning, milestones, daily life)
- Family pets (any activity, behavior, or interaction)
- Family milestones or achievements (birthdays, first steps, learning new skills)
- Holiday celebrations
- Family gatherings
- School events
- Sports/activities involving family members

Rating 3-4 (Very Important):
- Extended family events
- Trips and vacations
- Home videos showing family life
- Friend gatherings
- Notable weather events

Rating 5-7 (Less Important):
- Scenic shots without family
- Random events or activities
- General location shots
- Test videos

Rating 8-9 (Least Important):
- Duplicate content
- Blurry or unclear footage
- Accidental recordings
- Random non-family content

Guidelines for the full description:
- Focus on WHO is in the video (especially family members)
- Describe what they're doing
- Include key details from all available frames
- Mention any significant audio/dialogue
- Keep it factual but don't minimize the significance of family moments

Remember: If you see kids, pets, or family activities, this is AUTOMATICALLY a high importance video (rating 1-2).

Respond ONLY with the JSON object, no other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
  });

  try {
    const responseText = response.choices[0].message.content
      .trim()
      .replace(/^```json\n/, "")
      .replace(/\n```$/, "")
      .trim();

    console.log("Raw importance response:", responseText);
    const analysis = JSON.parse(responseText);

    if (
      !analysis.importance ||
      !analysis.reason ||
      !analysis.fullDescription ||
      typeof analysis.importance !== "number" ||
      analysis.importance < 1 ||
      analysis.importance > 9
    ) {
      throw new Error("Invalid importance analysis format from OpenAI");
    }

    console.log("📊 Analysis:", analysis);
    return analysis;
  } catch (error) {
    console.error("Failed to parse OpenAI response:", error);
    console.error("Response was:", response.choices[0].message.content);
    throw new Error("Failed to get valid analysis from OpenAI");
  }
}

async function processVideo(videoPath, force = false, targetDir) {
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
    // Initial analysis to determine processing needs
    const { description, needsTranscript, additionalKeyframes, duration } =
      await analyzeInitialFrame(videoPath);

    // Get transcript if needed
    let transcript = "";
    if (needsTranscript) {
      transcript = await transcribeAudio(videoPath);
    }

    // Get additional frames if needed
    const descriptions = [description];
    if (additionalKeyframes > 0) {
      const framePaths = await extractKeyframes(
        videoPath,
        additionalKeyframes + 1
      );
      for (let i = 1; i < framePaths.length; i++) {
        const desc = await describeFrame(
          framePaths[i],
          i + 1,
          framePaths.length
        );
        descriptions.push(desc);
      }
    }

    // Determine importance using all available data
    const importance = await determineImportance(
      description,
      descriptions.slice(1),
      transcript,
      duration
    );

    // Generate filename and summary
    const newFileName =
      (await generateShortName(description, importance.importance)) +
      path.extname(videoPath);
    const newPath = path.join(path.dirname(videoPath), newFileName);

    // Create summary object
    const summary = {
      filename: newFileName,
      original_name: path.basename(videoPath),
      importance: {
        rating: importance.importance,
        reason: importance.reason,
      },
      duration_seconds: duration,
      description: importance.fullDescription,
      additional_descriptions: descriptions.slice(1),
      transcript: transcript || null,
      processed_at: new Date().toISOString(),
    };

    // Write summaries with full paths
    await writeSummaryFile(summary, path.resolve(newPath), targetDir);

    // Rename file and set metadata
    console.log(`📝 Renaming to: ${newFileName}`);
    await fs.rename(videoPath, newPath);
    setMacMetadataXattr(
      newPath,
      `${importance.fullDescription}\n\nImportance: ${importance.importance}/9 - ${importance.reason}`
    );

    await fs.remove("frames");
    endTimer("total");
    console.log(`\n✅ Successfully processed: ${newFileName}`);
  } catch (error) {
    console.error("\n❌ Error processing video:", error);
    throw error;
  }
}

async function setTimestampComment(filePath) {
  const timestamp = new Date().toLocaleString();
  console.log(`💾 Setting timestamp comment on: ${path.basename(filePath)}`);

  const absolutePath = path.resolve(process.cwd(), filePath);
  try {
    const comment = `File processed at: ${timestamp}`;
    const script = `tell application "Finder"
      set theFile to (POSIX file "${absolutePath}") as alias
      set comment of theFile to "${comment}"
    end tell`;

    execSync(`osascript -e '${script}'`);
    console.log("✅ Comment set successfully");

    // Verify the comment was set
    const verifyScript = `tell application "Finder" to get comment of (POSIX file "${absolutePath}" as alias)`;
    const result = execSync(`osascript -e '${verifyScript}'`).toString().trim();
    console.log("📝 Comment:", result);
  } catch (error) {
    console.error("❌ Failed to set comment:", error.message);
  }
}

async function processDirectory(
  dir,
  force = false,
  commentOnly = false,
  mp4 = false
) {
  console.log(`📂 Scanning directory: ${dir}`);

  // Determine which file extensions to look for based on the mp4 flag
  const fileExtension = mp4 ? ".mp4" : ".mov";
  console.log(`🔍 Looking for *${fileExtension} files`);

  const files = (await fs.readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(fileExtension))
    .map((f) => path.join(dir, f));

  console.log(`📊 Found ${files.length}${mp4 ? " MP4" : " MOV"} files`);

  if (commentOnly) {
    for (let i = 0; i < files.length; i++) {
      console.log(`\n📝 Setting comment on file ${i + 1}/${files.length}`);
      await setTimestampComment(files[i]);
    }
    return;
  }

  files.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
  for (let i = 0; i < files.length; i++) {
    console.log(`\n🎬 Processing file ${i + 1}/${files.length}`);
    await processVideo(files[i], force, dir);
  }
}

const args = process.argv.slice(2);
const dirPath = args[0];
const force = args.includes("--force");
const commentOnly = args.includes("--comment-only");
const mp4 = args.includes("--mp4");

if (!dirPath) {
  console.log(
    "Usage: node convert.cjs path/to/video/folder [--force] [--comment-only] [--mp4]"
  );
  process.exit(1);
}

processDirectory(dirPath, force, commentOnly, mp4).catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
