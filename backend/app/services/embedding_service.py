import os
# Force offline cached model loading to prevent startup hangs during external Hugging Face network checkouts
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from sentence_transformers import SentenceTransformer


class EmbeddingService:
    """
    Service responsible for creating text embeddings.
    """

    def __init__(self):
        self.model = SentenceTransformer(
            "all-MiniLM-L6-v2"
        )
        self._query_cache = {}

    def generate_embeddings(self, chunks):
        embeddings = self.model.encode(chunks)

        return embeddings.tolist()

    def generate_query_embedding(self, question: str):
        if question in self._query_cache:
            return self._query_cache[question]
        embedding = self.model.encode(question)
        emb_list = embedding.tolist()
        self._query_cache[question] = emb_list
        return emb_list