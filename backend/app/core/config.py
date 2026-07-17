from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Centralized Settings class using pydantic-settings.
    Loads variables from the environment or a .env file.
    """
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Enterprise AI Knowledge Assistant"
    
    # CORS Settings
    # Expects list of strings or comma-separated string
    # E.g. "http://localhost:5173,http://localhost:3000"
    BACKEND_CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                import json
                return json.loads(v)
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    # Relational Database Connection URI
    # Falls back to local SQLite file for development convenience.
    # In production, this will contain a postgresql:// connection string.
    DATABASE_URL: str = "sqlite:///./sql_app.db"

    # Google Gemini API Settings
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    TEMPERATURE: float = 0.2
    TOP_K: int = 3
    SYSTEM_INSTRUCTION: str = (
        "You are an expert Enterprise AI Knowledge Assistant. Your goal is to answer user queries "
        "accurately, naturally, and strictly using the provided document context.\n\n"
        "Rules:\n"
        "1. Base your answer ONLY on the provided document context.\n"
        "2. If the context does not contain the answer, respond EXACTLY with: 'I couldn't find that information in your uploaded documents.' and do not output any other text.\n"
        "3. Do not make up facts, guess, or hallucinate.\n"
        "4. Format code blocks, lists, and headings cleanly in Markdown.\n"
        "5. Do not mention page numbers, chunk indexes, segment IDs, or source filenames inside the text of your response. Keep the response natural and clean."
    )

    # Embedding Config
    EMBEDDING_MODEL_NAME: str = "all-MiniLM-L6-v2"

    # Vector Storage Config (ChromaDB)
    CHROMA_DB_PATH: str = "chroma_db"
    CHROMA_COLLECTION_NAME: str = "documents"

    # Document Chunking Config
    UPLOAD_DIR: str = "uploads"
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150

    # Logging Configuration
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/app.log"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()
