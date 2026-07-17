import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.schemas.chat import ChatQuery

router = APIRouter()


@router.post("/chat/stream")
async def chat_stream(query: ChatQuery):
    """
    Streams RAG response citations and text synthesis using Server-Sent Events (SSE).
    """
    # Lazy imports to prevent startup dependency circularities
    from app.main import rag_service

    def event_generator():
        try:
            stream = rag_service.execute_rag_stream(
                question=query.question, top_k=query.top_k or 3
            )
            for chunk in stream:
                # Standard SSE envelope: "data: {json}\n\n"
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            err_payload = {"type": "error", "content": f"Streaming system error: {str(e)}"}
            yield f"data: {json.dumps(err_payload)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
