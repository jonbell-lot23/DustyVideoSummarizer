#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
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
    console.error("Error finding labeled directories:", error.message);
    return [];
  }
}

// Function to run a command with proper monitoring
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    // Log the command with proper escaping for display
    const safeArgs = args.map((arg) => {
      // Add quotes around arguments that contain spaces or special characters
      return arg.includes(" ") || arg.includes("(") || arg.includes(")")
        ? `"${arg}"`
        : arg;
    });
    console.log(`📋 Running: ${command} ${safeArgs.join(" ")}`);

    // Use execSync for immediate output if needed
    if (options.useExecSync) {
      try {
        console.log("⚠️ Using synchronous execution for immediate output");

        // When using execSync, we need to handle paths with spaces properly
        let cmdToRun;
        if (process.platform === "win32") {
          // Windows needs double quotes
          cmdToRun = `${command} ${args.map((a) => `"${a}"`).join(" ")}`;
        } else {
          // Unix-like systems can use single quotes
          cmdToRun = `${command} ${args
            .map((a) => {
              if (
                a.includes(" ") ||
                a.includes("(") ||
                a.includes(")") ||
                a.includes("'")
              ) {
                // Escape single quotes inside the argument and wrap in single quotes
                return `'${a.replace(/'/g, "'\\''")}'`;
              }
              return a;
            })
            .join(" ")}`;
        }

        const stdout = execSync(cmdToRun, {
          stdio: "inherit",
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });
        console.log(`✅ Command completed successfully`);
        resolve(stdout);
        return;
      } catch (error) {
        console.error(`❌ Command failed: ${error.message}`);
        reject(error);
        return;
      }
    }

    // Otherwise use spawn with dedicated output handling
    const proc = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      ...options,
    });

    // Set up stdout and stderr handling for real-time output
    proc.stdout.on("data", (data) => {
      process.stdout.write(data.toString());
    });

    proc.stderr.on("data", (data) => {
      process.stderr.write(data.toString());
    });

    // Set a timeout to kill the process if it takes too long
    const timeout = options.timeout || 3600000; // Default 1 hour timeout
    const timeoutId = setTimeout(() => {
      console.error(`⏱️ Process timed out after ${timeout / 1000} seconds`);
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000); // Force kill after 5 seconds if still running
      reject(new Error("Process timed out"));
    }, timeout);

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      console.error(`❌ Process error: ${error.message}`);
      reject(error);
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        console.log(`✅ Command completed successfully`);
        resolve();
      } else {
        const error = new Error(`Command failed with exit code ${code}`);
        console.error(`❌ ${error.message}`);
        reject(error);
      }
    });
  });
}

// Function to process a single directory
async function processDirectory(dirPath, extraArgs = []) {
  console.log(`\n🔍 Processing: ${dirPath}`);

  try {
    // Check if directory exists and is accessible
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    console.log(`📁 Directory found: ${dirPath}`);

    // Perform video processing if not skipped
    if (!skipVideoProcessing && !labelOnlyMode) {
      // Run the squish-and-define.cjs script on the directory
      console.log("🎬 Running squish-and-define.cjs...");

      try {
        // Prepare arguments
        const scriptArgs = ["squish-and-define.cjs", dirPath, ...extraArgs];

        // Add verbose flag if needed
        if (verbose) {
          scriptArgs.push("--verbose");
        }

        // If noClobber is explicitly set, make sure it's passed along
        if (noClobber) {
          console.log(
            "🛡️ No-clobber mode: Original files will NOT be replaced"
          );
        }

        // Use execSync for immediate output
        await runCommand("node", scriptArgs, {
          timeout: 7200000, // 2 hour timeout
          useExecSync: true,
        });
      } catch (error) {
        console.error(`❌ squish-and-define.cjs failed: ${error.message}`);

        if (labelOnlyMode) {
          console.log(
            "📝 Continuing with label changes since --label-only is enabled"
          );
        } else if (!skipConfirmation) {
          // Ask if we should continue with label changes despite the error
          const continueWithLabels = await askForConfirmation(
            "⚠️ Video processing failed. Would you like to continue with label changes and cleanup?"
          );

          if (!continueWithLabels) {
            throw error; // Re-throw to stop processing this directory
          }
        } else {
          throw error; // Re-throw in non-interactive mode
        }
      }
    } else {
      console.log("⏭️ Skipping video processing as requested");
    }

    // Check for and delete iMovie directories
    const iMovieDirs = ["iMovie Thumbnails", "iMovie Cache"];

    iMovieDirs.forEach((dir) => {
      const fullPath = path.join(dirPath, dir);
      if (fs.existsSync(fullPath)) {
        console.log(`🗑️  Deleting: ${fullPath}`);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`✅ Successfully deleted: ${fullPath}`);
        } catch (error) {
          console.error(`❌ Error deleting ${fullPath}: ${error.message}`);
        }
      } else {
        console.log(`ℹ️ Directory not found, skipping: ${fullPath}`);
      }
    });

    // Change the label from "tosquish" to "squished"
    try {
      changeLabel(dirPath, "tosquish", "squished");
    } catch (error) {
      console.error(`❌ Error changing label: ${error.message}`);
    }

    console.log(`✅ Successfully processed: ${dirPath}`);
    return true;
  } catch (error) {
    console.error(`❌ Error processing ${dirPath}:`, error.message);
    return false;
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
  } catch (error) {
    console.error(`❌ Error changing tags: ${error.message}`);
    throw error;
  }
}

// Parse command-line arguments
const args = process.argv.slice(2);
const skipProcessing = args.includes("--skip-processing");
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const debugMode = args.includes("--debug");
const testMode = args.includes("--test");
const skipConfirmation = args.includes("--force");
const noClobber = args.includes("--no-clobber"); // Explicitly disable clobber
const skipVideoProcessing = args.includes("--skip-video-processing"); // Skip video compression
const labelOnlyMode = args.includes("--label-only"); // Only change labels

// Function to prompt for confirmation
function askForConfirmation(question) {
  return new Promise((resolve) => {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    readline.question(`${question} (y/N): `, (answer) => {
      readline.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

// Function to display the content of squish-and-define.cjs
function displayScriptContent() {
  try {
    console.log("\n📝 Content of squish-and-define.cjs:");
    const content = fs.readFileSync("squish-and-define.cjs", "utf8");
    console.log(content);
  } catch (error) {
    console.error("❌ Could not read squish-and-define.cjs:", error.message);
  }
}

// Main function
async function main() {
  console.log('🔎 Finding directories labeled "tosquish"...');

  // Display help if requested
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: node findAndSquish.cjs [options]

Options:
  --dry-run               Find directories but don't process them
  --test                  Process only one file from each directory
  --skip-processing       Skip all processing, just change labels
  --skip-video-processing Skip video processing but perform cleanup and label changes
  --label-only            Only change labels, skip all other processing
  --no-clobber            Don't replace original files
  --verbose               Show detailed output
  --debug                 Display debug information
  --force                 Skip confirmation prompts
  --help, -h              Display this help message

Examples:
  node findAndSquish.cjs --dry-run         # Just list directories
  node findAndSquish.cjs --test            # Process one file from each directory
  node findAndSquish.cjs --label-only      # Only change labels
  node findAndSquish.cjs --no-clobber      # Keep original files
    `);
    return;
  }

  if (labelOnlyMode) {
    console.log(
      "🏷️  LABEL-ONLY MODE: Will only change labels, no video processing"
    );
  }

  if (skipVideoProcessing) {
    console.log(
      "⏭️  SKIP-VIDEO MODE: Will skip video processing, but perform cleanup and label changes"
    );
  }

  if (debugMode) {
    console.log("🔧 DEBUG MODE ENABLED");
    console.log("📊 Environment:", process.env.NODE_ENV);
    console.log("📂 Current directory:", process.cwd());

    try {
      const files = fs.readdirSync(".");
      console.log("📁 Files in current directory:", files);
    } catch (error) {
      console.error("❌ Error listing files:", error.message);
    }

    // Display the content of squish-and-define.cjs
    displayScriptContent();
  }

  // Check if we can execute squish-and-define.cjs
  try {
    fs.accessSync("squish-and-define.cjs", fs.constants.R_OK);
    console.log("✅ squish-and-define.cjs is readable");
  } catch (error) {
    console.error("❌ Cannot access squish-and-define.cjs:", error.message);
    console.log(
      "💡 Try running this script from the directory containing squish-and-define.cjs"
    );
    return;
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

  // If test mode is enabled, just process a single file as a test
  if (testMode) {
    console.log(
      "🧪 TEST MODE: Will process only one small file from each directory"
    );
  }

  // Ask for confirmation if not skipped
  if (!skipConfirmation) {
    const confirmed = await askForConfirmation(
      "⚠️ Do you want to proceed with processing these directories?"
    );
    if (!confirmed) {
      console.log("❌ Operation cancelled by user");
      return;
    }
  }

  for (const dir of directories) {
    if (skipProcessing) {
      console.log(`⏭️ Skipping processing (--skip-processing flag): ${dir}`);
      try {
        changeLabel(dir, "tosquish", "squished");
      } catch (error) {
        console.error(`❌ Error changing label: ${error.message}`);
      }
    } else {
      // Prepare arguments for processing
      const processArgs = [];

      // Add test mode if enabled
      if (testMode) {
        processArgs.push("--limit=1");
      }

      // Explicitly pass no-clobber if specified
      if (noClobber) {
        // Don't add the --clobber flag in squish-and-define.cjs
      } else {
        // Let squish-and-define.cjs decide based on its own arguments
      }

      await processDirectory(dir, processArgs);
    }
  }

  console.log("\n🎉 All directories processed");
}

// Run the main function
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
