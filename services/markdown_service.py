import markdown


def render_markdown(raw_content: str) -> str:
    """Render markdown to HTML with configured extensions.
    
    Args:
        raw_content: Raw markdown text to render
    
    Returns:
        Rendered HTML string
    
    Extensions enabled:
    - fenced_code: Support for code blocks with triple backticks
    - tables: Support for markdown tables
    """
    return markdown.markdown(
        raw_content,
        extensions=['fenced_code', 'tables'],
        extension_configs={'fenced_code': {}}
    )

