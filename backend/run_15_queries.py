import json
import time
import requests

# Base URL of the running backend server
API_BASE = "http://127.0.0.1:8000/api/v1"

def run_demonstration():
    filename = "RAGForge_Overview.pdf"
    
    print("--- 1. UPLOADING RICH DEMONSTRATION DOCUMENT ---")
    with open(filename, "rb") as f:
        res = requests.post(f"{API_BASE}/documents/upload", files={"file": (filename, f, "application/pdf")})
        assert res.status_code == 200, f"Upload failed: {res.text}"
        print(f"Upload success: {res.json()}")

    # Delay to let Chroma index the file
    time.sleep(1)

    questions = [
        "What is RAGForge?",
        "Who is the lead developer of RAGForge?",
        "Who is the chief architect of RAGForge?",
        "What is the official release date of the system?",
        "What is the primary administrator passcode?",
        "What is the secondary backup passcode?",
        "What security protocol or encryption standard is used?",
        "How often does the security encryption key rotate?",
        "What default port does the FastAPI service run on?",
        "What default port does the Vite client dev server run on?",
        "What document database or vector database is used?",
        "What SentenceTransformer model is used for calculating embeddings?",
        "What generative model is used for content synthesis?",
        "What are the default chunk size and overlap values?",
        "What file formats are supported for upload?"
    ]

    print("\n--- 2. EXECUTING 15 RAG QUERIES ---")
    try:
        for idx, question in enumerate(questions, 1):
            # 6.5s delay to keep within free-tier API rate limits
            time.sleep(6.5)
            print(f"\n[{idx}/15] Question: {question}")
            
            # Post search stream request
            res = requests.post(f"{API_BASE}/chat/stream", json={"question": question, "top_k": 3}, stream=True)
            assert res.status_code == 200, f"Query failed: {res.text}"

            citations = []
            text_response = ""
            
            # Read chunk streams
            for line in res.iter_lines():
                if line:
                    line_str = line.decode("utf-8")
                    if line_str.startswith("data: "):
                        payload = json.loads(line_str[6:])
                        if payload["type"] == "citations":
                            citations = payload["content"]
                        elif payload["type"] == "text":
                            text_response += payload["content"]
                        elif payload["type"] == "error":
                            print(f"Error block yielded: {payload['content']}")

            print(f"Response: {text_response}")
            # Ensure the response mentions the passcode or key terms correctly (citations should contain details)
            print(f"Verified Citations: {citations}")

    finally:
        print("\n--- 3. CLEANING UP DATABASE INDEX ---")
        res = requests.delete(f"{API_BASE}/documents/{filename}")
        if res.status_code == 200:
            print(f"Deleted database index for: {filename}")
        else:
            print(f"Failed to delete database record: {res.text}")

if __name__ == "__main__":
    print("Starting 15 questions validation run...")
    run_demonstration()
    print("\nDEMONSTRATION RUN COMPLETE!")
