"""Factory for creating LLM providers based on environment configuration."""

from __future__ import annotations

import os

from .base import LLMProvider


class ConfigError(Exception):
    """Raised when LLM provider configuration is invalid."""

    pass


def create_provider(
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> LLMProvider:
    """Create an LLM provider based on configuration.

    Provider selection priority (when provider is not explicitly specified):
    1. Anthropic (if ANTHROPIC_API_KEY is set)
    2. OpenRouter (if OPENROUTER_API_KEY is set)
    3. Google (if GOOGLE_API_KEY is set)

    Args:
        provider: Explicit provider name ("anthropic", "openrouter", "google")
        model: Model override (provider-specific)
        api_key: API key override

    Returns:
        Configured LLM provider instance

    Raises:
        ConfigError: If no API key is found for any provider
        ImportError: If required SDK is not installed
    """
    if provider:
        return _create_explicit_provider(provider, model, api_key)

    # Auto-detect based on available API keys
    if os.environ.get("ANTHROPIC_API_KEY") or api_key:
        return _create_anthropic(model, api_key)

    if os.environ.get("OPENROUTER_API_KEY"):
        return _create_openrouter(model, api_key)

    if os.environ.get("GOOGLE_API_KEY"):
        return _create_google(model, api_key)

    raise ConfigError(
        "No LLM API key found. Set one of:\n"
        "  - ANTHROPIC_API_KEY (recommended, uses Claude)\n"
        "  - OPENROUTER_API_KEY (with optional MODEL_NAME)\n"
        "  - GOOGLE_API_KEY (uses Gemini)"
    )


def _create_explicit_provider(
    provider: str,
    model: str | None = None,
    api_key: str | None = None,
) -> LLMProvider:
    """Create a specific provider by name."""
    provider = provider.lower()

    if provider == "anthropic":
        return _create_anthropic(model, api_key)
    elif provider == "openrouter":
        return _create_openrouter(model, api_key)
    elif provider == "google":
        return _create_google(model, api_key)
    else:
        raise ConfigError(
            f"Unknown provider: {provider}. "
            "Supported: anthropic, openrouter, google"
        )


def _create_anthropic(model: str | None = None, api_key: str | None = None) -> LLMProvider:
    """Create Anthropic provider."""
    from .anthropic import AnthropicProvider

    return AnthropicProvider(model=model, api_key=api_key)


def _create_openrouter(model: str | None = None, api_key: str | None = None) -> LLMProvider:
    """Create OpenRouter provider."""
    from .openrouter import OpenRouterProvider

    return OpenRouterProvider(model=model, api_key=api_key)


def _create_google(model: str | None = None, api_key: str | None = None) -> LLMProvider:
    """Create Google provider."""
    from .google import GoogleProvider

    return GoogleProvider(model=model, api_key=api_key)
