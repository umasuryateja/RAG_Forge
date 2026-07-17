from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from app.core.config import settings
from app.utils.logger import logger
from app.schemas.response import APIResponse

router = APIRouter()

class SettingsUpdateSchema(BaseModel):
    gemini_api_key: str = Field(..., description="Google Gemini API Key")
    gemini_model: str = Field("gemini-1.5-flash", description="Gemini Model Identifier")
    temperature: float = Field(0.2, ge=0.0, le=2.0, description="Sampling temperature")
    top_k: int = Field(3, ge=1, le=10, description="Retrieve Top K chunks")
    chunk_size: int = Field(800, ge=100, le=5000, description="Max character size per chunk")
    chunk_overlap: int = Field(150, ge=0, le=1000, description="Character overlap between chunks")
    system_instruction: str = Field("", description="RAG instruction prompt")

    @model_validator(mode="after")
    def validate_overlap(self) -> 'SettingsUpdateSchema':
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be strictly less than chunk_size")
        return self

@router.get("/settings", response_model=APIResponse)
def get_settings():
    """
    Expose current active server configurations.
    """
    data = {
        "gemini_api_key": settings.GEMINI_API_KEY,
        "gemini_model": settings.GEMINI_MODEL,
        "temperature": settings.TEMPERATURE,
        "top_k": settings.TOP_K,
        "chunk_size": settings.CHUNK_SIZE,
        "chunk_overlap": settings.CHUNK_OVERLAP,
        "system_instruction": settings.SYSTEM_INSTRUCTION
    }
    return APIResponse(
        success=True,
        message="Current setting configurations retrieved.",
        data=data
    )

@router.put("/settings", response_model=APIResponse)
def update_settings(payload: SettingsUpdateSchema):
    """
    Modify runtime configurations dynamically.
    """
    try:
        settings.GEMINI_API_KEY = payload.gemini_api_key.strip()
        settings.GEMINI_MODEL = payload.gemini_model.strip()
        settings.TEMPERATURE = payload.temperature
        settings.TOP_K = payload.top_k
        settings.CHUNK_SIZE = payload.chunk_size
        settings.CHUNK_OVERLAP = payload.chunk_overlap
        settings.SYSTEM_INSTRUCTION = payload.system_instruction
        
        logger.info("Configuration parameters updated dynamically.")
        
        # Test Gemini Config logic by attempting to re-initialize GeminiService config
        from app.services.gemini_service import GeminiService
        try:
            GeminiService()
        except Exception as api_err:
            logger.warning(f"Updated Gemini parameters failed verification check: {str(api_err)}")
            
        return APIResponse(
            success=True,
            message="Configuration parameters updated successfully.",
            data={
                "gemini_api_key": settings.GEMINI_API_KEY,
                "gemini_model": settings.GEMINI_MODEL,
                "temperature": settings.TEMPERATURE,
                "top_k": settings.TOP_K,
                "chunk_size": settings.CHUNK_SIZE,
                "chunk_overlap": settings.CHUNK_OVERLAP,
                "system_instruction": settings.SYSTEM_INSTRUCTION
            }
        )
    except Exception as e:
        logger.error(f"Error updating configuration: {str(e)}")
        return APIResponse(
            success=False,
            message="Failed to update configuration settings.",
            error=str(e)
        )
