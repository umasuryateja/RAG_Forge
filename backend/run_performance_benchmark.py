import requests
import time
import json

API_BASE = "http://127.0.0.1:8000/api/v1"

def run_benchmarks():
    print("==========================================================")
    print("                RAGFORGE PERFORMANCE BENCHMARK            ")
    print("==========================================================")

    # 1. Ingest PDF first to ensure we have content to search
    print("\n[Step 1] Setting up base document: RAGForge_Overview.pdf...")
    filename = "RAGForge_Overview.pdf"
    filepath = "c:/Users/jakka/OneDrive/Desktop/RAGForge/backend/RAGForge_Overview.pdf"
    
    with open(filepath, "rb") as f:
        res = requests.post(f"{API_BASE}/documents/upload", files={"file": (filename, f, "application/pdf")})
        print(f"Setup Upload status: {res.status_code}")

    # 2. Warm up query (first RAG execution)
    print("\n[Step 2] Executing cold RAG query (with full pipeline execution)...")
    question = "What is the primary administrator passcode for server configuration?"
    
    t_start = time.time()
    res = requests.post(f"{API_BASE}/chat/stream", json={"question": question, "top_k": 3}, stream=True)
    
    first_chunk_latency = None
    accumulated_text = ""
    metrics = None
    
    for line in res.iter_lines():
        if line:
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                payload = json.loads(line_str[6:])
                if payload["type"] == "text":
                    if first_chunk_latency is None:
                        first_chunk_latency = (time.time() - t_start) * 1000
                    accumulated_text += payload["content"]
                elif payload["type"] == "metrics":
                    metrics = payload["content"]
                    
    total_cold_time = (time.time() - t_start) * 1000
    print(f"Cold query response synthesis complete.")
    
    # 3. Hot query (exact same query, hitting the cache)
    print("\n[Step 3] Executing identical hot RAG query (hitting cache)...")
    t_hot_start = time.time()
    res_hot = requests.post(f"{API_BASE}/chat/stream", json={"question": question, "top_k": 3}, stream=True)
    
    hot_first_chunk = None
    hot_accumulated = ""
    hot_metrics = None
    
    for line in res_hot.iter_lines():
        if line:
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                payload = json.loads(line_str[6:])
                if payload["type"] == "text":
                    if hot_first_chunk is None:
                        hot_first_chunk = (time.time() - t_hot_start) * 1000
                    hot_accumulated += payload["content"]
                elif payload["type"] == "metrics":
                    hot_metrics = payload["content"]
                    
    total_hot_time = (time.time() - t_hot_start) * 1000
    print(f"Hot query response synthesis complete.")

    # 4. Check document listing (hitting metadata registry cache)
    print("\n[Step 4] Querying document listing (cache hit speed)...")
    t_list_start = time.time()
    res_list = requests.get(f"{API_BASE}/documents")
    total_list_time = (time.time() - t_list_start) * 1000
    print(f"Document listing complete. Records found: {len(res_list.json().get('data', []))}")

    # 5. Check unchanged PDF upload (hitting SHA-256 hash validation)
    print("\n[Step 5] Uploading unchanged PDF document (hash validation hit speed)...")
    t_upload_start = time.time()
    with open(filepath, "rb") as f:
        res_upload = requests.post(f"{API_BASE}/documents/upload", files={"file": (filename, f, "application/pdf")})
    total_upload_time = (time.time() - t_upload_start) * 1000
    print(f"Unchanged upload status: {res_upload.status_code}, Response: {res_upload.json()['message']}")

    # Output Benchmark Results Table
    print("\n=========================================================================")
    print("                     PERFORMANCE COMPARISON REPORT                      ")
    print("=========================================================================")
    print(f"{'Pipeline Stage / Operation':<35} | {'Target limit':<18} | {'Measured Time':<15}")
    print("-" * 75)
    
    if metrics:
        print(f"{'Embedding Generation (SentenceTrans)':<35} | {'< 100 ms':<18} | {metrics['embedding_ms']:.2f} ms")
        print(f"{'Vector Search (ChromaDB)':<35} | {'< 100 ms':<18} | {metrics['search_ms']:.2f} ms")
        print(f"{'Context Building & Deduplication':<35} | {'< 100 ms':<18} | {metrics['context_ms']:.2f} ms")
        print(f"{'Gemini API Latency (First Chunk)':<35} | {'N/A (API Dependent)':<18} | {metrics['first_chunk_ms']:.2f} ms")
        print(f"{'Gemini API Latency (Total)':<35} | {'N/A (API Dependent)':<18} | {metrics['gemini_total_ms']:.2f} ms")
        print(f"{'Total Cold RAG Pipeline Time':<35} | {'< 500 ms (excl LLM)':<18} | {metrics['total_ms']:.2f} ms")
    else:
        print("Cold pipeline metrics unavailable.")
        
    print("-" * 75)
    print(f"{'RAG Query Cache Hit (Identical Q)':<35} | {'< 10 ms':<18} | {total_hot_time:.2f} ms")
    print(f"{'Document Registry Cache Hit':<35} | {'< 10 ms':<18} | {total_list_time:.2f} ms")
    print(f"{'Unchanged PDF Upload Hash Hit':<35} | {'< 50 ms':<18} | {total_upload_time:.2f} ms")
    print("=========================================================================\n")

if __name__ == "__main__":
    run_benchmarks()
