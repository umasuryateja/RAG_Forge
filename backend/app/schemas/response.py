from typing import Any, Optional
from pydantic import BaseModel, Field


class APIResponse(BaseModel):
    """
    Standard envelope format for all backend REST JSON APIs.
    """
    success: bool = Field(
        ...,
        description="Boolean flag indicating if the call completed successfully.",
    )
    message: str = Field(
        ...,
        description="Human readable explanation of transaction status.",
    )
    data: Optional[Any] = Field(
        None,
        description="Payload of data returned by backend business operations.",
    )
    error: Optional[str] = Field(
        None,
        description="Detailed debug message indicating transaction failure if success=False.",
    )
