import difflib
from typing import Callable, Dict


def build_raw_diff(before_raw: str, after_raw: str, before_name: str, after_name: str) -> str:
    """Generate HTML diff table for provided contents.
    
    Args:
        before_raw: Original content as string
        after_raw: Modified content as string
        before_name: Display name for original version
        after_name: Display name for modified version
    
    Returns:
        HTML string containing formatted diff table
    """
    diff_maker = difflib.HtmlDiff(wrapcolumn=120)
    return diff_maker.make_table(
        before_raw.splitlines(),
        after_raw.splitlines(),
        fromdesc=before_name,
        todesc=after_name,
        context=True,  # Show context lines around changes
        numlines=3     # Number of context lines to show
    )


def build_diff_payload(
    before_raw: str,
    after_raw: str,
    before_name: str,
    after_name: str,
    renderer: Callable[[str], str],
) -> Dict[str, dict]:
    """Build response payload for diff endpoints.
    
    Args:
        before_raw: Original markdown content
        after_raw: Modified markdown content
        before_name: Display name for original version
        after_name: Display name for modified version
        renderer: Function to render markdown to HTML
    
    Returns:
        Dictionary containing before/after content (raw and rendered) and diff HTML
    """
    # Render both versions to HTML
    before_html = renderer(before_raw)
    after_html = renderer(after_raw)
    # Generate diff table HTML
    raw_diff_html = build_raw_diff(before_raw, after_raw, before_name, after_name)

    return {
        'before': {
            'filename': before_name,
            'raw_content': before_raw,
            'html_content': before_html
        },
        'after': {
            'filename': after_name,
            'raw_content': after_raw,
            'html_content': after_html
        },
        'raw_diff_html': raw_diff_html
    }

