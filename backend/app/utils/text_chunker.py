import re
from typing import List


def chunk_text(
    text: str,
    chunk_size: int = 800,
    overlap: int = 150,
) -> List[str]:
    """
    Split text into overlapping chunks, preserving paragraph and sentence boundaries.
    Also strips whitespaces and filters out exact duplicate chunks.
    """
    if chunk_size <= 0:
        chunk_size = 800
    if overlap < 0:
        overlap = 0
    if overlap >= chunk_size:
        overlap = chunk_size // 2

    # Normalize newlines
    text = text.replace("\r\n", "\n")
    
    # Split text into paragraphs (paragraphs are separated by blank lines or multiple newlines)
    paragraphs = re.split(r'\n\s*\n', text)
    
    chunks = []
    current_chunk = []
    current_size = 0
    
    # We will process each paragraph
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
            
        # If the paragraph fits in the current chunk, add it
        if current_size + len(para) + (2 if current_chunk else 0) <= chunk_size:
            current_chunk.append(para)
            current_size += len(para) + (2 if len(current_chunk) > 1 else 0)
        else:
            # If paragraph itself is larger than chunk_size, we need to split it by sentences
            if len(para) > chunk_size:
                # Flush the current chunk first
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                    current_chunk = []
                    current_size = 0
                
                # Split paragraph into sentences using clean regex boundaries
                sentences = re.split(r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|\!)\s+', para)
                for sentence in sentences:
                    sentence = sentence.strip()
                    if not sentence:
                        continue
                    if current_size + len(sentence) + (1 if current_chunk else 0) <= chunk_size:
                        current_chunk.append(sentence)
                        current_size += len(sentence) + (1 if len(current_chunk) > 1 else 0)
                    else:
                        # Flush current chunk
                        if current_chunk:
                            chunks.append(" ".join(current_chunk))
                        # Implement overlap: take last few sentences of current_chunk for overlap
                        overlap_chunk = []
                        overlap_size = 0
                        for s in reversed(current_chunk):
                            if overlap_size + len(s) + (1 if overlap_chunk else 0) <= overlap:
                                overlap_chunk.insert(0, s)
                                overlap_size += len(s) + (1 if len(overlap_chunk) > 1 else 0)
                            else:
                                break
                        current_chunk = overlap_chunk + [sentence]
                        current_size = sum(len(s) for s in current_chunk) + len(current_chunk) - 1
            else:
                # Flush the current chunk
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                
                # Implement overlap: select paragraphs from the end of current_chunk
                overlap_chunk = []
                overlap_size = 0
                for p in reversed(current_chunk):
                    if overlap_size + len(p) + (2 if overlap_chunk else 0) <= overlap:
                        overlap_chunk.insert(0, p)
                        overlap_size += len(p) + (2 if len(overlap_chunk) > 1 else 0)
                    else:
                        break
                
                current_chunk = overlap_chunk + [para]
                current_size = sum(len(p) for p in current_chunk) + (2 * (len(current_chunk) - 1) if len(current_chunk) > 1 else 0)
                
    if current_chunk:
        chunks.append("\n\n".join(current_chunk) if any('\n' in item for item in current_chunk) else " ".join(current_chunk))
        
    # Remove empty or duplicate chunks, while preserving order
    seen = set()
    unique_chunks = []
    for c in chunks:
        c_clean = c.strip()
        if c_clean and c_clean not in seen:
            seen.add(c_clean)
            unique_chunks.append(c_clean)
            
    return unique_chunks