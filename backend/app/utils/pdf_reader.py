from pathlib import Path
from typing import List, Dict, Any

from pypdf import PdfReader


def extract_text_from_pdf(pdf_path: Path) -> List[Dict[str, Any]]:
    """
    Extract text page-by-page from a PDF file using a context manager to ensure 
    the file descriptor is closed and not locked on Windows systems.
    """
    pages_data = []
    with open(pdf_path, "rb") as f:
        reader = PdfReader(f)
        for idx, page in enumerate(reader.pages):
            page_text = page.extract_text()

            if page_text and page_text.strip():
                pages_data.append({
                    "page_num": idx + 1,
                    "text": page_text
                })

    return pages_data