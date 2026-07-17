from typing import Optional
from pydantic import BaseModel, Field


class ChatQuery(BaseModel):
    """
    Validation schema for interactive chat queries.
    """
    question: str = Field(
        ...,
        min_length=1,
        description="The question or command queried to the RAG pipeline.",
    )
    top_k: Optional[int] = Field(
        3,
        ge=1,
        le=10,
        description="The number of document chunks to fetch as context.",
    )
