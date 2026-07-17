from typing import Any, Dict, List, Optional
from chromadb import PersistentClient
from app.core.config import settings
from app.utils.logger import logger


class VectorDBService:
    """
    Service wrapping ChromaDB operations (storing vectors, metadata-based filtering, text searches).
    """
    def __init__(self):
        self.client = PersistentClient(path=settings.CHROMA_DB_PATH)
        self.collection = self.client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION_NAME
        )
        self._doc_list_cache = None
        logger.info(
            f"ChromaDB client initiated persistence at '{settings.CHROMA_DB_PATH}', collection: '{settings.CHROMA_COLLECTION_NAME}'"
        )

    def store_chunks(
        self,
        chunks: List[str],
        embeddings: List[List[float]],
        filename: str,
        chunk_metadatas: Optional[List[Dict[str, Any]]] = None,
        metadata_extras: Optional[Dict[str, Any]] = None,
    ):
        """
        Indices text chunks, embeddings, and associated descriptors in ChromaDB.
        """
        ids = []
        metadatas = []

        for index in range(len(chunks)):
            # Establish unique composite key for each vector chunk
            ids.append(f"{filename}_{index}")

            # Define standard RAG filtering descriptors
            meta = {
                "filename": filename,
                "chunk": index,
            }
            if chunk_metadatas and index < len(chunk_metadatas):
                meta.update(chunk_metadatas[index])
            if metadata_extras:
                meta.update(metadata_extras)
            metadatas.append(meta)

        self.collection.add(
            ids=ids,
            documents=chunks,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        self._doc_list_cache = None
        logger.info(
            f"Indexed {len(chunks)} text vector embeddings in ChromaDB for file '{filename}'"
        )

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 3,
    ) -> Dict[str, Any]:
        """
        Retrieves matching document fragments based on vector similarity.
        """
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
        )
        return results

    def get_all_document_metadata(self) -> List[Dict[str, Any]]:
        """
        Retrieves metadata properties across all indexed vector partitions.
        Ensures all elements are returned without ChromaDB's default 100 limit truncation.
        Uses in-memory cache to prevent repeated database queries.
        """
        if self._doc_list_cache is not None:
            return self._doc_list_cache

        total_count = self.collection.count()
        if total_count == 0:
            self._doc_list_cache = []
            return []
        data = self.collection.get(include=["metadatas"], limit=total_count)
        self._doc_list_cache = data.get("metadatas", []) or []
        return self._doc_list_cache

    def delete_document(self, filename: str):
        """
        Deletes all vector indexes matching filename with extensive tracing logs.
        """
        count_before = self.collection.count()
        logger.info(f"[DB DELETE TRACE] Total vector count BEFORE deletion: {count_before}")
        
        # Get count of matching items
        matching_data = self.collection.get(where={"filename": filename}, include=["metadatas"])
        matching_ids = matching_data.get("ids", [])
        matching_count = len(matching_ids)
        logger.info(f"[DB DELETE TRACE] Found {matching_count} vector partitions matching filename='{filename}' (IDs: {matching_ids})")
        
        self.collection.delete(where={"filename": filename})
        
        self._doc_list_cache = None
        count_after = self.collection.count()
        logger.info(f"[DB DELETE TRACE] Total vector count AFTER deletion: {count_after}")
        logger.info(f"[DB DELETE TRACE] Decreased by: {count_before - count_after} partitions (expected: {matching_count})")
        
        # Verify no orphan chunks left for this file
        double_check = self.collection.get(where={"filename": filename}, include=["metadatas"])
        remaining_count = len(double_check.get("ids", []))
        if remaining_count > 0:
            logger.error(f"[DB DELETE TRACE] WARNING: {remaining_count} matching vector partitions still remain in ChromaDB!")
        else:
            logger.info(f"[DB DELETE TRACE] Successfully confirmed 0 matching partitions remain in ChromaDB for '{filename}'.")

    def has_file_hash(self, file_hash: str) -> bool:
        """
        Check if any document with the exact hash has already been stored.
        """
        results = self.collection.get(where={"file_hash": file_hash}, limit=1)
        return len(results.get("ids", [])) > 0

    def get_vector_count(self) -> int:
        """
        Returns total number of items stored in vector collection.
        """
        return self.collection.count()