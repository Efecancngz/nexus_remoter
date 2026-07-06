
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("Set GEMINI_API_KEY in your environment before running this script.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    console.log("Starting Model Check with @google/generative-ai...");

    const modelsToTest = [
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-001",
        "gemini-1.5-pro",
        "gemini-pro"
    ];

    for (const modelName of modelsToTest) {
        console.log(`\n--- Testing ${modelName} ---`);
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello, are you there?");
            const response = await result.response;
            console.log(`✅ SUCCESS: ${modelName} responded: ${response.text().substring(0, 20)}...`);
        } catch (e) {
            console.log(`❌ FAIL: ${modelName} - Error: ${e.message}`);
        }
    }
}

listModels();
