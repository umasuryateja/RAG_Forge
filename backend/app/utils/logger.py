import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from app.core.config import settings


class StructuredFormatter(logging.Formatter):
    """
    Sleek formatter that prints readable structured statements.
    """
    def format(self, record):
        log_time = self.formatTime(record, self.datefmt)
        log_level = record.levelname
        log_name = record.name
        log_msg = record.getMessage()
        
        # Prevent Windows console encoding (e.g. CP1252) print crashes
        try:
            encoding = sys.stdout.encoding or "utf-8"
            log_msg.encode(encoding)
        except UnicodeEncodeError:
            log_msg = log_msg.encode("ascii", errors="replace").decode("ascii")
            
        return f"{log_time} [{log_level}] ({log_name}): {log_msg}"


def setup_logging():
    """
    Configure standard and file logging channels using settings configuration.
    """
    # Fetch log level from configuration, defaulting to INFO
    raw_level = settings.LOG_LEVEL.upper()
    log_level = getattr(logging, raw_level, logging.INFO)

    # Ensure log folders exist
    log_path = Path(settings.LOG_FILE)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    # Define standard formatters
    formatter = StructuredFormatter(
        fmt="%(asctime)s [%(levelname)s] (%(name)s): %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 1. Console Handler (Standard out)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    # 2. File Handler (Automatic rotation at 10MB, retaining 5 historical files)
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Reset any default handlers to avoid duplicate printouts
    root_logger.handlers = []
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

    # Decrease verbosity of standard RAG and network packages
    logging.getLogger("pydantic").setLevel(logging.WARNING)
    logging.getLogger("chromadb").setLevel(logging.WARNING)
    logging.getLogger("hnswlib").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    # Setup core logger instance
    core_logger = logging.getLogger("app")
    core_logger.info(
        f"Structured Logger configured successfully. Level={settings.LOG_LEVEL}, Output={settings.LOG_FILE}"
    )
    return core_logger


logger = setup_logging()
