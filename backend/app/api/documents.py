import shutil
import time
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from app.core.config import settings
from app.utils.logger import logger
from app.schemas.response import APIResponse
from app.utils.pdf_reader import extract_text_from_pdf
from app.utils.text_chunker import chunk_text

router = APIRouter()

@router.get("/documents", response_model=APIResponse)
def list_documents():
    """
    Retrieve unique indexed documents with chunk stats.
    """
    # Lazy imports to prevent startup dependency circularities
    from app.main import vector_db_service
    try:
        metadatas = vector_db_service.get_all_document_metadata()
        
        docs = {}
        for meta in metadatas:
            if not meta:
                continue
            filename = meta.get("filename")
            if not filename:
                continue
            
            if filename not in docs:
                docs[filename] = {
                    "filename": filename,
                    "chunks": 0,
                    "upload_time": meta.get("upload_time", "N/A"),
                    "file_size_kb": meta.get("file_size_kb", 0),
                    "page_count": meta.get("page_count", 1)
                }
            docs[filename]["chunks"] += 1
            
        return APIResponse(
            success=True,
            message="Document registry retrieved.",
            data=list(docs.values())
        )
    except Exception as e:
        logger.error(f"Failed to list documents: {str(e)}")
        return APIResponse(
            success=False,
            message="Failed to retrieve document list.",
            error=str(e)
        )

@router.post("/documents/upload", response_model=APIResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    Validate, save, chunk, embed, and index a PDF file in ChromaDB.
    """
    # Lazy imports to prevent startup dependency circularities
    from app.main import embedding_service, vector_db_service
    
    logger.info(f"Received document upload request: {file.filename}")
    
    # 1. File Type Validation
    if not file.filename.lower().endswith(".pdf"):
        logger.warning(f"Rejected invalid file format: {file.filename}")
        return APIResponse(
            success=False,
            message="Invalid file type. Only PDF documents are supported."
        )
        
    UPLOAD_DIR = Path(settings.UPLOAD_DIR)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_path = UPLOAD_DIR / file.filename
    
    try:
        # 2. Save physical file to disk
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        file_size_bytes = file_path.stat().st_size
        file_size_kb = round(file_size_bytes / 1024, 2)
        
        # Calculate SHA-256 hash of the physical file
        import hashlib
        hasher = hashlib.sha256()
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(8192), b""):
                hasher.update(byte_block)
        file_hash = hasher.hexdigest()
        
        # Check if the exact file hash is already indexed
        if vector_db_service.has_file_hash(file_hash):
            logger.info(f"[CACHE HIT] Document '{file.filename}' with hash '{file_hash}' is already indexed. Skipping processing.")
            # Get existing chunks count
            existing_data = vector_db_service.collection.get(where={"file_hash": file_hash}, include=[])
            chunks_stored = len(existing_data.get("ids", []))
            return APIResponse(
                success=True,
                message="Document already indexed (cache hit).",
                data={
                    "filename": file.filename,
                    "chunks_stored": chunks_stored,
                    "file_size_kb": file_size_kb
                }
            )
            
        # Check if filename already exists but hash is different (content changed)
        existing_by_name = vector_db_service.collection.get(where={"filename": file.filename}, limit=1)
        if len(existing_by_name.get("ids", [])) > 0:
            logger.info(f"Document with filename '{file.filename}' exists with different content. Deleting old index records first...")
            vector_db_service.delete_document(file.filename)
        
        # 3. Extract text page-by-page
        pages_data = extract_text_from_pdf(file_path)
        page_count = len(pages_data)
        total_chars = sum(len(page_info["text"]) for page_info in pages_data)
        logger.info(f"[DEBUG RAG] PDF uploaded: {file.filename}")
        logger.info(f"[DEBUG RAG] Characters extracted: {total_chars}")
        logger.info(f"[DEBUG RAG] Total pages: {page_count}")
        
        # 4. Text Verification (Check if PDF has extractable content)
        if not pages_data:
            # Clean up saved file
            if file_path.exists():
                file_path.unlink()
            logger.warning(f"Rejected empty PDF: {file.filename}")
            return APIResponse(
                success=False,
                message="PDF contains no extractable text content. Upload failed."
            )
            
        # 5. Chunk text page-by-page
        chunks = []
        chunk_metadatas = []
        for page_info in pages_data:
            page_num = page_info["page_num"]
            page_text = page_info["text"]
            
            page_chunks = chunk_text(
                page_text, 
                chunk_size=settings.CHUNK_SIZE, 
                overlap=settings.CHUNK_OVERLAP
            )
            for chunk_idx, chunk_content in enumerate(page_chunks):
                chunks.append(chunk_content)
                chunk_metadatas.append({
                    "page": page_num,
                    "chunk_in_page": chunk_idx,
                })
        
        chunk_count = len(chunks)
        logger.info(f"[DEBUG RAG] Chunks created: {chunk_count}")
        
        if not chunks:
            if file_path.exists():
                file_path.unlink()
            return APIResponse(
                success=False,
                message="Text chunking resulted in 0 segments. Upload failed."
            )
            
        # 6. Generate embeddings
        logger.info(f"Generating embeddings for {chunk_count} chunks of file: {file.filename}")
        embeddings = embedding_service.generate_embeddings(chunks)
        emb_dim = len(embeddings[0]) if embeddings else 0
        logger.info(f"[DEBUG RAG] Embedding dimensions: {emb_dim}")
        logger.info(f"[DEBUG RAG] Embeddings generated count: {len(embeddings)}")
        
        # 7. Store in ChromaDB
        metadata_extras = {
            "upload_time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "file_size_kb": file_size_kb,
            "page_count": page_count,
            "file_hash": file_hash
        }
        
        vector_db_service.store_chunks(
            chunks=chunks,
            embeddings=embeddings,
            filename=file.filename,
            chunk_metadatas=chunk_metadatas,
            metadata_extras=metadata_extras
        )
        
        # Invalidate RAG cache since document set has changed
        from app.main import rag_service
        if hasattr(rag_service, "clear_cache"):
            rag_service.clear_cache()
            
        logger.info(f"[DEBUG RAG] Collection name: {settings.CHROMA_COLLECTION_NAME}")
        logger.info(f"[DEBUG RAG] Embeddings stored count: {len(embeddings)}")
        logger.info(f"[DEBUG RAG] Collection count: {vector_db_service.get_vector_count()}")
        
        logger.info(f"Successfully processed document: {file.filename}. Chunks: {len(chunks)}")
        return APIResponse(
            success=True,
            message="Document stored successfully.",
            data={
                "filename": file.filename,
                "chunks_stored": len(chunks),
                "file_size_kb": file_size_kb
            }
        )
    except Exception as e:
        logger.error(f"Error occurred during document processing: {str(e)}")
        # Clean up files on error
        if file_path.exists():
            file_path.unlink()
        return APIResponse(
            success=False,
            message=f"Failed to process and index PDF: {str(e)}",
            error=str(e)
        )

@router.delete("/documents/{filename}", response_model=APIResponse)
def delete_document(filename: str):
    """
    Remove document indexes from ChromaDB and delete physical file from disk.
    Comprehensively logs each stage of deletion to trace failures.
    """
    # Lazy imports to prevent startup dependency circularities
    from app.main import vector_db_service
    
    logger.info(f"[API DELETE TRACE] Received delete request for filename: '{filename}'")
    try:
        # 1. Physical File Deletion
        UPLOAD_DIR = Path(settings.UPLOAD_DIR)
        file_path = UPLOAD_DIR / filename
        logger.info(f"[API DELETE TRACE] Target file path: {file_path.absolute()}")
        
        file_exists_before = file_path.exists()
        logger.info(f"[API DELETE TRACE] File exists before deletion: {file_exists_before}")
        
        if file_exists_before:
            try:
                file_size = file_path.stat().st_size
                logger.info(f"[API DELETE TRACE] Deleting physical file of size {file_size} bytes...")
                file_path.unlink()
                logger.info(f"[API DELETE TRACE] Successfully deleted physical file: {file_path}")
            except Exception as file_err:
                logger.error(f"[API DELETE TRACE] Failed to delete physical file: {file_err}")
                raise file_err
        else:
            logger.warning(f"[API DELETE TRACE] File does not exist on disk at {file_path.absolute()}. Skipping physical delete.")

        # 2. ChromaDB Deletion
        logger.info(f"[API DELETE TRACE] Initiating vector database cleanup for '{filename}'...")
        vector_db_service.delete_document(filename)
        logger.info(f"[API DELETE TRACE] Database deletion completed for '{filename}'.")
        
        # Invalidate RAG cache since document set has changed
        from app.main import rag_service
        if hasattr(rag_service, "clear_cache"):
            rag_service.clear_cache()
            
        return APIResponse(
            success=True,
            message=f"Document '{filename}' successfully deleted."
        )
    except Exception as e:
        logger.error(f"[API DELETE TRACE] Exception occurred during deletion flow: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return APIResponse(
            success=False,
            message=f"Failed to delete document '{filename}'.",
            error=str(e)
        )
