import markdown


def render_markdown(raw_content: str) -> str:
    """Render markdown to HTML with configured extensions."""
    return markdown.markdown(
        raw_content,
        extensions=['fenced_code', 'tables'],
        extension_configs={'fenced_code': {}}
    )

