import OpenAI from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";

// Debug dotenv loading
console.log("📂 Current working directory:", process.cwd());
console.log("🔍 Looking for .env file...");

if (!fs.existsSync(".env")) {
  console.error("❌ .env file not found!");
  process.exit(1);
}

console.log("✅ .env file found");
const envContents = fs.readFileSync(".env", "utf8");
console.log(
  "📝 .env contents:",
  envContents.replace(/sk-.*?[a-zA-Z0-9]{4}/g, "sk-...REDACTED...")
);

// Load environment variables
const result = dotenv.config();
if (result.error) {
  console.error("❌ Error loading .env file:", result.error);
  process.exit(1);
}

console.log("✅ .env file loaded successfully");

// Check if API key is present
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ No OPENAI_API_KEY found in .env file!");
  process.exit(1);
}

console.log("🔑 API Key found, length:", process.env.OPENAI_API_KEY.length);
console.log(
  "🔑 API Key starts with:",
  process.env.OPENAI_API_KEY.substring(0, 7)
);

// First test basic network connectivity
async function testNetwork() {
  console.log("\n🌐 Testing network connectivity...");
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ OpenAI API Error:");
      console.error(JSON.stringify(errorData, null, 2));
      return false;
    }

    const data = await response.json();
    console.log("✅ Network connection successful!");
    console.log("📝 Available models:", data.data.map((m) => m.id).join(", "));
    return true;
  } catch (error) {
    console.error("\n❌ Network Error:");
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    if (error.code === "ETIMEDOUT") {
      console.error("\n⚠️  Connection timed out. This could be due to:");
      console.error("1. Network connectivity issues");
      console.error("2. Firewall blocking the connection");
      console.error("3. Proxy settings interfering with the connection");
      console.error("4. OpenAI API being temporarily unavailable");
    }
    return false;
  }
}

// Test with OpenAI client
async function testOpenAIClient() {
  console.log("\n🤖 Testing OpenAI client...");
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 10000,
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hello!" }],
      max_tokens: 5,
    });

    console.log("✅ OpenAI client test successful!");
    console.log("📝 Response:", response.choices[0].message.content);
    return true;
  } catch (error) {
    console.error("\n❌ OpenAI Client Error:");
    console.error("Error type:", error.constructor.name);
    console.error("Error message:", error.message);
    return false;
  }
}

async function runTests() {
  console.log("🚀 Starting tests...");

  const networkTest = await testNetwork();
  if (!networkTest) {
    console.log("\n⚠️  Network test failed. Skipping client test.");
    return;
  }

  await testOpenAIClient();

  console.log("\n🏁 Tests complete");
}

runTests().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
