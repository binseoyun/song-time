import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    print("GEMINI_API_KEY not found in .env file.")
else:
    genai.configure(api_key=GEMINI_API_KEY)
    print("Listing available models:")
    for model in genai.list_models():
        if "generateContent" in model.supported_generation_methods:
            print(f"- {model.name} (Supported: {model.supported_generation_methods})")
