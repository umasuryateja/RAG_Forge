from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.utils.logger import logger
from app.api.health import router as health_router
from app.api.chat import router as chat_router
from app.api.documents import router as documents_router, upload_document
from app.api.settings import router as settings_router
from app.services.embedding_service import EmbeddingService
from app.services.vector_db_service import VectorDBService
from app.services.gemini_service import GeminiService
from app.services.rag_service import RAGService

app = FastAPI(title=settings.PROJECT_NAME)

# Log application boot
logger.info("Initializing Enterprise AI Knowledge Assistant app...")

# Initialize core RAG services
embedding_service = EmbeddingService()
vector_db_service = VectorDBService()
gemini_service = GeminiService()
rag_service = RAGService(
    embedding_service=embedding_service,
    vector_db_service=vector_db_service,
    gemini_service=gemini_service,
)

# Create uploads folder if it doesn't exist
UPLOAD_DIR = Path(settings.UPLOAD_DIR)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Add CORS Middleware using environmental settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register new modular health, chat, document, and settings routers
app.include_router(health_router, prefix=settings.API_V1_STR)
app.include_router(chat_router, prefix=settings.API_V1_STR)
app.include_router(documents_router, prefix=settings.API_V1_STR)
app.include_router(settings_router, prefix=settings.API_V1_STR)


@app.get("/")
def home():
    return {"message": "RAG Chatbot Backend is Running"}


@app.get("/api/search")
def search_documents(question: str):
    logger.info(f"Legacy API Search request received: {question}")
    try:
        query_embedding = embedding_service.generate_query_embedding(
            question
        )
        results = vector_db_service.search(
            query_embedding,
            top_k=settings.TOP_K
        )
        return results
    except Exception as e:
        logger.error(f"Legacy search API failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    logger.info(f"Legacy API Upload request received for file: {file.filename}")
    res = await upload_document(file)
    if not res.success:
        raise HTTPException(status_code=400, detail=res.message)
    return {
        "message": res.message,
        "filename": res.data["filename"],
        "chunks_stored": res.data["chunks_stored"],
    }