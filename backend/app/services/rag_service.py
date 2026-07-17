import re
from collections import defaultdict
from typing import Any, Dict, Generator
from app.core.config import settings
from app.core.prompts import RAG_USER_PROMPT_TEMPLATE
from app.services.embedding_service import EmbeddingService
from app.services.gemini_service import GeminiService, classify_gemini_exception
from app.services.vector_db_service import VectorDBService
from app.utils.logger import logger


def is_nearly_identical(text1: str, text2: str) -> bool:
    """
    Check if text1 and text2 are nearly identical based on a Jaccard word similarity threshold.
    """
    clean1 = re.sub(r'[^\w\s]', '', text1.lower())
    clean2 = re.sub(r'[^\w\s]', '', text2.lower())
    words1 = set(clean1.split())
    words2 = set(clean2.split())
    if not words1 or not words2:
        return False
    intersection = words1.intersection(words2)
    union = words1.union(words2)
    similarity = len(intersection) / len(union)
    return similarity > 0.6


def deduplicate_paragraphs(text: str) -> str:
    """
    Split text into paragraphs and return unique ones, preserving order.
    """
    paras = [p.strip() for p in re.split(r'\n+', text) if p.strip()]
    unique_paras = []
    for p in paras:
        is_dup = False
        for up in unique_paras:
            if p == up or p in up or up in p:
                is_dup = True
                break
            if len(p) > 20 and len(up) > 20:
                if is_nearly_identical(p, up):
                    is_dup = True
                    break
        if not is_dup:
            unique_paras.append(p)
    return "\n\n".join(unique_paras)


def merge_texts(text1: str, text2: str) -> str:
    """
    Stitch two text segments together cleanly by splitting into paragraphs and removing duplicates.
    """
    combined = text1 + "\n\n" + text2
    return deduplicate_paragraphs(combined)


class RAGService:
    """
    Orchestration service combining vector database search, metadata parsing, and generative AI content streaming.
    """
    def __init__(
        self,
        embedding_service: EmbeddingService,
        vector_db_service: VectorDBService,
        gemini_service: GeminiService,
    ):
        self.embedding_service = embedding_service
        self.vector_db_service = vector_db_service
        self.gemini_service = gemini_service
        self._rag_cache = {}

    def clear_cache(self):
        self._rag_cache.clear()
        if hasattr(self.embedding_service, "_query_cache"):
            self.embedding_service._query_cache.clear()
        logger.info("RAG Query cache and Embedding query cache cleared.")

    def execute_rag_stream(
        self, question: str, top_k: int = None
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Orchestrate retrieval, formatting, and generation streams.
        Yields JSON fragments detailing citations and text chunks.
        """
        import time
        t_start = time.time()

        if top_k is None:
            top_k = settings.TOP_K

        # Check Cache
        if question in self._rag_cache:
            cached = self._rag_cache[question]
            logger.info(f"[CACHE HIT] Returning cached RAG response for query: '{question}'")
            yield {"type": "citations", "content": cached["citations"]}
            yield {"type": "text", "content": cached["response_text"]}
            
            # Send metrics
            t_total = time.time() - t_start
            metrics = {
                "embedding_ms": 0.0,
                "search_ms": 0.0,
                "context_ms": 0.0,
                "first_chunk_ms": 0.0,
                "gemini_total_ms": 0.0,
                "total_ms": round(t_total * 1000, 2),
                "cache_hit": True
            }
            yield {"type": "metrics", "content": metrics}
            return

        logger.info(
            f"Orchestrating RAG retrieval for question='{question}', top_k={top_k}"
        )

        t_emb_start = time.time()
        try:
            # Step 1: Generate question embedding
            query_embedding = (
                self.embedding_service.generate_query_embedding(question)
            )
            t_emb_end = time.time()
            logger.info(f"[DEBUG RAG] Query embedding dimension: {len(query_embedding)}")
            logger.info(f"[DEBUG RAG] Query embedding snippet: {query_embedding[:5]}...")

            # Step 2: Pre-fetch exactly 10 candidates to allow deduplication & ranking filters
            t_search_start = time.time()
            candidate_count = 10
            logger.info(f"Querying search index database for top {candidate_count} candidates...")
            search_results = self.vector_db_service.search(
                query_embedding, top_k=candidate_count
            )
            t_search_end = time.time()
        except Exception as e:
            logger.error(f"Search retrieval during RAG failed: {str(e)}")
            yield {"type": "error", "content": f"Database search failed: {str(e)}"}
            return

        t_context_start = time.time()
        ids = search_results.get("ids", [[]])[0]
        documents = search_results.get("documents", [[]])[0]
        metadatas = search_results.get("metadatas", [[]])[0]
        distances = search_results.get("distances", [[]])[0]

        logger.info(f"[DEBUG RAG] Retrieved raw chunk count: {len(documents)}")

        # Step 3: Filtering & Deduplication
        valid_candidates = []
        for idx, (doc, meta, dist) in enumerate(zip(documents, metadatas, distances)):
            # Convert L2 distance into match relevance score
            score = round(max(0.0, 1.0 - (dist / 2.0)), 2)
            logger.info(f"[DEBUG RAG] Raw candidate chunk {idx}: filename={meta.get('filename')}, similarity score={score}, metadata={meta}")
            
            # 3a. Relevance threshold check
            if score < 0.3:
                logger.info(f"Candidate chunk {idx} (file: {meta.get('filename')}) skipped. Score {score} below threshold (0.3).")
                continue

            # 3b. Jaccard duplication check
            is_dup = False
            for prev_doc, _, _ in valid_candidates:
                if is_nearly_identical(doc, prev_doc):
                    is_dup = True
                    logger.info(f"Candidate chunk {idx} (file: {meta.get('filename')}) skipped. Near-identical match detected.")
                    break
            if is_dup:
                continue

            valid_candidates.append((doc, meta, score))

        logger.info(f"[DEBUG RAG] Chunks count after filtering/deduplication: {len(valid_candidates)}")

        # Step 4: Group & Merge adjacent chunks (slice to top_k, standard 3, max 5)
        # Group candidates by filename
        merged_docs_by_file = defaultdict(list)
        for doc, meta, score in valid_candidates[:top_k]:
            filename = meta.get("filename", "unknown")
            merged_docs_by_file[filename].append((doc, meta, score))

        merged_results = []
        for filename, items in merged_docs_by_file.items():
            # Sort items by their original chunk index in the file
            items.sort(key=lambda x: x[1].get("chunk", 0))
            
            merged_doc = items[0][0]
            merged_meta = dict(items[0][1])
            max_score = items[0][2]
            
            merged_pages = {merged_meta.get("page")} if merged_meta.get("page") else set()
            merged_chunks = {merged_meta.get("chunk")}

            for next_doc, next_meta, next_score in items[1:]:
                curr_chunk = next_meta.get("chunk", 0)
                prev_chunk = max(merged_chunks)
                
                # If chunk indices are adjacent, stitch the texts
                if curr_chunk - prev_chunk <= 1:
                    merged_doc = merge_texts(merged_doc, next_doc)
                    merged_chunks.add(curr_chunk)
                    if next_meta.get("page"):
                        merged_pages.add(next_meta.get("page"))
                    max_score = max(max_score, next_score)
                else:
                    # Flush the previous merged block and start a new one
                    merged_results.append((
                        merged_doc,
                        filename,
                        sorted(list(merged_pages)),
                        sorted(list(merged_chunks)),
                        max_score
                    ))
                    merged_doc = next_doc
                    merged_meta = dict(next_meta)
                    max_score = next_score
                    merged_pages = {merged_meta.get("page")} if merged_meta.get("page") else set()
                    merged_chunks = {merged_meta.get("chunk")}

            merged_results.append((
                merged_doc,
                filename,
                sorted(list(merged_pages)),
                sorted(list(merged_chunks)),
                max_score
            ))

        logger.info(f"[DEBUG RAG] Unified retrieval contains {len(merged_results)} logical text blocks after adjacent merging.")

        # Step 5: Construct citations array & context blocks (compact format to reduce prompt tokens)
        citations = []
        context_str = ""
        seen_sources = set()

        for idx, (doc, filename, pages, chunks_idx, score) in enumerate(merged_results):
            pages_str = ", ".join(map(str, pages)) if pages else "N/A"
            chunks_str = ", ".join(map(str, chunks_idx))

            citations.append({
                "id": f"{filename}_merged_{idx}",
                "filename": filename,
                "pages": pages,
                "chunks": chunks_idx,
                "score": score,
                "preview": doc
            })

            context_str += (
                f"[{filename} (Page {pages_str}, Seg {chunks_str})]:\n{doc}\n---\n"
            )

        t_context_end = time.time()

        if not merged_results:
            logger.info("Search returned 0 valid candidates. Yielding fallback response.")
            yield {"type": "citations", "content": []}
            fallback_msg = "I couldn't find that information in your uploaded documents. Here's a general explanation based on my knowledge:\n\n---\n\n"
            yield {"type": "text", "content": fallback_msg}
            t_gemini_start = time.time()
            first_chunk_received = False
            t_first_chunk = 0.0
            response_text = ""
            try:
                logger.info("Invoking fallback Gemini stream (0 candidates)...")
                general_system_instruction = (
                    "You are a helpful, professional Enterprise AI Knowledge Assistant. "
                    "Answer the user's question using your general knowledge."
                )
                stream_gen = self.gemini_service.generate_response_stream(
                    prompt=question,
                    system_instruction=general_system_instruction,
                    temperature=0.7,
                )
                for text_chunk in stream_gen:
                    if text_chunk:
                        if not first_chunk_received:
                            t_first_chunk = time.time() - t_gemini_start
                            first_chunk_received = True
                        response_text += text_chunk
                        yield {"type": "text", "content": text_chunk}
            except Exception as e:
                logger.error(f"Fallback stream failed: {str(e)}")
                classified = classify_gemini_exception(e)
                yield {"type": "error", "content": classified.message}
                return
            t_gemini_end = time.time()
            
            # Send metrics
            t_total = time.time() - t_start
            metrics = {
                "embedding_ms": round((t_emb_end - t_emb_start) * 1000, 2),
                "search_ms": round((t_search_end - t_search_start) * 1000, 2),
                "context_ms": round((t_context_end - t_context_start) * 1000, 2),
                "first_chunk_ms": round(t_first_chunk * 1000, 2) if first_chunk_received else 0.0,
                "gemini_total_ms": round((t_gemini_end - t_gemini_start) * 1000, 2),
                "total_ms": round(t_total * 1000, 2),
                "cache_hit": False
            }
            yield {"type": "metrics", "content": metrics}
            return

        # Emit citations to the client first
        yield {"type": "citations", "content": citations}

        logger.info(f"[DEBUG RAG] Final context:\n{context_str}")

        # Step 6: Inject context into prompt template
        user_prompt = RAG_USER_PROMPT_TEMPLATE.format(
            context=context_str, question=question
        )
        logger.info(f"[DEBUG RAG] Prompt length: {len(user_prompt)}")
        logger.info(f"[DEBUG RAG] Gemini model request target: {settings.GEMINI_MODEL}")
        logger.info(f"[DEBUG RAG] Gemini system instruction: {settings.SYSTEM_INSTRUCTION}")
        logger.info(f"[DEBUG RAG] Gemini request payload prompt: {user_prompt}")

        # Step 7: Stream response from Gemini
        t_gemini_start = time.time()
        first_chunk_received = False
        t_first_chunk = 0.0
        response_text = ""
        try:
            logger.info(f"Invoking Gemini Model '{settings.GEMINI_MODEL}' with temperature={settings.TEMPERATURE}...")
            stream_gen = self.gemini_service.generate_response_stream(
                prompt=user_prompt,
                system_instruction=settings.SYSTEM_INSTRUCTION,
                temperature=settings.TEMPERATURE,
            )
            for text_chunk in stream_gen:
                if text_chunk:
                    if not first_chunk_received:
                        t_first_chunk = time.time() - t_gemini_start
                        first_chunk_received = True
                    response_text += text_chunk
                    yield {"type": "text", "content": text_chunk}
        except Exception as e:
            logger.error(f"Gemini streaming compilation failed: {str(e)}")
            classified = classify_gemini_exception(e)
            yield {"type": "error", "content": classified.message}
            return
        t_gemini_end = time.time()

        logger.info(f"[DEBUG RAG] Gemini raw response: {response_text}")

        # Step 8: Check for fallback or append citation sources
        clean_response = response_text.strip().lower()
        is_fallback = (
            "couldn't find" in clean_response
            or "could not find" in clean_response
            or "context does not contain" in clean_response
            or "sorry, but" in clean_response
            or "do not contain" in clean_response
        )

        final_response_text = response_text
        if is_fallback:
            logger.info("RAG response determined to be fallback. Initiating General AI Knowledge fallback stream...")
            # Clear citations
            yield {"type": "citations", "content": []}
            # Append label
            yield {"type": "text", "content": " Here's a general explanation based on my knowledge:\n\n---\n\n"}
            t_gemini_start = time.time()
            first_chunk_received = False
            t_first_chunk = 0.0
            fallback_response_text = ""
            try:
                general_system_instruction = (
                    "You are a helpful, professional Enterprise AI Knowledge Assistant. "
                    "Answer the user's question using your general knowledge."
                )
                stream_gen = self.gemini_service.generate_response_stream(
                    prompt=question,
                    system_instruction=general_system_instruction,
                    temperature=0.7,
                )
                for text_chunk in stream_gen:
                    if text_chunk:
                        if not first_chunk_received:
                            t_first_chunk = time.time() - t_gemini_start
                            first_chunk_received = True
                        fallback_response_text += text_chunk
                        yield {"type": "text", "content": text_chunk}
            except Exception as e:
                logger.error(f"Fallback stream failed: {str(e)}")
                classified = classify_gemini_exception(e)
                yield {"type": "error", "content": classified.message}
                return
            t_gemini_end = time.time()
            final_response_text = response_text.strip() + " Here's a general explanation based on my knowledge:\n\n---\n\n" + fallback_response_text
            # Store in cache
            self._rag_cache[question] = {
                "citations": [],
                "response_text": final_response_text
            }
        else:
            sources_block = ""
            sources_lines = []
            for item in merged_results:
                filename = item[1]
                pages = item[2]
                chunks = item[3]
                
                pages_str = ", ".join(map(str, pages)) if pages else ""
                chunks_str = ", ".join(map(str, chunks))
                
                source_key = (filename, pages_str, chunks_str)
                if source_key not in seen_sources:
                    seen_sources.add(source_key)
                    page_info = f", Page: {pages_str}" if pages else ""
                    sources_lines.append(f"- `{filename}`{page_info} (Segment: {chunks_str})")
            
            # Keep response_text clean and natural
            final_response_text = response_text

            # Store in cache
            self._rag_cache[question] = {
                "citations": citations,
                "response_text": final_response_text
            }

            logger.info(f"[DEBUG RAG] Final parsed response:\n{final_response_text}")
            logger.info(f"RAG streaming transaction complete. Final response length: {len(response_text)} characters.")

        # Send metrics at the end
        t_total = time.time() - t_start
        metrics = {
            "embedding_ms": round((t_emb_end - t_emb_start) * 1000, 2),
            "search_ms": round((t_search_end - t_search_start) * 1000, 2),
            "context_ms": round((t_context_end - t_context_start) * 1000, 2),
            "first_chunk_ms": round(t_first_chunk * 1000, 2) if first_chunk_received else 0.0,
            "gemini_total_ms": round((t_gemini_end - t_gemini_start) * 1000, 2),
            "total_ms": round(t_total * 1000, 2),
            "cache_hit": False
        }
        logger.info(
            f"[PERF RAG] Embedding Generation: {metrics['embedding_ms']:.2f} ms | "
            f"Vector Search: {metrics['search_ms']:.2f} ms | "
            f"Context Building: {metrics['context_ms']:.2f} ms | "
            f"Gemini API Response: {metrics['gemini_total_ms']:.2f} ms | "
            f"Total RAG Pipeline Time: {metrics['total_ms']:.2f} ms"
        )
        yield {"type": "metrics", "content": metrics}
