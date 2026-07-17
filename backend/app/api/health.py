import time
from fastapi import APIRouter
from app.core.config import settings
from app.utils.logger import logger
from app.schemas.response import APIResponse

router = APIRouter()

# Capture startup epoch timestamp
START_TIME = time.time()


@router.get("/health", response_model=APIResponse)
def check_health():
    """
    Check the current health of backend services (FastAPI, ChromaDB, Gemini settings, and embedding models).
    """
    logger.info("Executing API diagnostics health checks...")

    # 1. Inspect ChromaDB status
    chromadb_status = "unhealthy"
    try:
        from app.main import vector_db_service
        if vector_db_service and vector_db_service.collection is not None:
            chromadb_status = "healthy"
    except Exception as e:
        logger.error(f"ChromaDB connection check failed: {str(e)}")
        chromadb_status = f"unhealthy ({str(e)})"

    # 2. Inspect Gemini settings status
    gemini_status = "disconnected"
    if settings.GEMINI_API_KEY:
        gemini_status = "configured"
    else:
        logger.warning("Gemini API Key is currently empty or unconfigured.")

    # 3. Inspect Sentence Transformer model status
    embedding_status = "unloaded"
    try:
        from app.main import embedding_service
        if embedding_service and embedding_service.model is not None:
            embedding_status = "loaded"
    except Exception as e:
        logger.error(f"Embedding model check failed: {str(e)}")
        embedding_status = f"unloaded ({str(e)})"

    # Assemble diagnostics payload
    health_data = {
        "status": "healthy" if chromadb_status == "healthy" else "degraded",
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "systems": {
            "chromadb": chromadb_status,
            "gemini_api": gemini_status,
            "embedding_model": embedding_status,
        },
        "config_info": {
            "embedding_model_name": settings.EMBEDDING_MODEL_NAME,
            "gemini_model_name": settings.GEMINI_MODEL,
        },
    }

    return APIResponse(
        success=True,
        message="System status diagnostic complete.",
        data=health_data,
    )
