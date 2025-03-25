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
  console.log(
    `🏷️  Changing label from "${oldTag}" to "${newTag}" for: ${path.basename(
      filePath
    )}`
  );

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

// Function to delete directories
function deleteDirectories(basePath, dirNames) {
  let deletedCount = 0;

  dirNames.forEach((dir) => {
    const fullPath = path.join(basePath, dir);
    if (fs.existsSync(fullPath)) {
      console.log(`🗑️  Deleting: ${fullPath}`);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`✅ Successfully deleted: ${fullPath}`);
        deletedCount++;
      } catch (error) {
        console.error(`❌ Error deleting ${fullPath}: ${error.message}`);
      }
    } else {
      console.log(`ℹ️ Directory not found, skipping: ${dir}`);
    }
  });

  return deletedCount;
}

// Function to process a single directory
function processDirectory(dirPath) {
  console.log(`\n🔍 Processing: ${dirPath}`);

  try {
    // Check if directory exists and is accessible
    if (!fs.existsSync(dirPath)) {
      console.error(`❌ Directory does not exist: ${dirPath}`);
      return false;
    }

    console.log(`📁 Directory found: ${path.basename(dirPath)}`);

    // Delete iMovie directories
    const dirsToDelete = ["iMovie Thumbnails", "iMovie Cache"];
    const deletedCount = deleteDirectories(dirPath, dirsToDelete);

    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} directories`);
    } else {
      console.log(`ℹ️ No directories needed cleanup`);
    }

    // Change the label
    const labelChanged = changeLabel(dirPath, "tosquish", "squished");

    if (labelChanged) {
      console.log(`✅ Successfully processed: ${path.basename(dirPath)}`);
      return true;
    } else {
      console.error(`❌ Failed to change label for: ${path.basename(dirPath)}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error processing ${dirPath}:`, error.message);
    return false;
  }
}

// Function to prompt for confirmation
function askForConfirmation(question) {
  const response = execSync(
    `osascript -e 'display dialog "${question}" buttons {"Cancel", "OK"} default button "Cancel" with icon caution'`,
    { stdio: "pipe", encoding: "utf8", timeout: 30000 }
  )
    .toString()
    .trim();

  return response.includes("button returned:OK");
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipConfirmation = args.includes("--force");

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

  // Ask for confirmation unless skipped
  if (!skipConfirmation) {
    try {
      const confirmed = askForConfirmation(
        `Do you want to process ${directories.length} directories?`
      );
      if (!confirmed) {
        console.log("❌ Operation cancelled by user");
        return;
      }
    } catch (error) {
      // Fall back to command-line confirmation if AppleScript dialog fails
      const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const response = readline.question(
        `⚠️ Do you want to proceed with processing these directories? (y/N): `
      );
      readline.close();

      if (response.toLowerCase() !== "y") {
        console.log("❌ Operation cancelled by user");
        return;
      }
    }
  }

  let successCount = 0;
  let failCount = 0;

  for (const dir of directories) {
    const success = processDirectory(dir);
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
try {
  main();
} catch (error) {
  console.error("❌ Fatal error:", error.message);
  process.exit(1);
}
