#!/usr/bin/env node

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Function to find directories labeled "tosquish"
function findTosquishDirectories() {
  try {
    // Use mdfind to find directories with the "tosquish" tag
    const output = execSync(`mdfind "kMDItemUserTags == 'tosquish'"`)
      .toString()
      .trim();
    return output.split("\n").filter((line) => line.trim() !== "");
  } catch (error) {
    console.error("❌ Error finding labeled directories:", error.message);
    return [];
  }
}

// Function to change Finder labels using AppleScript
function changeLabel(filePath, oldTag, newTag) {
  console.log(`🏷️  Changing label from "${oldTag}" to "${newTag}"`);

  // Escape the path for AppleScript
  const escapedPath = filePath.replace(/"/g, '\\"');

  // Create AppleScript to remove the old tag and add the new one
  const appleScript = `
    tell application "Finder"
      set theItem to POSIX file "${escapedPath}" as alias
      set currentTags to tags of theItem
      set newTags to {}
      
      -- Remove old tag and keep other tags
      repeat with aTag in currentTags
        if aTag as string is not "${oldTag}" then
          set end of newTags to aTag
        end if
      end repeat
      
      -- Add new tag
      set end of newTags to "${newTag}"
      
      -- Set the updated tags
      set tags of theItem to newTags
    end tell
  `;

  try {
    execSync(`osascript -e '${appleScript}'`);
    console.log(`✅ Successfully changed label to "${newTag}"`);
    return true;
  } catch (error) {
    console.error(`❌ Error changing tags: ${error.message}`);
    return false;
  }
}

// Function to call squish-and-define.cjs with proper output handling
function runSquishAndDefine(dirPath, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ["squish-and-define.cjs", dirPath];

    if (options.limit) args.push(`--limit=${options.limit}`);
    if (options.force) args.push("--force");
    if (options.verbose) args.push("--verbose");
    if (options.noclobber) args.push("--no-clobber");

    console.log(`🎬 Running: node ${args.join(" ")}`);

    const child = spawn("node", args, { stdio: ["inherit", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    // Stream output in real-time
    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("✅ squish-and-define.cjs completed successfully");
        resolve();
      } else {
        console.error(
          `❌ squish-and-define.cjs failed with exit code: ${code}`
        );
        reject(new Error(`Process exited with code ${code}. Error: ${stderr}`));
      }
    });

    child.on("error", (error) => {
      console.error(
        `❌ Error spawning squish-and-define.cjs: ${error.message}`
      );
      reject(error);
    });
  });
}

// Function to clean up iMovie directories
function cleanupIMoveDirectories(dirPath) {
  const dirsToDelete = ["iMovie Thumbnails", "iMovie Cache"];
  let deletedCount = 0;

  for (const dir of dirsToDelete) {
    const fullPath = path.join(dirPath, dir);
    if (fs.existsSync(fullPath)) {
      console.log(`🗑️  Deleting: ${fullPath}`);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`✅ Successfully deleted: ${fullPath}`);
        deletedCount++;
      } catch (error) {
        console.error(`❌ Error deleting ${fullPath}: ${error.message}`);
      }
    }
  }

  return deletedCount;
}

// Process a single directory
async function processDirectory(dirPath, options = {}) {
  console.log(`\n🔍 Processing: ${dirPath}`);

  try {
    // Run squish-and-define.cjs
    console.log(`🎬 Starting video processing...`);
    await runSquishAndDefine(dirPath, options);

    // Clean up iMovie directories
    console.log(`🧹 Cleaning up iMovie directories...`);
    const deletedCount = cleanupIMoveDirectories(dirPath);

    if (deletedCount > 0) {
      console.log(`✅ Deleted ${deletedCount} iMovie directories`);
    } else {
      console.log(`ℹ️ No iMovie directories found to delete`);
    }

    // Change the label
    console.log(`🏷️ Updating Finder label...`);
    changeLabel(dirPath, "tosquish", "squished");

    console.log(`✅ Successfully processed: ${path.basename(dirPath)}`);
    return true;
  } catch (error) {
    console.error(`❌ Error processing ${dirPath}:`, error.message);
    return false;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const testMode = args.includes("--test");
const force = args.includes("--force");
const verbose = args.includes("--verbose");
const noclobber = args.includes("--no-clobber");

// Main function
async function main() {
  console.log('🔎 Finding directories labeled "tosquish"...');

  // Check if squish-and-define.cjs exists
  if (!fs.existsSync("squish-and-define.cjs")) {
    console.error(
      "❌ Error: squish-and-define.cjs not found in current directory"
    );
    process.exit(1);
  }

  const directories = findTosquishDirectories();

  if (directories.length === 0) {
    console.log('❓ No directories with "tosquish" label found.');
    return;
  }

  console.log(`📂 Found ${directories.length} directories to process:`);
  directories.forEach((dir, index) => {
    console.log(`   ${index + 1}. ${dir}`);
  });

  if (dryRun) {
    console.log("🔍 Dry run mode - no processing performed");
    return;
  }

  // Set options
  const options = {
    limit: testMode ? 1 : null,
    force,
    verbose,
    noclobber,
  };

  if (testMode) {
    console.log("🧪 TEST MODE: Processing only one file per directory");
  }

  // Ask for confirmation
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    readline.question(
      `⚠️ Do you want to process these directories? (y/N): `,
      (answer) => {
        resolve(answer.toLowerCase());
      }
    );
  });

  readline.close();

  if (answer !== "y") {
    console.log("❌ Operation cancelled by user");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const dir of directories) {
    const success = await processDirectory(dir, options);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log(
    `\n🎉 Processing complete: ${successCount} succeeded, ${failCount} failed`
  );
}

// Run the main function
main().catch((error) => {
  console.error("❌ Fatal error:", error.message);
  process.exit(1);
});
