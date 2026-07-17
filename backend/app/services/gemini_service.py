import re
import time
import traceback
from typing import Generator, Optional
import google.generativeai as genai
from app.core.config import settings
from app.utils.logger import logger


class GeminiServiceException(Exception):
    """
    Custom exception representing classified Gemini API errors.
    """
    def __init__(self, code: str, message: str, original_exception: Optional[Exception] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.original_exception = original_exception


def classify_gemini_exception(e: Exception) -> GeminiServiceException:
    """
    Map raw developer exception types to unified custom error objects with friendly descriptions.
    """
    if isinstance(e, GeminiServiceException):
        return e

    err_msg = str(e)
    # Check for invalid API key
    if "API_KEY_INVALID" in err_msg or "PermissionDenied" in err_msg or "API key not valid" in err_msg or "unauthorized" in err_msg.lower():
        return GeminiServiceException(
            code="invalid_api_key",
            message="Gemini API key is not configured or is invalid. Please check your credentials.",
            original_exception=e
        )

    # Check for quota limits / rate limits
    if "ResourceExhausted" in err_msg or "429" in err_msg or "quota" in err_msg.lower():
        if "daily" in err_msg.lower() or "per day" in err_msg.lower():
            return GeminiServiceException(
                code="quota_exceeded",
                message="AI service temporarily unavailable. Reason: Daily API quota has been reached. Please try again later or configure another Gemini API key.",
                original_exception=e
            )
        else:
            return GeminiServiceException(
                code="rate_limit_reached",
                message="AI service is temporarily unavailable because the request limit has been reached. Please try again later.",
                original_exception=e
            )

    # Check for timeout
    if "DeadlineExceeded" in err_msg or "timeout" in err_msg.lower() or "timed out" in err_msg.lower():
        return GeminiServiceException(
            code="timeout",
            message="The request to the AI service timed out. Please try again.",
            original_exception=e
        )

    # Check for network failures
    if ("ConnectError" in err_msg or "ConnectionError" in err_msg or 
        "dns" in err_msg.lower() or "connection failed" in err_msg.lower() or
        "socket" in err_msg.lower() or "http connection" in err_msg.lower() or 
        "unreachable" in err_msg.lower() or "host" in err_msg.lower()):
        return GeminiServiceException(
            code="network_failure",
            message="Unable to connect to the AI service. Please check your internet connection.",
            original_exception=e
        )

    # Check for invalid model
    if "model" in err_msg.lower() and ("not found" in err_msg.lower() or "not supported" in err_msg.lower() or "invalid" in err_msg.lower() or "404" in err_msg):
        return GeminiServiceException(
            code="invalid_model",
            message="The selected AI model is invalid or not supported.",
            original_exception=e
        )

    # Check for empty response
    if "EMPTY_RESPONSE" in err_msg:
        return GeminiServiceException(
            code="empty_response",
            message="The AI service returned an empty response. Please try rephrasing your question.",
            original_exception=e
        )

    # Check for safety filter blocks
    if "SAFETY_BLOCKED" in err_msg or "safety" in err_msg.lower() or "blocked" in err_msg.lower():
        return GeminiServiceException(
            code="safety_blocked",
            message="The request was blocked by safety filters. Please modify your question.",
            original_exception=e
        )

    # General fallback
    return GeminiServiceException(
        code="unexpected_error",
        message="An unexpected error occurred in the AI service. Please try again later.",
        original_exception=e
    )


class GeminiService:
    """
    Service wrapper for Google Gemini Generative AI API client actions.
    """
    def __init__(self):
        self._last_api_key = None
        self._configure_client()

    def _configure_client(self):
        api_key = settings.GEMINI_API_KEY
        if api_key != self._last_api_key:
            if api_key:
                genai.configure(api_key=api_key)
                logger.info(
                    f"Gemini API connection configured. Target model: {settings.GEMINI_MODEL}"
                )
            else:
                logger.warning(
                    "Gemini API Key is not set. Generation endpoints will fail."
                )
            self._last_api_key = api_key

    def generate_response(
        self,
        prompt: str,
        system_instruction: str = None,
        temperature: float = 0.2,
    ) -> str:
        """
        Produce a blocking static text generation response with exponential backoff retries.
        """
        self._configure_client()
        api_key = settings.GEMINI_API_KEY
        model_name = settings.GEMINI_MODEL

        request_time = time.strftime("%Y-%m-%d %H:%M:%S")
        retry_count = 0

        if not api_key:
            exc = GeminiServiceException(
                code="invalid_api_key",
                message="Gemini API key is not configured."
            )
            response_time = time.strftime("%Y-%m-%d %H:%M:%S")
            logger.info(
                f"[METRIC GEMINI] Request Time={request_time} | Response Time={response_time} | "
                f"Model Name={model_name} | Token Usage=0 | "
                f"Prompt Length={len(prompt)} chars | Status Code=401 | "
                f"Retry Count=0 | Final Result=Failure (Code: invalid_api_key)"
            )
            raise exc

        # Sanitize empty string system instruction to prevent GenAI SDK content validation bug
        if system_instruction and not system_instruction.strip():
            system_instruction = None

        max_retries = 3
        last_exception = None

        for attempt in range(1, max_retries + 1):
            try:
                model = genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=system_instruction,
                )
                response = model.generate_content(
                    prompt,
                    generation_config={"temperature": temperature},
                    request_options={"timeout": 20.0}
                )
                
                # Check for empty response
                if not response.text or not response.text.strip():
                    raise ValueError("EMPTY_RESPONSE: The AI service returned an empty response.")
                
                # Success metrics logging
                response_time = time.strftime("%Y-%m-%d %H:%M:%S")
                token_usage_est = (len(prompt) + len(response.text)) // 4
                logger.info(
                    f"[METRIC GEMINI] Request Time={request_time} | Response Time={response_time} | "
                    f"Model Name={model_name} | Token Usage={token_usage_est} (est) | "
                    f"Prompt Length={len(prompt)} chars | Status Code=200 | "
                    f"Retry Count={retry_count} | Final Result=Success"
                )
                return response.text

            except Exception as e:
                last_exception = e
                classified = classify_gemini_exception(e)
                
                # Only retry transient issues
                if classified.code in ["rate_limit_reached", "timeout", "network_failure"] and attempt < max_retries:
                    retry_count += 1
                    sleep_time = 2.0 * attempt
                    logger.warning(
                        f"Transient Gemini API error ({classified.code}). "
                        f"Retrying in {sleep_time}s (Attempt {attempt}/{max_retries})...."
                    )
                    time.sleep(sleep_time)
                else:
                    # Log full stack trace internally
                    logger.error(
                        f"Gemini static generation failed permanently on attempt {attempt}: {str(e)}\n"
                        f"{traceback.format_exc()}"
                    )
                    
                    # Log failure metrics
                    response_time = time.strftime("%Y-%m-%d %H:%M:%S")
                    status_code = 429 if classified.code in ["quota_exceeded", "rate_limit_reached"] else (401 if classified.code == "invalid_api_key" else 500)
                    logger.info(
                        f"[METRIC GEMINI] Request Time={request_time} | Response Time={response_time} | "
                        f"Model Name={model_name} | Token Usage=0 | "
                        f"Prompt Length={len(prompt)} chars | Status Code={status_code} | "
                        f"Retry Count={retry_count} | Final Result=Failure (Code: {classified.code})"
                    )
                    raise classified

    def generate_response_stream(
        self,
        prompt: str,
        system_instruction: str = None,
        temperature: float = 0.2,
    ) -> Generator[str, None, None]:
        """
        Produce a real-time text generation stream with exponential backoff retries.
        """
        self._configure_client()
        api_key = settings.GEMINI_API_KEY
        model_name = settings.GEMINI_MODEL

        request_time = time.strftime("%Y-%m-%d %H:%M:%S")
        retry_count = 0

        if not api_key:
            exc = GeminiServiceException(
                code="invalid_api_key",
                message="Gemini API key is not configured."
            )
            response_time = time.strftime("%Y-%m-%d %H:%M:%S")
            logger.info(
                f"[METRIC GEMINI] Request Time={request_time} | Response Time={response_time} | "
                f"Model Name={model_name} | Token Usage=0 | "
                f"Prompt Length={len(prompt)} chars | Status Code=401 | "
                f"Retry Count=0 | Final Result=Failure (Code: invalid_api_key)"
            )
            raise exc

        # Sanitize empty string system instruction to prevent GenAI SDK content validation bug
        if system_instruction and not system_instruction.strip():
            system_instruction = None

        max_retries = 3
        last_exception = None

        for attempt in range(1, max_retries + 1):
            try:
                model = genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=system_instruction,
                )
                response = model.generate_content(
                    prompt,
                    generation_config={"temperature": temperature},
                    stream=True,
                    request_options={"timeout": 20.0}
                )
                
                # Read chunks via iterator to capture rate limits or block exceptions before yielding
                response_iterator = iter(response)
                first_chunk = next(response_iterator, None)
                
                accumulated_text = ""
                
                if first_chunk:
                    txt = first_chunk.text
                    if txt:
                        accumulated_text += txt
                        yield txt
                        
                for chunk in response_iterator:
                    txt = chunk.text
                    if txt:
                        accumulated_text += txt
                        yield txt
                
                # Check for empty response
                if not accumulated_text.strip():
                    raise ValueError("EMPTY_RESPONSE: The AI service returned an empty response.")
                
                # Success metrics logging
                response_time = time.strftime("%Y-%m-%d %H:%M:%S")
                token_usage_est = (len(prompt) + len(accumulated_text)) // 4
                logger.info(
                    f"[METRIC GEMINI] Request Time={request_time} | Response Time={response_time} | "
                    f"Model Name={model_name} | Token Usage={token_usage_est} (est) | "
                    f"Prompt Length={len(prompt)} chars | Status Code=200 | "
                    f"Retry Count={retry_count} | Final Result=Success"
                )
                return

            except Exception as e:
                last_exception = e
                classified = classify_gemini_exception(e)
                
                # Only retry transient issues
                if classified.code in ["rate_limit_reached", "timeout", "network_failure"] and attempt < max_retries:
                    retry_count += 1
                    sleep_time = 2.0 * attempt
                    logger.warning(
                        f"Transient Gemini API error ({classified.code}). "
                        f"Retrying in {sleep_time}s (Attempt {attempt}/{max_retries})...."
                    )
                    time.sleep(sleep_time)
                else:
                    # Log full stack trace internally
                    logger.error(
                        f"Gemini stream generation failed permanently on attempt {attempt}: {str(e)}\n"
                        f"{traceback.format_exc()}"
                    )
                    
                    # Log failure metrics
                    response_time = time.strftime("%Y-%m-%d %H:%M:%S")
                    status_code = 429 if classified.code in ["quota_exceeded", "rate_limit_reached"] else (401 if classified.code == "invalid_api_key" else 500)
                    logger.info(
                        f"[METRIC GEMINI] Request Time={request_time} | Response Time={response_time} | "
                        f"Model Name={model_name} | Token Usage=0 | "
                        f"Prompt Length={len(prompt)} chars | Status Code={status_code} | "
                        f"Retry Count={retry_count} | Final Result=Failure (Code: {classified.code})"
                    )
                    raise classified
