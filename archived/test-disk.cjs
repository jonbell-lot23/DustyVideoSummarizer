#!/usr/bin/env node

const fs = require("fs-extra");
const path = require("path");

// Simple function to log with timestamps
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function testFilesystem(dirPath) {
  log(`Starting filesystem test for: ${dirPath}`);

  try {
    // Test 1: Check if directory exists
    log("Test 1: Checking if directory exists");
    const exists = await fs.pathExists(dirPath);
    log(`Directory exists: ${exists}`);

    if (!exists) {
      log("Directory does not exist, stopping tests");
      return;
    }

    // Test 2: List directory contents
    log("Test 2: Listing directory contents");
    const start = Date.now();
    log("Reading directory...");
    const files = await fs.readdir(dirPath);
    const duration = Date.now() - start;
    log(`Directory read completed in ${duration}ms`);
    log(`Found ${files.length} items`);

    // Test 3: Get stats for first few files
    log("Test 3: Getting stats for first few files");
    const sampleFiles = files.slice(0, 3);
    for (const file of sampleFiles) {
      const filePath = path.join(dirPath, file);
      log(`Checking stats for: ${file}`);
      const fileStart = Date.now();
      const stats = await fs.stat(filePath);
      const fileDuration = Date.now() - fileStart;
      log(`Stats retrieved in ${fileDuration}ms`);
      log(
        `Size: ${(stats.size / (1024 * 1024)).toFixed(
          2
        )} MB, isDirectory: ${stats.isDirectory()}`
      );
    }

    // Test 4: Try to read a small portion of the first file (if it's not a directory)
    if (sampleFiles.length > 0) {
      const firstFile = path.join(dirPath, sampleFiles[0]);
      const stats = await fs.stat(firstFile);

      if (!stats.isDirectory()) {
        log(`Test 4: Reading first 1KB of file: ${sampleFiles[0]}`);
        const readStart = Date.now();
        const fd = await fs.open(firstFile, "r");
        const buffer = Buffer.alloc(1024);
        await fs.read(fd, buffer, 0, 1024, 0);
        await fs.close(fd);
        const readDuration = Date.now() - readStart;
        log(`File read completed in ${readDuration}ms`);
      } else {
        log("First item is a directory, skipping file read test");
      }
    }

    log("All filesystem tests completed successfully");
  } catch (error) {
    log(`ERROR: ${error.message}`);
    log(`Error stack: ${error.stack}`);
  }
}

// Get directory path from command line argument
const dirPath = process.argv[2];
if (!dirPath) {
  console.log("Usage: node test-disk.cjs <directory_path>");
  process.exit(1);
}

// Run the tests
testFilesystem(dirPath);
