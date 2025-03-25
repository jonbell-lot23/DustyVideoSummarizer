#!/usr/bin/env node

const { execSync } = require("child_process");
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

// Function to run command and display output in real time
function runCommandSync(command, args) {
  const fullCommand = `${command} ${args
    .map((arg) => {
      // Handle spaces in paths by quoting them
      return arg.includes(" ") ? `"${arg}"` : arg;
    })
    .join(" ")}`;

  console.log(`🔄 Running: ${fullCommand}`);

  try {
    execSync(fullCommand, { stdio: "inherit" });
    return true;
  } catch (error) {
    console.error(`❌ Command failed: ${error.message}`);
    return false;
  }
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

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const testMode = args.includes("--test");

// Main function
function main() {
  console.log('🔎 Finding directories labeled "tosquish"...');

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

  // Ask for confirmation
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.question(
    `⚠️ Do you want to process these directories? (y/N): `,
    (answer) => {
      readline.close();

      if (answer.toLowerCase() !== "y") {
        console.log("❌ Operation cancelled by user");
        return;
      }

      // Process each directory
      let successCount = 0;
      let failCount = 0;

      for (const dir of directories) {
        console.log(`\n🔍 Processing: ${path.basename(dir)}`);

        // Run squish-and-define.cjs with the directory
        let squishArgs = [dir];
        if (testMode) {
          squishArgs.push("--limit=1");
        }

        const success = runCommandSync(
          "node squish-and-define.cjs",
          squishArgs
        );

        if (success) {
          // Clean up iMovie directories
          console.log(`🧹 Cleaning up iMovie directories...`);
          const deletedCount = cleanupIMoveDirectories(dir);

          if (deletedCount > 0) {
            console.log(`✅ Deleted ${deletedCount} iMovie directories`);
          } else {
            console.log(`ℹ️ No iMovie directories found to delete`);
          }

          // Change label
          changeLabel(dir, "tosquish", "squished");

          console.log(`✅ Successfully processed: ${path.basename(dir)}`);
          successCount++;
        } else {
          console.error(`❌ Failed to process: ${path.basename(dir)}`);
          failCount++;
        }
      }

      console.log(
        `\n🎉 Processing complete: ${successCount} succeeded, ${failCount} failed`
      );
    }
  );
}

// Run the main function
main();
