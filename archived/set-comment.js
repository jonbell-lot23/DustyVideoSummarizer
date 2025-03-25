#!/usr/bin/env node

import { execSync } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const [, , filePath, ...commentParts] = process.argv;
const comment = commentParts.join(" ");

if (!filePath || !comment) {
  console.error("Usage: node set-comment.js <file_path> <comment>");
  process.exit(1);
}

const absolutePath = resolve(process.cwd(), filePath);

try {
  const script = `tell application "Finder"
    set theFile to (POSIX file "${absolutePath}") as alias
    set comment of theFile to "${comment.replace(/"/g, '\\"')}"
  end tell`;

  execSync(`osascript -e '${script}'`);
  console.log("✅ Comment set successfully");

  // Verify the comment was set
  const verifyScript = `tell application "Finder" to get comment of (POSIX file "${absolutePath}" as alias)`;
  const result = execSync(`osascript -e '${verifyScript}'`).toString().trim();
  console.log("\nVerifying comment:");
  console.log(result);
} catch (error) {
  console.error("❌ Failed to set comment:", error.message);
  process.exit(1);
}
